<script setup lang="ts">
import { agentBrowserStore } from './store/agentBrowser.store'
import type { AgentBrowserSessionState } from '@maestro-shared/coach.api'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Button, Message, Notification, Spin, Trigger } from '@arco-design/web-vue'
import { IconLogin2, IconX } from '@tabler/icons-vue'
import { createXpcRendererEmitter, xpcRenderer } from 'electron-xpc/renderer'
import { i18nHelper } from '@renderer/common/i18n/i18n.helper'
import { defaultLlmEffort } from '@maestro-shared/coach.api'
import type {
  AgentActivityStep,
  AgentThinkingState,
  AgentReply,
  AgentStreamDelta,
  CoachXpcContract,
  CodexDebugEvent,
  InjectedSkillTrigger,
  LlmConfig,
  LlmEffort,
  LlmLoginState,
  LlmTarget,
  TabInfo
} from '@maestro-shared/coach.api'
import ChatPanel from './ChatPanel.vue'
import SessionTitle from './SessionTitle.vue'
import SessionsDrawer from './SessionsDrawer.vue'
import SessionSearchModal from './SessionSearchModal.vue'
import { sessionActions } from './store/sessionActions.store'
import WorkflowTaskBar from './WorkflowTaskBar.vue'
import ChatConfirmSheet from './task/ChatConfirmSheet.vue'
import DecisionSheet from './task/DecisionSheet.vue'
import { channelStore } from './store/channel.store'
import { messageStore } from './store/message.store'
import { isRejection } from './store/turn.service'
import { taskStore } from './store/task.store'
import { workflowStore } from './store/workflow.store'
import { localHomeAuthStore } from '@renderer/maestro/localHome/src/localHomeAuth.store'
import { ControlSubscriptionScope } from './controlSubscriptions.service'
import { installMarkdownLinkTooltipCleanup } from './markdownLinkTooltip.service'
import './ControlApp.less'

const coach = createXpcRendererEmitter<CoachXpcContract>('CoachXpcHandler')
let disposeMarkdownLinkTooltip: (() => void) | undefined
const subscriptions = new ControlSubscriptionScope()
workflowStore.resume()

const resetProtectedState = (): void => {
  if (!subscriptions.active) return
  subscriptions.dispose()
  channelStore.reset()
  messageStore.reset()
  taskStore.reset()
  sessionActions.reset()
  agentBrowserStore.reset()
  workflowStore.reset()
  Notification.remove('codex-device')
}

// Invalidate pending reads synchronously, before Vue gets to unmount the protected subtree.
watch(() => [localHomeAuthStore.ready && !localHomeAuthStore.loggingOut,
  localHomeAuthStore.snapshot?.authorityEpoch, localHomeAuthStore.snapshot?.email] as const,
([ready, epoch, email], [, previousEpoch, previousEmail]) => {
  if (!ready || epoch !== previousEpoch || email !== previousEmail) resetProtectedState()
}, { flush: 'sync' })

const status = ref('idle')
const controlLoading = ref(true)
const controlLoadError = ref('')
const llmSwitching = ref(false)
const llmLoginProvider = ref('')
const llmConfig = ref<LlmConfig | null>(null)
const providerPickerVisible = ref(false)
const modelPickerVisible = ref(false)
const effortPickerVisible = ref(false)
const activeSession = computed(() => channelStore.activeSession)
const chatPanelRef = ref<InstanceType<typeof ChatPanel> | null>(null)
const focusComposer = (): void => {
  void nextTick(() => {
    if (!subscriptions.active) return
    if (!sessionActions.historyVisible && !sessionActions.searchVisible) chatPanelRef.value?.focusComposer()
  })
}
sessionActions.init()
const llmLocked = computed(
  () =>
    llmSwitching.value ||
    Boolean(messageStore.turnService.activeTurn()) ||
    Boolean(messageStore.activeAgentTurnSnapshot)
)

interface ControlLlmProviderGroup {
  provider: string
  label: string
  ready: boolean
  models: LlmTarget[]
}

