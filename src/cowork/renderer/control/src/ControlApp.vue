<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { Button, Message, Notification, Spin, Trigger } from '@arco-design/web-vue'
import { IconBrandWhatsapp, IconLogin2, IconPlayerPlay, IconSparkle2 } from '@tabler/icons-vue'
import { createXpcRendererEmitter, xpcRenderer } from 'electron-xpc/renderer'
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
} from '@cowork-shared/coach.api'
import { AUTH_BROADCAST } from '@cowork-shared/session.api'
import type { AuthBroadcast } from '@cowork-shared/session.api'
import ChatPanel from './ChatPanel.vue'
import { channelStore } from './store/channel.store'
import { messageStore } from './store/message.store'

const coach = createXpcRendererEmitter<CoachXpcContract>('CoachXpcHandler')

const status = ref('idle')
const demoOpening = ref(false)
const demoMenuVisible = ref(false)
const compactDemoRunning = ref(false)
const compactDemoRunId = ref(0)
const controlLoading = ref(true)
const controlLoadError = ref('')
const llmSwitching = ref(false)
const llmLoginProvider = ref('')
const llmConfig = ref<LlmConfig | null>(null)
const providerPickerVisible = ref(false)
const modelPickerVisible = ref(false)
const effortPickerVisible = ref(false)
const activeSession = computed(() => channelStore.activeSession)
const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
const COMPACT_DEMO_CONTEXT_LIMIT_K = 1
const COMPACT_DEMO_CONTEXT_LABEL = '1K'
const COMPACT_DEMO_COMPRESSION_REMAINING_PERCENT = 10

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

const firstEffort = (model: LlmTarget): LlmEffort => model.efforts[0]?.id || model.effort