const syncLlmContextWindow = (cfg: LlmConfig): void => {
  const preset = cfg.presets.find((item) => item.provider === cfg.provider && item.model === cfg.model)
  messageStore.setContextWindow(preset?.contextLengthK || 256, preset?.contextLengthLabel || '256K', preset?.compressionRemainingPercent || 10)
}

// 预设声明的默认档优先(astra 列 max..low 但默认 medium);`efforts[0]` 只是它不在自己列表里时的兜底。
const firstEffort = (model: LlmTarget): LlmEffort => defaultLlmEffort(model)

/**
 * Control 面板**不展示**的 provider。crms 退役后这张表是空的 —— 空是有意的,不是忘了填。
 *
 * 为什么不写成"允许清单":`LlmProviderId` 是 `'openai-codex' | 'anthropic' | string`,**故意开放**
 * (config 报什么 provider 就展示什么,pi 侧新增一个不需要改这里),测试里的 fixture 也用任意 id。
 * 白名单会把这条开放性反转成"没登记就不显示",那是另一个产品决定,不该由一次退役顺手做掉。
 *
 * 所以这里保留闸门与它的四个调用点、把被排除者收进一个具名常量:今天为空(谓词恒真,与退役前
 * 对 crms 之外的 provider 行为一致),将来要藏谁,加一行即可,而不必再去四个调用点里找条件。
 */
const CONTROL_HIDDEN_PROVIDERS = new Set<string>()

const isControlProviderAllowed = (provider: string): boolean => !CONTROL_HIDDEN_PROVIDERS.has(provider)

const getLlmProviderGroups = (cfg: LlmConfig | null): ControlLlmProviderGroup[] => {
  if (!cfg) return []
  const groups: ControlLlmProviderGroup[] = cfg.providers
    .filter((provider) => isControlProviderAllowed(provider.provider))
    .map((provider) => ({
      provider: provider.provider,
      label: provider.label,
      ready: provider.ready,
      models: []
    }))
  for (const preset of cfg.presets) {
    if (!isControlProviderAllowed(preset.provider)) continue
    let group = groups.find((item) => item.provider === preset.provider)
    if (!group) {
      group = {
        provider: preset.provider,
        label: preset.providerLabel,
        ready: false,
        models: []
      }
      groups.push(group)
    }
    group.models.push(preset)
  }
  return groups
}

const llmProviderGroups = computed(() => getLlmProviderGroups(llmConfig.value))
const activeLlmGroup = computed(() => llmProviderGroups.value.find((item) => item.provider === llmConfig.value?.provider))
const activeLlmProviderAllowed = computed(() => Boolean(llmConfig.value && isControlProviderAllowed(llmConfig.value.provider)))
const activeLlmPreset = computed(() =>
  llmConfig.value?.presets.find((item) => item.provider === llmConfig.value?.provider && item.model === llmConfig.value?.model)
)
const activeLlmEfforts = computed(() => activeLlmProviderAllowed.value ? activeLlmPreset.value?.efforts || [] : [])
const activeLlmProvider = computed(() => llmConfig.value?.providers.find((item) => item.provider === llmConfig.value?.provider))
const activeLlmEffortLabel = computed(() => {
  const effort = llmConfig.value?.effort
  if (!effort) return ''
  return activeLlmPreset.value?.efforts.find((item) => item.id === effort)?.label || effort
})
const llmEffortValue = computed(() => llmConfig.value?.effort || activeLlmPreset.value?.effort || 'default')
const llmEffortDisabled = computed(() => !activeLlmProviderAllowed.value || (activeLlmEfforts.value.length <= 1 && activeLlmEfforts.value[0]?.id === 'default'))
const llmAvailable = computed(() =>
  Boolean(activeLlmProviderAllowed.value && llmConfig.value?.ready && activeLlmPreset.value?.efforts.some((item) => item.id === llmConfig.value?.effort))
)
const needsLlmLogin = computed(() => Boolean(activeLlmProviderAllowed.value && activeLlmPreset.value && !activeLlmProvider.value?.ready))
const activeProviderLabel = computed(() => activeLlmProvider.value?.label || activeLlmPreset.value?.providerLabel || llmConfig.value?.provider || '')
const llmLoginLoading = computed(() => Boolean(llmLoginProvider.value && llmLoginProvider.value === llmConfig.value?.provider))
const activeModelLabel = computed(() => activeLlmPreset.value?.shortLabel || activeLlmPreset.value?.label || llmConfig.value?.model || '')

const llmLabel = (provider: string, model: string, effort?: LlmEffort): string => {
  const preset = llmConfig.value?.presets.find((item) => item.provider === provider && item.model === model)
  const effortLabel = effort ? preset?.efforts.find((item) => item.id === effort)?.label || effort : ''
  return [preset?.label || `${provider}/${model}`, effortLabel].filter(Boolean).join(' / ')
}

const controlLlmTitle = computed(() => {
  const cfg = llmConfig.value
  return cfg ? llmLabel(cfg.provider, cfg.model, cfg.effort) : 'LLM backend'
})

const toLlmEffort = (value: unknown): LlmEffort => {
  const effort = String(value || '') as LlmEffort
  return activeLlmEfforts.value.some((item) => item.id === effort) ? effort : activeLlmPreset.value?.effort || 'default'
}

const applyLlmConfig = async (cfg: LlmConfig): Promise<void> => {
  if (!subscriptions.active) return
  llmConfig.value = cfg
  syncLlmContextWindow(cfg)
  await messageStore.compactAllIfNeeded()
  if (!subscriptions.active) return
  status.value = cfg.ready ? 'idle' : 'login needed'
}

const onSwitchLlmTarget = async (
  target: { provider: string; model: string; effort: LlmEffort },
  closePicker: 'provider' | 'model' | false = false
): Promise<void> => {
  if (!target || !isControlProviderAllowed(target.provider) || llmLocked.value) return
  llmSwitching.value = true
  status.value = 'switching model'
  try {
    const cfg = await coach.setLlmConfig(target)
    if (!subscriptions.active) return
    llmConfig.value = cfg
    syncLlmContextWindow(cfg)
    await messageStore.compactAllIfNeeded()
    if (!subscriptions.active) return
    if (cfg.ready) {
      Message.success(`Switched to ${llmLabel(cfg.provider, cfg.model, cfg.effort)}`)
      status.value = 'idle'
    } else {
      status.value = 'login needed'
    }
  } finally {
    llmSwitching.value = false
    if (closePicker === 'provider') providerPickerVisible.value = false
    if (closePicker === 'model') modelPickerVisible.value = false
  }
}

const onSwitchLlmProvider = async (provider: string): Promise<void> => {
  const model = llmProviderGroups.value.find((item) => item.provider === provider)?.models[0]
  if (!model) return
  await onSwitchLlmTarget({ provider: model.provider, model: model.model, effort: firstEffort(model) }, 'provider')
}

const onSwitchLlmModel = async (model: LlmTarget): Promise<void> => {
  await onSwitchLlmTarget({ provider: model.provider, model: model.model, effort: firstEffort(model) }, 'model')
}

const onSwitchLlmEffort = async (value: unknown): Promise<void> => {
  const cfg = llmConfig.value
  if (!cfg || !activeLlmProviderAllowed.value || llmLocked.value) return
  const effort = toLlmEffort(value)
  if (effort === cfg.effort) return
  llmSwitching.value = true
  status.value = 'switching model'
  try {
    const next = await coach.setLlmConfig({ provider: cfg.provider, model: cfg.model, effort })
    if (!subscriptions.active) return
    llmConfig.value = next
    syncLlmContextWindow(next)
    await messageStore.compactAllIfNeeded()
    if (!subscriptions.active) return
    if (next.ready) {
      Message.success(`Switched to ${llmLabel(next.provider, next.model, next.effort)}`)
      status.value = 'idle'
    } else {
      status.value = 'login needed'
    }
  } finally {
    llmSwitching.value = false
    effortPickerVisible.value = false
  }
}