const getLlmProviderGroups = (cfg: LlmConfig | null): ControlLlmProviderGroup[] => {
  if (!cfg) return []
  const groups: ControlLlmProviderGroup[] = cfg.providers.map((provider) => ({
    provider: provider.provider,
    label: provider.label,
    ready: provider.ready,
    models: []
  }))
  for (const preset of cfg.presets) {
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
const activeLlmGroup = computed(() => llmProviderGroups.value.find((item) => item.provider === llmConfig.value?.provider) || llmProviderGroups.value[0])
const activeLlmPreset = computed(() =>
  llmConfig.value?.presets.find((item) => item.provider === llmConfig.value?.provider && item.model === llmConfig.value?.model)
)
const activeLlmEfforts = computed(() => activeLlmPreset.value?.efforts || [])
const activeLlmProvider = computed(() => llmConfig.value?.providers.find((item) => item.provider === llmConfig.value?.provider))
const activeLlmEffortLabel = computed(() => {
  const effort = llmConfig.value?.effort
  if (!effort) return ''
  return activeLlmPreset.value?.efforts.find((item) => item.id === effort)?.label || effort
})
const llmEffortValue = computed(() => llmConfig.value?.effort || activeLlmPreset.value?.effort || 'default')
const llmEffortDisabled = computed(() => activeLlmEfforts.value.length <= 1 && activeLlmEfforts.value[0]?.id === 'default')
const llmAvailable = computed(() =>
  Boolean(llmConfig.value?.ready && activeLlmPreset.value?.efforts.some((item) => item.id === llmConfig.value?.effort))
)
const needsLlmLogin = computed(() => Boolean(llmConfig.value && activeLlmPreset.value && !activeLlmProvider.value?.ready))
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
  llmConfig.value = cfg
  syncLlmContextWindow(cfg)
  await messageStore.compactAllIfNeeded()
  status.value = cfg.ready ? 'idle' : 'login needed'
}

const onSwitchLlmTarget = async (
  target: { provider: string; model: string; effort: LlmEffort },
  closePicker: 'provider' | 'model' | false = false
): Promise<void> => {
  if (!target || llmSwitching.value) return
  llmSwitching.value = true
  status.value = 'switching model'
  try {
    const cfg = await coach.setLlmConfig(target)
    llmConfig.value = cfg
    syncLlmContextWindow(cfg)
    await messageStore.compactAllIfNeeded()
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
  if (!cfg || llmSwitching.value) return
  const effort = toLlmEffort(value)
  if (effort === cfg.effort) return
  llmSwitching.value = true
  status.value = 'switching model'
  try {
    const next = await coach.setLlmConfig({ provider: cfg.provider, model: cfg.model, effort })
    llmConfig.value = next
    syncLlmContextWindow(next)
    await messageStore.compactAllIfNeeded()
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
  if (!cfg || llmLoginProvider.value) return
  const next = await coach.loginLlm({ provider: cfg.provider, method: 'browser' })
  llmConfig.value = next
  syncLlmContextWindow(next)
}

const openDemo = async (): Promise<void> => {
  if (demoOpening.value) return
  demoMenuVisible.value = false
  demoOpening.value = true
  status.value = 'demo'
  try {
    await coach.openDemo()
  } finally {
    demoOpening.value = false
    status.value = 'idle'
  }
}

const compactDemoMessage = (turn: number): string =>
  [
    `Compact demo real-chat turn ${turn}.`,
    'This is an intentional real model-token load test for recursive context compaction.',
    'Do not use browser tools and do not interact with the page. Reply in chat only.',
    'Produce a detailed, structured English response of about 900-1200 words if possible.',
    'Use harmless non-sensitive demo content only. Include the marker CompactDemoRealTurn-' + turn + ' in each section.',
    'Sections to include: Current demo state, Decisions to preserve, Boundary facts for future compaction, Next-turn continuity notes.'
  ].join('\n')

const stopCompactDemo = async (): Promise<void> => {
  compactDemoRunning.value = false
  compactDemoRunId.value += 1
  const session = activeSession.value
  if (session?.busy) await messageStore.stop(session.id).catch(() => undefined)
  if (llmConfig.value) syncLlmContextWindow(llmConfig.value)
  status.value = llmConfig.value?.ready ? 'idle' : 'login needed'
}

const startCompactDemo = async (): Promise<void> => {
  if (compactDemoRunning.value) {
    await stopCompactDemo()
    return
  }
  if (!llmAvailable.value) {
    Message.warning('Sign in to the active model first.')
    return
  }

  demoMenuVisible.value = false
  const session = await channelStore.startFreshCoworkSession('Compact demo')
  if (!session) {
    Message.warning('Wait for the current Cowork turn to finish first.')
    return
  }
  await nextTick()

  compactDemoRunning.value = true
  const runId = compactDemoRunId.value + 1
  compactDemoRunId.value = runId
  status.value = 'compact demo'
  messageStore.setContextWindow(COMPACT_DEMO_CONTEXT_LIMIT_K, COMPACT_DEMO_CONTEXT_LABEL, COMPACT_DEMO_COMPRESSION_REMAINING_PERCENT)

  try {
    let turn = 1
    while (compactDemoRunning.value && compactDemoRunId.value === runId) {
      const current = activeSession.value
      if (!current || current.source !== 'cowork' || current.archivedAt) break
      const reply = await messageStore.send(current.id, compactDemoMessage(turn))
      if (!reply || !reply.ok) {
        Message.warning(reply?.text || 'Compact demo stopped because the model did not return a successful reply.')
        break
      }
      turn += 1
      await wait(500)
    }
  } finally {
    if (compactDemoRunId.value === runId) {
      compactDemoRunning.value = false
      if (llmConfig.value) syncLlmContextWindow(llmConfig.value)
      status.value = llmConfig.value?.ready ? 'idle' : 'login needed'
    }
  }
}

const triggerInjectedSkill = async (trigger: InjectedSkillTrigger): Promise<void> => {
  const message = trigger.message?.trim()
  if (!message) return
  channelStore.selectSource('cowork')
  await nextTick()
  const session = activeSession.value || (await channelStore.startFreshCoworkSession('Cowork'))
  if (!session || session.busy || session.archivedAt) {
    Message.warning('Cowork is busy. Try the injected skill again after the current turn finishes.')
    return
  }
  const reply = await messageStore.send(session.id, message)
  if (!reply?.ok) Message.warning(reply?.text || `Could not run ${trigger.skillTitle}`)
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
  controlLoading.value = true
  controlLoadError.value = ''
  status.value = 'loading'
  try {
    const tabs = await coach.getTabs().catch(() => [] as TabInfo[])
    await channelStore.init(tabs)

    const cfg = await coach.getLlmConfig()
    llmConfig.value = cfg
    syncLlmContextWindow(cfg)
    await messageStore.compactAllIfNeeded()
    status.value = cfg.ready ? 'idle' : 'login needed'
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    controlLoadError.value = message || 'Failed to load control config'
    status.value = 'config failed'
  } finally {
    controlLoading.value = false
  }
}

onMounted(async () => {
  xpcRenderer.subscribe('coach/codex-log', (payload) => {
    logCodexDebug(payload.params as CodexDebugEvent)
  })
  xpcRenderer.subscribe('coach/tabs', (payload) => {
    void channelStore.syncOperationTabs((payload.params as TabInfo[]) || [])
  })
  xpcRenderer.subscribe('coach/codex-device', (payload) => {
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
  xpcRenderer.subscribe('coach/llm-config', (payload) => {
    const cfg = payload.params as LlmConfig
    console.log('[coach control] llm config broadcast', { provider: cfg.provider, model: cfg.model, ready: cfg.ready })
    void applyLlmConfig(cfg)
  })
  xpcRenderer.subscribe('coach/llm-login-state', (payload) => {
    const state = payload.params as LlmLoginState
    llmLoginProvider.value = state?.loading ? state.provider : ''
  })
  xpcRenderer.subscribe(AUTH_BROADCAST, (payload) => {
    const auth = payload.params as AuthBroadcast
    console.log('[coach control] auth broadcast', {
      loggedIn: Boolean(auth?.loggedIn),
      hasSession: Boolean(auth?.session?.jwt_token),
      region: auth?.session?.region || ''
    })
    void coach
      .getLlmConfig()
      .then((cfg) => {
        console.log('[coach control] refreshed llm after auth', { provider: cfg.provider, model: cfg.model, ready: cfg.ready })
        return applyLlmConfig(cfg)
      })
      .catch((err) => console.error('[coach control] refresh llm after auth failed:', err))
  })
  xpcRenderer.subscribe('coach/agent-activity', (payload) => {
    messageStore.pushActivity(payload.params as AgentActivityStep)
  })
  xpcRenderer.subscribe('coach/agent-stream', (payload) => {
    messageStore.pushStream(payload.params as AgentStreamDelta)
  })
  xpcRenderer.subscribe('coach/agent-thinking', (payload) => {
    messageStore.pushThinking(payload.params as AgentThinkingState)
  })
  xpcRenderer.subscribe('coach/injected-skill-trigger', (payload) => {
    void triggerInjectedSkill(payload.params as InjectedSkillTrigger)
  })

  await loadControlConfig()
})
</script>

<template>
  <div class="coach-control flex min-h-0 w-full flex-1 flex-col overflow-hidden bg-[#f8fafc] p-3">
    <div id="control-card" class="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl bg-white p-2">
      <div class="flex shrink-0 items-center justify-between gap-2 bg-white pb-2">
        <div class="flex min-w-0 items-center gap-1 rounded-full bg-[#edf2f7] p-1">
          <button
            type="button"
            class="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-semibold transition"
            :class="channelStore.activeSource === 'cowork' ? 'bg-white text-[#165dff] shadow-sm' : 'text-gray-500 hover:text-gray-800'"
            :disabled="controlLoading"
            @click="channelStore.selectSource('cowork')"
          >
            <IconSparkle2 :size="14" />
            <span>Cowork</span>
          </button>
          <button
            type="button"
            class="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-semibold transition"
            :class="channelStore.activeSource === 'connector' ? 'bg-white text-[#165dff] shadow-sm' : 'text-gray-500 hover:text-gray-800'"
            :disabled="controlLoading"
            @click="channelStore.selectSource('connector')"
          >
            <IconBrandWhatsapp :size="14" />
            <span>Connector</span>
          </button>
        </div>

        <div class="flex min-w-0 items-center gap-1.5">
          <Trigger
            v-model:popup-visible="demoMenuVisible"
            trigger="click"
            position="bottom"
            :popup-offset="6"
            :disabled="controlLoading"
            :unmount-on-close="true"
            :content-style="{ padding: '0' }"
          >
            <button
              name="control__demo__button"
              type="button"
              class="control-llm-text-btn gap-1.5"
              :disabled="controlLoading || demoOpening"
              title="Demo"
            >
              <IconPlayerPlay :size="14" />
              <span>{{ demoOpening ? 'Opening' : 'Demo' }}</span>
            </button>
            <template #content>
              <div name="control__demo__menu" class="w-[156px] rounded-lg bg-white p-1.5 text-[12px] shadow-lg ring-1 ring-black/10">
                <button
                  name="control__demo__booking"
                  type="button"
                  class="mb-1 flex h-8 w-full items-center rounded-md px-2 text-left font-semibold text-gray-700 transition hover:bg-black/5"
                  :disabled="demoOpening"
                  @click="openDemo"
                >
                  Booking
                </button>
                <button
                  name="control__demo__compact"
                  type="button"
                  class="flex h-8 w-full items-center rounded-md px-2 text-left font-semibold transition hover:bg-black/5"
                  :class="compactDemoRunning ? 'text-red-600' : 'text-gray-700'"
                  @click="startCompactDemo"
                >
                  {{ compactDemoRunning ? 'Stop compacting' : 'Compact' }}
                </button>
              </div>
            </template>
          </Trigger>
        </div>
      </div>

      <div v-if="controlLoading" class="flex min-h-0 flex-1 items-center justify-center bg-white">
        <Spin :loading="true" tip="Loading control config" />
      </div>
      <div v-else-if="controlLoadError" class="flex min-h-0 flex-1 items-center justify-center bg-white">
        <div class="rounded-lg bg-[#f8fafc] px-6 py-5 text-center">
          <div class="text-[12px] font-semibold text-red-600">Failed to load control config</div>
          <div class="mt-1 max-w-[260px] truncate text-[11px] text-gray-400" :title="controlLoadError">{{ controlLoadError }}</div>
          <Button class="mt-3" size="mini" type="primary" @click="loadControlConfig">Retry</Button>
        </div>
      </div>
      <ChatPanel
        v-else-if="channelStore.activeSource === 'cowork' && activeSession"
        :key="activeSession.id"
        :session="activeSession"
        :send-disabled="!llmAvailable || llmLoginLoading"
        @sent="onChatReply"
      >
        <template #before-composer>
          <div
            v-if="needsLlmLogin"
            name="control__llm__login_card"
            class="mb-2 flex min-h-10 items-center justify-between gap-3 rounded-lg bg-[#f8fafc] px-3 py-2"
          >
            <div class="min-w-0 truncate text-[12px] font-semibold text-gray-600">
              Sign in to {{ activeProviderLabel }} to use this model.
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
            class="flex min-w-0 items-center gap-1.5"
            :title="controlLlmTitle"
          >
            <Trigger
              v-model:popup-visible="providerPickerVisible"
              trigger="click"
              position="top"
              :popup-offset="6"
              :disabled="llmSwitching"
              :unmount-on-close="true"
              :content-style="{ padding: '0' }"
            >
              <button
                name="control__llm__provider_button"
                type="button"
                class="control-llm-text-btn"
                :disabled="llmSwitching"
                :title="`Provider: ${activeProviderLabel}`"
              >
                {{ activeProviderLabel }}
              </button>
              <template #content>
                <div name="control__llm__provider_popup" class="w-[136px] rounded-lg bg-white p-1.5 text-[12px] shadow-lg ring-1 ring-black/10">
                  <button
                    v-for="group in llmProviderGroups"
                    :key="group.provider"
                    name="control__llm__provider_option"
                    type="button"
                    class="mb-1 flex h-8 w-full items-center justify-between rounded-md px-2 text-left font-semibold transition hover:bg-black/5"
                    :class="group.provider === llmConfig.provider ? 'bg-[#edf4ff] text-[#165dff]' : 'text-gray-600'"
                    :disabled="llmSwitching"
                    @click="onSwitchLlmProvider(group.provider)"
                  >
                    <span class="truncate">{{ group.label }}</span>
                  </button>
                </div>
              </template>
            </Trigger>
            <Trigger
              v-model:popup-visible="modelPickerVisible"
              trigger="click"
              position="top"
              :popup-offset="6"
              :disabled="llmSwitching"
              :unmount-on-close="true"
              :content-style="{ padding: '0' }"
            >
              <button
                name="control__llm__model_button"
                type="button"
                class="control-llm-text-btn"
                :disabled="llmSwitching"
                :title="controlLlmTitle"
              >
                {{ activeModelLabel }}
              </button>
              <template #content>
                <div name="control__llm__model_popup" class="w-[168px] rounded-lg bg-white p-1.5 text-[12px] shadow-lg ring-1 ring-black/10">
                  <button
                    v-for="model in activeLlmGroup?.models || []"
                    :key="model.model"
                    name="control__llm__model_option"
                    type="button"
                    class="mb-1 flex h-8 w-full items-center justify-between rounded-md px-2 text-left transition hover:bg-black/5"
                    :class="model.model === llmConfig.model ? 'bg-[#edf4ff] text-[#165dff]' : 'text-gray-700'"
                    :disabled="llmSwitching"
                    @click="onSwitchLlmModel(model)"
                  >
                    <span class="truncate font-semibold">{{ model.shortLabel || model.label }}</span>
                    <span class="ml-2 shrink-0 text-[10px] font-semibold text-gray-400">{{ model.contextLengthLabel }}</span>
                  </button>
                </div>
              </template>
            </Trigger>
            <Trigger
              v-model:popup-visible="effortPickerVisible"
              trigger="click"
              position="top"
              :popup-offset="6"
              :disabled="llmSwitching || llmEffortDisabled"
              :unmount-on-close="true"
              :content-style="{ padding: '0' }"
            >
              <button
                name="control__llm__effort_button"
                type="button"
                class="control-llm-text-btn max-w-[76px]"
                :disabled="llmSwitching || llmEffortDisabled"
                :title="`Effort: ${activeLlmEffortLabel}`"
              >
                {{ activeLlmEffortLabel || llmEffortValue }}
              </button>
              <template #content>
                <div class="w-[120px] rounded-lg bg-white p-1.5 text-[12px] shadow-lg ring-1 ring-black/10">
                  <button
                    v-for="effort in activeLlmEfforts"
                    :key="effort.id"
                    type="button"
                    class="mb-1 flex h-8 w-full items-center rounded-md px-2 text-left font-semibold transition hover:bg-black/5"
                    :class="effort.id === llmEffortValue ? 'bg-[#edf4ff] text-[#165dff]' : 'text-gray-700'"
                    :disabled="llmSwitching"
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
      <div v-else class="flex min-h-0 flex-1 items-center justify-center bg-white">
        <div class="rounded-lg bg-[#f8fafc] px-6 py-5 text-center text-[12px] font-semibold text-gray-400">
          Connector
        </div>
      </div>
    </div>
  </div>

</template>