const loginActiveProvider = async (): Promise<void> => {
  const cfg = llmConfig.value
  if (!cfg || !activeLlmProviderAllowed.value || llmLoginProvider.value) return
  const next = await coach.loginLlm({ provider: cfg.provider, method: 'browser' })
  if (!subscriptions.active) return
  llmConfig.value = next
  syncLlmContextWindow(next)
}

// The Home renderer owns sidebar geometry. Ask its layout store to collapse the placeholder;
// main stays out of this renderer-to-renderer UI preference.
const closePanel = (): void => {
  onResizeEnd()
  xpcRenderer.broadcast('coach/sidebar-close', { ts: Date.now() })
}

const panelFocused = ref(false)
const resizing = ref(false)
let resizePointerId: number | null = null
let dragStartScreenX = 0
let dragStartWidth = 0

const sendWidth = (width: number | undefined, active: boolean): void => {
  xpcRenderer.broadcast('coach/sidebar-width', { width, resizing: active, ts: Date.now() })
}

const onResizeDown = (event: PointerEvent): void => {
  if (event.button !== 0 || resizing.value) return
  const target = event.currentTarget as HTMLElement | null
  if (!target) return
  // Capture belongs to the Chat view, which covers Home's DOM at this edge.
  target.setPointerCapture(event.pointerId)
  resizePointerId = event.pointerId
  dragStartWidth = window.innerWidth
  dragStartScreenX = event.screenX
  resizing.value = true
  event.preventDefault()
  sendWidth(undefined, true)
}

const onResizeMove = (event: PointerEvent): void => {
  if (!resizing.value || event.pointerId !== resizePointerId) return
  // The native view moves left as it grows; screen coordinates do not move with its origin.
  sendWidth(dragStartWidth + dragStartScreenX - event.screenX, true)
}

const onResizeEnd = (event?: PointerEvent): void => {
  if (!resizing.value || (event && event.pointerId !== resizePointerId)) return
  resizing.value = false
  resizePointerId = null
  sendWidth(undefined, false)
}

const onPanelFocus = (): void => { panelFocused.value = true }
const onPanelBlur = (): void => {
  panelFocused.value = false
}

onBeforeUnmount(() => {
  resetProtectedState()
  disposeMarkdownLinkTooltip?.()
  window.removeEventListener('focus', onPanelFocus)
  window.removeEventListener('blur', onPanelBlur)
  onResizeEnd()
})

const triggerInjectedSkill = async (trigger: InjectedSkillTrigger): Promise<void> => {
  const message = trigger.message?.trim()
  if (!message) return
  if (llmConfig.value && !activeLlmProviderAllowed.value) {
    Message.warning(i18nHelper.menuBar.maestro.providerUnavailable)
    return
  }
  channelStore.selectSource('cowork')
  await nextTick()
  if (!subscriptions.active) return
  const session = activeSession.value || (await channelStore.startFreshMaestroSession())
  if (!subscriptions.active) return
  if (!session || session.turn || session.archivedAt) {
    Message.warning('Maestro is busy. Try the injected skill again after the current turn finishes.')
    return
  }
  const reply = await messageStore.turnService.send(session.id, message)
  if (!subscriptions.active) return
  if (!reply || isRejection(reply) || !reply.ok) {
    Message.warning((reply && !isRejection(reply) && reply.text) || `Could not run ${trigger.skillTitle}`)
  }
}

const onChatReply = (reply: AgentReply): void => {
  status.value = reply.ok ? 'agent done' : 'agent failed'
}

const formatDebugDuration = (detail: unknown): string => {
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return ''
  const ms = Number((detail as { durationMs?: unknown }).durationMs)
  if (!Number.isFinite(ms) || ms < 0) return ''
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`
}

const formatDebugDetail = (detail: unknown): string => {
  if (detail === undefined || detail === null || detail === '') return ''
  if (typeof detail === 'string') return detail
  try {
    return JSON.stringify(detail, null, 2)
  } catch {
    return String(detail)
  }
}

const logCodexDebug = (event: CodexDebugEvent): void => {
  const duration = formatDebugDuration(event.detail)
  const label = `[coach:${event.scope}:${event.phase}${duration ? ` ${duration}` : ''}] ${event.message}`
  const detail = formatDebugDetail(event.detail)
  if (event.level === 'error') console.error(label, detail)
  else if (event.level === 'warn') console.warn(label, detail)
  else console.log(label, detail)
}

const loadControlConfig = async (): Promise<void> => {
  if (!subscriptions.active) return
  controlLoading.value = true
  controlLoadError.value = ''
  status.value = 'loading'
  try {
    const tabs = await coach.getTabs().catch(() => [] as TabInfo[])
    if (!subscriptions.active) return
    await channelStore.init(tabs)
    if (!subscriptions.active) return

    const cfg = await coach.getLlmConfig()
    if (!subscriptions.active) return
    llmConfig.value = cfg
    syncLlmContextWindow(cfg)
    await messageStore.compactAllIfNeeded()
    if (!subscriptions.active) return
    status.value = cfg.ready ? 'idle' : 'login needed'
  } catch (err) {
    if (!subscriptions.active) return
    const message = err instanceof Error ? err.message : String(err)
    controlLoadError.value = message || 'Failed to load control config'
    status.value = 'config failed'
  } finally {
    if (subscriptions.active) controlLoading.value = false
  }
}

onMounted(async () => {
  disposeMarkdownLinkTooltip = installMarkdownLinkTooltipCleanup()
  panelFocused.value = document.hasFocus()
  window.addEventListener('focus', onPanelFocus)
  window.addEventListener('blur', onPanelBlur)
  subscriptions.subscribe('coach/codex-log', (payload) => {
    logCodexDebug(payload.params as CodexDebugEvent)
  })
  subscriptions.subscribe('coach/tabs', (payload) => {
    void channelStore.syncOperationTabs((payload.params as TabInfo[]) || [])
  })
  subscriptions.subscribe('coach/codex-device', (payload) => {
    const info = payload.params as { userCode: string; verificationUri: string } | null
    if (!info) {
      Notification.remove('codex-device')
      return
    }
    Notification.info({
      id: 'codex-device',
      title: 'Device code',
      content: `Code ${info.userCode}`,
      duration: 0,
      closable: true
    })
  })
  subscriptions.subscribe('coach/llm-config', (payload) => {
    const cfg = payload.params as LlmConfig
    console.log('[coach control] llm config broadcast', { provider: cfg.provider, model: cfg.model, ready: cfg.ready })
    void applyLlmConfig(cfg)
  })
  subscriptions.subscribe('coach/llm-login-state', (payload) => {
    const state = payload.params as LlmLoginState
    llmLoginProvider.value = state?.loading ? state.provider : ''
  })
  subscriptions.subscribe('coach/agent-activity', (payload) => {
    messageStore.pushActivity(payload.params as AgentActivityStep)
  })
  subscriptions.subscribe('coach/agent-browser-session', (payload) => {
    agentBrowserStore.accept(payload.params as AgentBrowserSessionState)
  })
  subscriptions.subscribe('coach/agent-stream', (payload) => {
    messageStore.pushStream(payload.params as AgentStreamDelta)
  })
  subscriptions.subscribe('coach/agent-compaction', (payload) => {
    const state = payload.params as import('@shared/piCompaction.types').CompactionStatus & { sessionId: string }
    const session = messageStore.sessions.find(item => item.id === state.sessionId)
    if (!session) return
    {
      session.compacting = state.active
      session.compactionRetry = state.active && state.retry ? { ...state.retry, startedAt: Date.now() } : undefined
    }
    if (!state.active && state.errorMessage) messageStore.pushErrorCard(state.sessionId, new Error(state.errorMessage), { subtitle: 'Context compaction failed' })
  })
  subscriptions.subscribe('coach/agent-thinking', (payload) => {
    messageStore.pushThinking(payload.params as AgentThinkingState)
  })
  subscriptions.subscribe('coach/injected-skill-trigger', (payload) => {
    void triggerInjectedSkill(payload.params as InjectedSkillTrigger)
  })

  await loadControlConfig()
  if (!subscriptions.active) return
  // Task snapshots can contain pending confirmations from before a renderer reload. Bind/load the
  // chat session first so replay is idempotent and lands in its original session.
  if (channelStore.activeSession) await taskStore.init()
})
</script>

<template>
  <div class="control-app">
    <div
      name="maestroControl__resizeHandle"
      class="control-app__resize-handle"
      :class="{ 'control-app__resize-handle--resizing': resizing }"
      :title="i18nHelper.menuBar.maestro.resizePanel"
      :aria-label="i18nHelper.menuBar.maestro.resizePanel"
      @pointerdown="onResizeDown"
      @pointermove="onResizeMove"
      @pointerup="onResizeEnd"
      @pointercancel="onResizeEnd"
      @lostpointercapture="onResizeEnd"
    ></div>
    <div
      id="control-card"
      name="maestroControl__card"
      class="control-app__card"
      :class="{ 'control-app__card--focused': panelFocused }"
    >
      <div class="control-app__toolbar">
        <SessionTitle v-if="activeSession" :session="activeSession" />
        <span v-else class="control-app__session-placeholder">Maestro</span>

        <div class="control-app__toolbar-actions">
          <button
            name="control__header__close"
            type="button"
            class="control-app__close"
            :title="i18nHelper.menuBar.maestro.hidePanel"
            :aria-label="i18nHelper.menuBar.maestro.hidePanel"
            @click="closePanel"
          >
            <IconX :size="14" stroke="2" />
          </button>
        </div>
      </div>

      <div v-if="controlLoading" class="control-app__state">
        <Spin :loading="true" tip="Loading control config" />
      </div>
      <div v-else-if="controlLoadError" class="control-app__state">
        <div class="control-app__error">
          <div class="control-app__error-title">Failed to load control config</div>
          <div class="control-app__error-detail" :title="controlLoadError">{{ controlLoadError }}</div>
          <Button class="control-app__retry" size="mini" type="primary" @click="loadControlConfig">Retry</Button>
        </div>
      </div>
      <ChatPanel
        ref="chatPanelRef"
        v-else-if="activeSession"
        :key="activeSession.id"
        :session="activeSession"
        :send-disabled="!llmAvailable || llmLoginLoading"
        @sent="onChatReply"
      >
        <template #before-composer>
          <ChatConfirmSheet :session="activeSession" />
          <!-- 拍板卡:与确认操作面同一条规矩 —— 挡住流程的问题必须在任意滚动位置都能一步点到,
               所以放在滚动容器之外(docs/features/agent-decision-sheet.md)。 -->
          <DecisionSheet :session="activeSession" />
          <WorkflowTaskBar :session-id="activeSession.id" />
          <!-- 状态条已搬进消息列表末尾(由 ChatPanel 经 MessageList 的 tail 插槽渲染),
               见 areas/agent-runtime/chat/decision/manual-decision.html #3。 -->
          <div
            v-if="llmConfig && !activeLlmProviderAllowed"
            name="control__llm__unavailable"
            class="control-app__login-card"
            role="status"
          >
            <div class="control-app__login-message">{{ i18nHelper.menuBar.maestro.providerUnavailable }}</div>
          </div>
          <div
            v-else-if="needsLlmLogin"
            name="control__llm__login_card"
            class="control-app__login-card"
          >
            <div class="control-app__login-message">
              {{ `Sign in to ${activeProviderLabel} to use this model.` }}
            </div>
            <Button size="small" type="primary" :loading="llmLoginLoading" :disabled="Boolean(llmLoginProvider && !llmLoginLoading)" @click="loginActiveProvider">
              <template #icon><IconLogin2 :size="15" /></template>
              Login
            </Button>
          </div>
        </template>
        <template #before-actions>
          <div
            name="control__llm"
            v-if="llmConfig && llmConfig.presets.length"
            class="control-app__llm"
            :title="controlLlmTitle"
          >
            <Trigger
              v-model:popup-visible="providerPickerVisible"
              trigger="click"
              position="top"
              :popup-offset="6"
              :disabled="llmLocked"
              :unmount-on-close="true"
              :content-style="{ padding: '0' }"
            >
              <button
                name="control__llm__provider_button"
                type="button"
                class="control-app__text-button"
                :disabled="llmLocked"
                :title="`Provider: ${activeProviderLabel}`"
              >
                {{ activeProviderLabel }}
              </button>
              <template #content>
                <div name="control__llm__provider_popup" class="control-app__popup control-app__popup--provider">
                  <button
                    v-for="group in llmProviderGroups"
                    :key="group.provider"
                    name="control__llm__provider_option"
                    type="button"
                    class="control-app__popup-option control-app__popup-option--split"
                    :class="{ 'control-app__popup-option--active': group.provider === llmConfig.provider }"
                    :disabled="llmLocked"
                    @click="onSwitchLlmProvider(group.provider)"
                  >
                    <span class="control-app__option-label">{{ group.label }}</span>
                  </button>
                </div>
              </template>
            </Trigger>
            <Trigger
              v-model:popup-visible="modelPickerVisible"
              trigger="click"
              position="top"
              :popup-offset="6"
              :disabled="llmLocked || !activeLlmProviderAllowed"
              :unmount-on-close="true"
              :content-style="{ padding: '0' }"
            >
              <button
                name="control__llm__model_button"
                type="button"
                class="control-app__text-button"
                :disabled="llmLocked || !activeLlmProviderAllowed"
                :title="controlLlmTitle"
              >
                {{ activeModelLabel }}
              </button>
              <template #content>
                <div name="control__llm__model_popup" class="control-app__popup control-app__popup--model">
                  <button
                    v-for="model in activeLlmGroup?.models || []"
                    :key="model.model"
                    name="control__llm__model_option"
                    type="button"
                    class="control-app__popup-option control-app__popup-option--split"
                    :class="{ 'control-app__popup-option--active': model.model === llmConfig.model }"
                    :disabled="llmLocked"
                    @click="onSwitchLlmModel(model)"
                  >
                    <span class="control-app__option-label">{{ model.shortLabel || model.label }}</span>
                    <span class="control-app__option-meta">{{ model.contextLengthLabel }}</span>
                  </button>
                </div>
              </template>
            </Trigger>
            <Trigger
              v-model:popup-visible="effortPickerVisible"
              trigger="click"
              position="top"
              :popup-offset="6"
              :disabled="llmLocked || llmEffortDisabled"
              :unmount-on-close="true"
              :content-style="{ padding: '0' }"
            >
              <button
                name="control__llm__effort_button"
                type="button"
                class="control-app__text-button control-app__text-button--effort"
                :disabled="llmLocked || llmEffortDisabled"
                :title="`Effort: ${activeLlmEffortLabel}`"
              >
                {{ activeLlmEffortLabel || llmEffortValue }}
              </button>
              <template #content>
                <div class="control-app__popup control-app__popup--effort">
                  <button
                    v-for="effort in activeLlmEfforts"
                    :key="effort.id"
                    type="button"
                    class="control-app__popup-option"
                    :class="{ 'control-app__popup-option--active': effort.id === llmEffortValue }"
                    :disabled="llmLocked"
                    @click="onSwitchLlmEffort(effort.id)"
                  >
                    {{ effort.label }}
                  </button>
                </div>
              </template>
            </Trigger>
          </div>
        </template>
      </ChatPanel>
      <SessionsDrawer @close="focusComposer" />
      <SessionSearchModal @close="focusComposer" />
    </div>
  </div>

</template>
