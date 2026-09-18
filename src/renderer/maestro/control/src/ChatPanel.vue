<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { IconDotsVertical, IconFolderOpen, IconFolderSearch, IconListDetails, IconPaperclip, IconPlayerStop, IconPlus, IconSend2, IconX } from '@tabler/icons-vue'
import AttachmentCard from './AttachmentCard.vue'
import { Button, Dropdown, Doption, Input, Message, Modal, Tooltip } from '@arco-design/web-vue'
import { createXpcRendererEmitter } from 'electron-xpc/renderer'
import { CONTEXT_GRAPH_MATCH_HEAD_CHARS } from '@maestro-shared/coach.api'
import { MAESTRO_ONLY_PREVIEW_APP_NAME } from '@maestro-shared/compositeTab.identity'
import type { AgentReply } from '@maestro-shared/coach.api'
import type { CoachXpcContract } from '@maestro-shared/coach.api'
import type { ContextGraphView } from '@maestro-shared/coach.api'
import ContextGraphModal from './ContextGraphModal.vue'
import WorkflowTaskBar from './WorkflowTaskBar.vue'
// Session tabs 暂时隐藏(Ral 2026-09-18);模板里那行也一并注释掉了。留着 import 会因
// `noUnusedLocals` 变成编译错误,所以两处必须一起动。
// import AgentBrowserTabs from './AgentBrowserTabs.vue'
import { sessionActions } from './store/sessionActions.store'
import { i18nHelper } from '@renderer/common/i18n/i18n.helper'
import IconBtn from '../../../common/components/IconBtn/IconBtn.vue'
import ChatErrorModal from './task/ChatErrorModal.vue'
import MessageList from './MessageList.vue'
import SlashMenu from './SlashMenu.vue'
import { ShortcutStore, skillShortcutRows, slashTokenAt, parseCompactCommand } from './store/shortcut.store'
import { channelStore } from './store/channel.store'
import { messageStore } from './store/message.store'
import type { ShortcutSkill } from './store/shortcut.type'
import type { ChatAttachment, MessageSession } from './store/message.type'
import { isRejection } from './store/turn.service'
import { parseWorkflowCommand } from '@shared/agentWorkflow.api'
import { workflowStore } from './store/workflow.store'
import { executeWorkflowCommand } from './workflow.command'
import './ChatPanel.less'

const tasksVisible = ref(false)
const coach = createXpcRendererEmitter<CoachXpcContract>('CoachXpcHandler')
const props = defineProps<{ session: MessageSession; sendDisabled?: boolean }>()
const emit = defineEmits<{ sent: [reply: AgentReply] }>()
// 选中的技能。挂载入口是 `/` 面板的 skill 条目(maestro-slash-commands.md「Skills in the slash
// menu」),不再有独立的选择器面板;这枚状态只负责「下一次发送会带哪个技能」。
const selectedSkill = ref<ShortcutSkill | null>(props.session.detail.draft?.skill ?? null)
let skillCatalogRequest = 0
/**
 * 技能目录 → `/` 面板的 skill 条目。拉取留在面板这一侧,`ShortcutStore` 仍然只有一条 `import type`。
 * 只列**能用的**:坏包、未归属、停用的不进面板 —— 诊断在 Workbench,不在输入框。
 * 拉取失败不弹错:技能块空着,命令块照常工作(无机构 / 离线不该阻塞正常功能)。
 */
async function loadSkillShortcuts(): Promise<void> {
  const request = ++skillCatalogRequest
  const sessionId = props.session.id
  try {
    const snapshot = await coach.skillCatalog({ sessionId })
    if (request !== skillCatalogRequest || props.session.id !== sessionId) return
    shortcutStore.registerSkills(skillShortcutRows(snapshot.skills, skill =>
      `${skillLayerLabel(skill.layer)} · ${skill.path}${skill.allowImplicitInvocation === false ? ` · ${i18nHelper.maestroControl.chat.skillExplicitOnly}` : ''}`))
  } catch {
    if (request === skillCatalogRequest) shortcutStore.registerSkills([])
  }
}

const input = ref(props.session.detail.draft?.text || '')
// Composer attachments: picked/dropped files, kept as {name, absolute path}. On send the
// paths (never bytes) are registered with main; the agent reads them via read_file.
const selectedFiles = ref<ChatAttachment[]>(props.session.detail.draft?.files.slice() || [])
const fileInput = ref<HTMLInputElement | null>(null)
const composerRef = ref<HTMLTextAreaElement | null>(null)
const panelRef = ref<HTMLElement | null>(null)
const composerCaret = ref(0)
// 数组顺序只是阅读顺序(按加入时间):面板显示时 `ShortcutStore.matches` 按命令名 ASCII 重排,
// 所以新命令追加在末尾就行,不必为了菜单里的位置去插队。
const shortcutStore = reactive(new ShortcutStore([
  { kind: 'command', name: '/test_auto_compact', hint: 'Test automatic compaction in an isolated conversation' },
  { kind: 'command', name: '/compact', hint: 'Compact now; optional focus instructions' },
  { kind: 'command', name: '/clear', get hint() { return i18nHelper.maestroControl.chat.slashClear } },
  { kind: 'command', name: '/view_context', get hint() { return i18nHelper.maestroControl.chat.slashViewContext } },
  { kind: 'command', name: '/copy_session_path', get hint() { return i18nHelper.maestroControl.chat.slashCopySessionPath } },
  { kind: 'command', name: '/test_show_error', get hint() { return i18nHelper.maestroControl.chat.slashTestShowError } },
  { kind: 'command', name: '/view_context_graph', get hint() { return i18nHelper.maestroControl.chat.slashViewContextGraph } },
  { kind: 'command', name: '/workflow', get hint() { return i18nHelper.workflow.commandHint } }
]))
const slashToken = computed(() => slashTokenAt(input.value, composerCaret.value))
const slashVisible = computed(() => shortcutStore.open && shortcutStore.matches.length > 0)
// `/view_context_graph` 读回来的结构图。非空 = 弹窗开着;关闭就是置 null,没有第二个可见性开关。
const contextGraph = ref<ContextGraphView | null>(null)
let draftRevision = 0
let composerDisposed = false
let newChatPending = false
const workflowCommandPending = ref(false)
watch(input, () => { draftRevision += 1 }, { flush: 'sync' })
watch([input, selectedFiles, selectedSkill], () => {
  props.session.detail.draft = { text: input.value, files: selectedFiles.value.slice(), skill: selectedSkill.value ? { ...selectedSkill.value } : undefined }
}, { deep: true, flush: 'sync' })
watch([input, composerCaret], () => shortcutStore.update(slashToken.value), { flush: 'post' })
watch(() => props.session.id, () => { draftRevision += 1; shortcutStore.close(); selectedSkill.value = null }, { flush: 'sync' })
onBeforeUnmount(() => { composerDisposed = true; shortcutStore.close() })
const shortcut = (key: string): string => `${navigator.platform.toLowerCase().includes('mac') ? '⌘' : 'Ctrl+'}${key}`

// i18n 文案里的 `{count}` 占位替换。不用 `$t()` / `useI18n()` —— 本项目一律走 i18nHelper。
const withCount = (copy: string, count: number): string => copy.replace('{count}', String(count))
const turnLocked = computed(() => Boolean(props.session.turn))
// 照搬 cowork 同名判据(ChatPanel.vue `stopEnabled`)——Escape-停止要知道"现在真有能停的东西",
// 不是只看 `turnLocked`(那条连 compacting-without-a-turn 的情况都不算)。
const stopEnabled = computed(() => Boolean(props.session.compacting || (props.session.turn && (!props.session.turn.aborting || props.session.turn.stopError))))
const skillLayerLabel = (layer?: string): string => layer === 'workspace' ? i18nHelper.maestroControl.chat.skillWorkspace : layer === 'institution' ? i18nHelper.maestroControl.chat.skillInstitution : i18nHelper.maestroControl.chat.skillGlobal

const workspace = computed(() => props.session.detail.workspace)
// 目录随会话(以及它的工作区)变:工作区层的技能只属于那个目录。
watch(() => [props.session.id, workspace.value?.path], () => { void loadSkillShortcuts() }, { immediate: true })
const workspaceLabel = computed(() => workspace.value?.name || 'Workspace')
const workspaceTitle = computed(() => workspace.value?.path || 'Set workspace')
const openWorkspaceLabel = computed(() =>
  i18nHelper.maestroControl.chat.openWorkspaceInPreview.replace('{app}', MAESTRO_ONLY_PREVIEW_APP_NAME)
)


function resizeComposer(): void {
  const el = composerRef.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(Math.max(el.scrollHeight, 44), 120)}px`
}

function resetComposerHeight(): void {
  const el = composerRef.value
  if (!el) return
  el.style.height = '44px'
}

async function send(): Promise<void> {
  if ((shortcutStore.pending && !props.session.compacting) || workflowCommandPending.value) return
  const compactCommand = parseCompactCommand(input.value)
  if (compactCommand && !slashVisible.value) {
    const sessionId = props.session.id
    input.value = ''
    shortcutStore.pending = true
    try { await compactCurrentSession(sessionId, compactCommand.instructions) }
    catch (error) { Message.error(error instanceof Error ? error.message : String(error)) }
    finally { shortcutStore.pending = false }
    return
  }
  const testCommand = /^\/test_auto_compact(?:[ \t]+([^\r\n]+))?$/.exec(input.value.trim())
  if (testCommand && !slashVisible.value) {
    const filePath = testCommand[1]?.trim().replace(/^(["'])(.*)\1$/, '$2')
    input.value = ''
    try { await runAutoCompactionTest(props.session.id, filePath) } catch (error) { Message.error(error instanceof Error ? error.message : String(error)) }
    return
  }
  if (parseWorkflowCommand(input.value)) { await submitWorkflowCommand(); return }
  if (slashVisible.value) { await commitShortcut(); return }
  const message = input.value.trim()
  // Text is REQUIRED to send, even when files are attached.
  if (!message || props.sendDisabled || props.session.turn?.aborting) return
  if (messageStore.turnService.busyElsewhere(props.session.id)) {
    Modal.warning({
      title: i18nHelper.maestroControl.chat.busyTitle,
      content: i18nHelper.maestroControl.chat.busyContent,
      okText: i18nHelper.maestroControl.chat.gotIt
    })
    return
  }
  const steering = Boolean(props.session.turn)
  const files = !steering && selectedFiles.value.length ? selectedFiles.value.slice() : undefined
  const sentSkill = selectedSkill.value
  const context = sentSkill ? { ...messageStore.buildAgentContext(props.session, undefined, files?.map(file => file.path)), selectedSkillRef: sentSkill.reference } : undefined
  input.value = ''
  selectedSkill.value = null
  if (!steering) selectedFiles.value = []
  await nextTick()
  if (composerDisposed) return
  resetComposerHeight()
  const reply = await messageStore.turnService.send(props.session.id, message, files, undefined, context)
  if (composerDisposed) return
  if (reply && !isRejection(reply)) {
    if (!reply.mergedIntoTurn) emit('sent', reply)
    return
  }
  if (!input.value.trim()) {
    input.value = message
    if (files?.length) selectedFiles.value = files.slice()
    selectedSkill.value = sentSkill
    await nextTick()
    resizeComposer()
  }
  Modal.warning({
    title: i18nHelper.maestroControl.chat.messageNotSentTitle,
    content: i18nHelper.maestroControl.chat.messageNotSentContent,
    okText: i18nHelper.maestroControl.chat.gotIt
  })
}

async function runWorkflowCommand(text: string): Promise<void> {
  const session = props.session
  await executeWorkflowCommand(text, {
    sessionId: session.id,
    hasAttachments: selectedFiles.value.length > 0,
    assertCanStart: () => {
      if (composerDisposed || props.session.id !== session.id || props.sendDisabled || session.archivedAt) {
        throw new Error(i18nHelper.workflow.commandBusy)
      }
    },
    refreshWorkspace: async () => { await messageStore.refreshWorkspace(session.id); return session.detail.workspace?.path },
    note: text => messageStore.pushLocalNote(session.id, text)
  })
}

async function submitWorkflowCommand(): Promise<void> {
  if (workflowCommandPending.value) return
  const draft = input.value
  const sessionId = props.session.id
  const revision = draftRevision
  workflowCommandPending.value = true
  shortcutStore.close()
  try {
    await runWorkflowCommand(draft)
    if (!composerDisposed && props.session.id === sessionId && draftRevision === revision) {
      input.value = ''
      await nextTick()
      resetComposerHeight()
    }
  } catch (error) {
    if (composerDisposed) return
    const message = error instanceof Error ? error.message : String(error)
    messageStore.pushLocalNote(sessionId, message)
    Message.error(message)
  } finally { workflowCommandPending.value = false }
}

function pickFiles(): void {
  if (turnLocked.value || props.session.archivedAt) return
  fileInput.value?.click()
}

// Add files by ABSOLUTE PATH only (resolved via the preload bridge — webUtils, no bytes
// read). On send the paths are registered with main and the agent reads them via read_file.
function addFiles(files: File[]): void {
  const added: string[] = []
  for (const file of files) {
    const path = window.fileBridge?.getPathForFile(file) || ''
    if (!path || selectedFiles.value.some((f) => f.path === path)) continue
    selectedFiles.value.push({ name: file.name, path })
    added.push(path)
  }
  if (added.length) void markDirectories(added)
}

// Renderer names cannot reliably distinguish a directory from a file. Main stats each new path and
// the array entry is replaced through Vue's proxy so the pending card updates immediately.
async function markDirectories(paths: string[]): Promise<void> {
  const statuses = await coach.getFileStatuses({ paths }).catch(() => null)
  if (!statuses) return
  for (let statusIndex = 0; statusIndex < paths.length; statusIndex += 1) {
    const status = statuses[statusIndex]
    if (!status) continue
    if (!status.isDirectory) continue
    const index = selectedFiles.value.findIndex((file) => file.path === paths[statusIndex])
    if (index >= 0) {
      selectedFiles.value[index] = { ...selectedFiles.value[index], isDirectory: true }
    }
  }
}

function onFilesPicked(event: Event): void {
  const el = event.target as HTMLInputElement
  if (turnLocked.value || props.session.archivedAt) {
    el.value = ''
    return
  }
  addFiles(Array.from(el.files || []))
  el.value = '' // reset so picking the same file again still fires change
}

async function onComposerPaste(event: ClipboardEvent): Promise<void> {
  if (!props.session.allowFiles || turnLocked.value || props.session.archivedAt) return
  const files = Array.from(event.clipboardData?.files || [])
  if (!files.length) return
  const onDisk = files.filter((file) => Boolean(window.fileBridge?.getPathForFile(file)))
  const pathlessImages = files.filter(
    (file) =>
      file.type.startsWith('image/') && !window.fileBridge?.getPathForFile(file)
  )
  if (!onDisk.length && !pathlessImages.length) return
  event.preventDefault()
  if (onDisk.length) addFiles(onDisk)
  if (!pathlessImages.length) return
  const attached = await coach.attachClipboardImage({ sessionId: props.session.id }).catch(() => null)
  if (!attached?.ok || !attached.path) return
  if (selectedFiles.value.some((file) => file.path === attached.path)) return
  selectedFiles.value.push({ name: attached.name || 'clipboard.png', path: attached.path })
}

// Drag & drop onto the composer. A depth counter avoids flicker as the cursor crosses
// child elements (each enter/leave pair nets out).
let dragDepth = 0
const dragging = ref(false)
function onDragEnter(): void {
  if (!props.session.allowFiles || turnLocked.value || props.session.archivedAt) return
  dragDepth += 1
  dragging.value = true
}
function onDragLeave(): void {
  dragDepth -= 1
  if (dragDepth <= 0) {
    dragDepth = 0
    dragging.value = false
  }
}
function onDrop(event: DragEvent): void {
  dragDepth = 0
  dragging.value = false
  if (!props.session.allowFiles || turnLocked.value || props.session.archivedAt) return
  addFiles(Array.from(event.dataTransfer?.files || []))
}

function removeFile(i: number): void {
  if (turnLocked.value) return
  selectedFiles.value.splice(i, 1)
}

async function startNewChat(): Promise<boolean> {
  if (newChatPending) return false
  if (props.session.archivedAt) {
    Message.warning(i18nHelper.maestroControl.chat.newChatUnavailable)
    return false
  }
  const sessionId = props.session.id
  const revision = draftRevision
  newChatPending = true
  try {
    const opened = await channelStore.startNewMaestroSession(sessionId)
    if (!opened) { Message.warning(i18nHelper.maestroControl.chat.newChatUnavailable); return false }
    sessionActions.historyVisible = false
    sessionActions.closeSearch()
    if (!composerDisposed && props.session.id === sessionId && draftRevision === revision) {
      input.value = ''
      selectedFiles.value = []
      await nextTick()
      resetComposerHeight()
    }
    return true
  } catch (error) {
    Message.error(error instanceof Error ? error.message : String(error))
    return false
  } finally {
    newChatPending = false
  }
}

function focusComposer(): void {
  if (!props.session.archivedAt) composerRef.value?.focus()
}
defineExpose({ focusComposer })

function onPanelKeydown(event: KeyboardEvent): void {
  if (!document.hasFocus() || event.defaultPrevented || event.isComposing || event.keyCode === 229) return
  const command = (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey
  if (command && event.key.toLowerCase() === 'n') {
    event.preventDefault()
    event.stopPropagation()
    if (!event.repeat) void startNewChat()
  }
}

onMounted(() => {
  window.addEventListener('keydown', onPanelKeydown, true)
  window.addEventListener('keydown', onChatEscapeKeydown)
  if (!sessionActions.historyVisible && !sessionActions.searchVisible) void nextTick(focusComposer)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onPanelKeydown, true)
  window.removeEventListener('keydown', onChatEscapeKeydown)
})

async function stop(): Promise<void> {
  if (props.session.compacting) await coach.cancelCompaction({ sessionId: props.session.id })
  if (props.session.turn) await messageStore.turnService.stop(props.session.id)
}

// 照搬 cowork 同名判据(docs/features/maestro-chat-escape-to-stop.md)。tooltip 排除认的是它
// 渲染出来的内容(`arco-tooltip-content`),不是传给 `<Trigger>` 就丢掉的 `class="arco-tooltip"`
// ——Arco 的 `<Trigger>` 是 `inheritAttrs: false`,那个类从没落到真实 DOM 上过。同时把
// `visibility==='hidden'` 单独判断扩成也认 `opacity==='0'`,盖住淡出过渡进行中的那几百毫秒。
// `.chat-error-modal` 是 bl 独有的(cowork 没有 ChatErrorModal 的对应物)。
const escapeStopBlockedByOverlay = (): boolean => {
  const overlays = document.querySelectorAll<HTMLElement>(
    '.arco-modal, .arco-drawer, .arco-trigger-popup-wrapper, .context-graph, .response-status__roster, .chat-error-modal, [role="dialog"], [role="menu"], [role="listbox"]'
  )
  for (const overlay of overlays) {
    if (!overlay.getClientRects().length) continue
    const style = getComputedStyle(overlay)
    if (style.visibility === 'hidden' || style.opacity === '0') continue
    if (overlay.querySelector('.arco-tooltip-content')) continue
    return true
  }
  return false
}

/**
 * 对话进行中 Escape = Stop(Ral 2026-09-17,与 cowork 同一天补的契约,docs/features/
 * maestro-chat-escape-to-stop.md)。bl 目前没有 explore_session/drill 那套东西,所以没有
 * cowork 那个"停止会丢探索结果,弹确认"的分支——`stop()` 直接停,不问。
 *
 * 也没有搬 cowork 那条"跨 WebContentsView 转播"的兜底:bl 目前没有与 Control 争夺 OS 焦点的
 * 独立操作/浏览器 view,所以焦点丢失这条故障模式今天在 bl 不成立,先不做防御性基建
 * (需要的时候——bl 有了自己的浏览器/任务卡片 view 之后——照 cowork 的
 * `docs/issues/escape-stop-cross-webcontentsview-focus.md` 补一份 `before-input-event` 转播)。
 */
function onChatEscapeKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || event.defaultPrevented || event.repeat || event.isComposing || event.keyCode === 229) return
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
  if (!document.hasFocus() || document.visibilityState !== 'visible' || channelStore.activeSessionId !== props.session.id) return
  const panel = panelRef.value
  if (!panel?.getClientRects().length) return
  const target = event.target
  if (target instanceof Node && target !== document.body && target !== document.documentElement && !panel.contains(target)) return
  if (shortcutStore.open) return
  if (!stopEnabled.value) return
  // Run after child/document handlers, retaining Escape for dismissible surfaces.
  if (escapeStopBlockedByOverlay()) return
  event.preventDefault()
  void stop()
}

function onComposerKeydown(event: KeyboardEvent): void {
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.repeat) return
  if (slashVisible.value && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
    if (['ArrowUp', 'ArrowDown', 'Enter', 'Tab', 'Escape'].includes(event.key)) {
      event.preventDefault()
      event.stopPropagation()
      if (event.key === 'Escape') shortcutStore.close()
      else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') shortcutStore.move(event.key === 'ArrowUp' ? -1 : 1)
      else if (event.key === 'Tab') completeShortcut()
      else void commitShortcut()
      return
    }
  }
  if (event.key !== 'Enter' || event.shiftKey) return
  event.preventDefault()
  void send()
}

function updateComposerCaret(): void {
  composerCaret.value = composerRef.value?.selectionStart ?? input.value.length
}

function onComposerInput(): void { resizeComposer(); updateComposerCaret() }

function completeShortcut(): void {
  const token = slashToken.value
  const item = shortcutStore.active
  if (!token || !item || shortcutStore.pending) return
  input.value = input.value.slice(0, token.start) + item.name + input.value.slice(token.end)
  composerCaret.value = token.start + item.name.length
  void nextTick(() => composerRef.value?.setSelectionRange(composerCaret.value, composerCaret.value))
}

async function runAutoCompactionTest(sessionId: string, filePath?: string): Promise<void> {
  const report = await coach.testAutoCompaction({ sessionId, filePath })
  if (!report) throw new Error('Automatic compaction test could not start. Check the selected model and local path.')
  const lines = [
    report.ok ? 'Automatic compaction test passed' : 'Automatic compaction test failed',
    'Model: ' + report.provider + '/' + report.model,
    'Phase: ' + report.phase + '; requests: ' + report.requests + '; HTTP: ' + (report.responseStatus ?? 'unknown'),
    'Test window: ' + report.testContextWindow + ' / real model window: ' + report.realContextWindow + ' tokens',
    'Reserve: ' + report.reserveTokens + '; keep recent: ' + report.keepRecentTokens,
    'Threshold: ' + report.thresholdTokens + '; before: ' + report.tokensBefore + '; after: ' + (report.tokensAfter ?? 'unknown'),
    'Source bytes: ' + report.sourceBytesRead + ' / ' + report.sourceBytes + (report.sourceTruncated ? ' (excerpt)' : ''),
    'Padding chars: ' + report.paddingChars + '; native trigger: ' + (report.reason || 'none'),
    'System unchanged: ' + report.systemUnchanged + '; context rebuilt: ' + report.contextChanged,
    'This isolated test does not prove the full production window.',
    ...(report.error ? [report.error] : [])
  ]
  messageStore.pushLocalNote(sessionId, lines.join('\n'))
}

async function compactCurrentSession(sessionId: string, instructions?: string): Promise<void> {
  const reply = await coach.compactSession({ sessionId, ...(instructions ? { instructions } : {}) })
  if (!reply?.ok) throw new Error(reply?.error || 'Compaction failed.')
  messageStore.pushLocalNote(sessionId, 'Context compacted' + (reply.tokensBefore !== undefined ? ' · ' + reply.tokensBefore + ' → ~' + (reply.estimatedTokensAfter ?? '?') + ' tokens' : ''))
}

async function commitShortcut(): Promise<void> {
  const token = slashToken.value
  if (!token || shortcutStore.pending) return
  const revision = draftRevision
  const compactInstructions = parseCompactCommand(input.value)?.instructions
  const sessionId = props.session.id
  const draft = input.value.slice(0, token.start) + input.value.slice(token.end)
  if (shortcutStore.active?.name === '/compact' || shortcutStore.active?.name === '/test_auto_compact') input.value = draft
  const result = await shortcutStore.commit({
    testAutoCompaction: () => runAutoCompactionTest(sessionId),
    compact: () => compactCurrentSession(sessionId, compactInstructions),
    listWorkflows: () => runWorkflowCommand('/workflow'),
    newChat: startNewChat,
    // 路径**同时**进剪贴板与时间线(Ral 2026-09-09:「复制到剪贴板,并在消息中回复这个路径」)。
    // 只发 toast 不够:toast 会消失,而这个路径正是要拿去 audit 的东西,得留在会话里可选中。
    // `promptExcluded: true` —— 它是给人看的留痕,不该占模型的上下文。
    // 诊断用:插一张示例错误卡,验证卡片与弹窗这条链路本身是好的
    // (Ral 2026-09-10 要它,因为真错误没显示出来时无法区分"没发生"与"没渲染")。
    testShowError: async () => {
      messageStore.pushErrorCard(
        sessionId,
        new Error(
          'An object could not be cloned.\n    at structuredClone (<anonymous>)\n    at MessagePort.postMessage\n    at coach.sendAgentMessage (message.store.ts)\n\n这是 /test_show_error 造的示例,用来验证错误卡与全文弹窗本身可用。'
        ),
        { subtitle: '/test_show_error · 示例(不是真的失败)' }
      )
    },
    copySessionPath: async () => {
      const reply = await coach.copySessionIoPath({ sessionId })
      if (!reply.ok) throw new Error(reply.error)
      if (composerDisposed || props.session.id !== sessionId) return
      messageStore.pushLocalNote(sessionId, reply.path)
      Message.success(i18nHelper.maestroControl.chat.slashPathCopied)
    },
    copyContext: async () => {
      const context = messageStore.buildAgentContext(props.session, undefined, selectedFiles.value.map((file) => file.path))
      const summary = await coach.copyNextTurnContext({ sessionId, draft, context })
      if (!summary.ok) throw new Error(summary.error)
      if (!composerDisposed && props.session.id === sessionId) {
        Message.success(i18nHelper.maestroControl.chat.slashCopied.replace('{chars}', String(summary.chars)).replace('{entries}', String(summary.entries)))
      }
    },
    // 结构由 main 算(渲染端的上下文投影是**预算账**,没有工具调用与工具返回的正文,而那是
    // 窗口里最大的一块)。这里只负责两件 main 拿不到的事:摘要 + 弹窗。
    openContextGraph: async () => {
      // 摘要只放**模型真的会看到**的那些消息。`promptExcluded` 是给人看的留痕(路径回显、被
      // 中断的那半句),`compact` / `task` / `confirm` 在模型侧没有对应条目,空正文认领不了任何东西。
      // 多给一条的代价不是"多一条不匹配":main 侧的认领游标**只前进**,一次错位会把它后面
      // 每一块都认领不到。
      //
      // 头部一律取**原始 `content`**,不是渲染用的那份:认领是拿这段头部去 `includes` 模型侧
      // 条目的正文(整块拼装后的 turn prompt),i18n 改写过 / 加过前缀的字符串一个字都对不上,
      // 而失败是静默的 —— 表现只是"这块点不动",不会报错。
      // 截取长度是两侧共享的 `CONTEXT_GRAPH_MATCH_HEAD_CHARS`:各写一个数,长消息会静默停止可点。
      const messages = props.session.messages
        .filter((message) => !message.promptExcluded && (!message.type || message.type === 'text' || message.type === 'files') && Boolean(message.content.trim()))
        .map((message) => ({ id: message.id, role: message.role, head: message.content.slice(0, CONTEXT_GRAPH_MATCH_HEAD_CHARS) }))
      const context = messageStore.buildAgentContext(props.session, undefined, selectedFiles.value.map((file) => file.path))
      const reply = await coach.readContextGraph({ sessionId, draft, context, messages })
      if (!reply.ok) throw new Error(`${i18nHelper.maestroControl.contextGraph.readFailed}: ${reply.error}`)
      // 一次跨进程往返之间会话可能已经换掉(抽屉里点了另一条)—— 那份图属于上一个会话,
      // 挂上去就是拿旧结构骗人,而弹窗里每一块都还带着"跳到这条消息"。
      if (composerDisposed || props.session.id !== sessionId) return
      contextGraph.value = reply.graph
    }
  })
  if (composerDisposed || props.session.id !== sessionId) return
  if (!result.ok && result.error) Message.error(result.error)
  if (draftRevision !== revision) return
  if (!result.ok) {
    shortcutStore.update(slashToken.value)
    return
  }
  // 技能只是挂上,不执行:token 照常被删掉,草稿其余部分由下面那两行原样写回。
  if (result.skill) selectedSkill.value = result.skill
  input.value = draft
  composerCaret.value = token.start
  await nextTick()
  resizeComposer()
  composerRef.value?.setSelectionRange(token.start, token.start)
}

/**
 * 芯片左段:打开**这个目录本身**,在 OnlyPreview 里(Ral 2026-09-07)。
 *
 * 原来这里挂的是 `chooseWorkspace` —— 点一个写着「你在哪个目录」的控件,弹出来的是「你想去哪个
 * 目录」。名实不符,而控件骗人比没有控件更糟;切换挪到旁边自己的按钮上去了。
 */
async function revealWorkspace(): Promise<void> {
  if (turnLocked.value || props.session.archivedAt) return
  const path = workspace.value?.path
  if (!path) return
  const result = await coach.openWorkspaceInPreview({ path }).catch(() => null)
  if (!result?.ok) Message.error(`Cannot open ${path}`)
}

async function chooseWorkspace(): Promise<void> {
  if (turnLocked.value || props.session.archivedAt) return
  const result = await messageStore.chooseWorkspace(props.session.id)
  if (result?.previewError) Message.warning(i18nHelper.maestroControl.chat.workspacePreviewFailed)
}

async function stopUsingWorkspace(): Promise<void> {
  if (turnLocked.value || props.session.archivedAt) return
  Modal.confirm({
    title: i18nHelper.maestroControl.chat.stopUsingWorkspaceTitle,
    content: i18nHelper.maestroControl.chat.stopUsingWorkspaceContent.replace('{name}', workspaceLabel.value),
    okText: i18nHelper.maestroControl.chat.stopUsingWorkspace,
    cancelText: i18nHelper.maestroControl.chat.keepWorkspace,
    onOk: async () => {
      if (turnLocked.value || props.session.archivedAt) return
      await messageStore.stopUsingWorkspace(props.session.id)
    }
  })
}

</script>

<template>
  <div
    ref="panelRef"
    class="chat-panel"
    @dragenter.prevent="onDragEnter"
    @dragover.prevent
    @dragleave="onDragLeave"
    @drop.prevent="onDrop"
  >
    <div
      v-if="dragging && session.allowFiles && !turnLocked"
      class="chat-panel__drop-overlay"
    >
      <div class="chat-panel__drop-message">
        Drop files to attach
      </div>
    </div>
    <div class="chat-panel__toolbar">
      <!-- 常驻计数区块(docs/features/maestro-session-list-unread.md #0)。
           未读做成 **Sessions 图标右上角的角标**,最多 `99+` —— 未读的意义是「不开抽屉也知道」,
           所以只有计数必须常驻,列表本体留在抽屉里。
           手写一个 span 而不是用 Arco 的 Badge:Badge 按 20px 基线设计,尺寸/字号/偏移都要逐项覆盖,
           写一个 15px 的 span 反而更短、也不会被组件库升级改掉。 -->
      <div class="chat-panel__sessions-group">
        <div class="chat-panel__sessions-entry">
          <Tooltip :content="shortcut('H')" position="bottom" mini>
            <IconBtn
              class="chat-panel__history-button"
              name="maestro__history"
              :aria-label="i18nHelper.maestroControl.chat.history"
              @click="sessionActions.toggleHistory()"
            >
              <IconListDetails class="chat-panel__button-icon" :size="16" stroke="1.8" />
            </IconBtn>
          </Tooltip>
          <!-- 白色分隔环不是装饰:角标压在图标边缘上,没有它两个深色形状会糊成一块。
               `pointer-events-none` —— 它盖在按钮上,不能把点击吃掉。 -->
          <Tooltip
            v-if="messageStore.unreadSessionCount"
            :content="withCount(i18nHelper.maestroControl.chat.unreadSessions, messageStore.unreadSessionCount)"
            position="bottom"
            mini
          >
            <span name="maestro__sessions-unread" class="chat-panel__sessions-unread">
              {{ messageStore.unreadSessionCount > 99 ? '99+' : messageStore.unreadSessionCount }}
            </span>
          </Tooltip>
        </div>
        <!-- 待答 confirm —— 琥珀点 + 数字(Ral 2026-09-18)。和在跑的灰色并排但颜色不同:
             在跑是「还没轮到你」,这个是**卡在你这儿**,用确认卡/状态条同一套琥珀色。
             数字是**会话数**,计数与按钮、状态条同源,答完自动归零。 -->
        <span
          v-if="messageStore.awaitingConfirmSessionCount"
          name="maestro__sessions-confirm"
          class="chat-panel__sessions-confirm"
          :title="withCount(i18nHelper.maestroControl.chat.awaitingConfirmSessions, messageStore.awaitingConfirmSessionCount)"
        >
          <span class="chat-panel__sessions-confirm-dot"></span>
          <span class="chat-panel__sessions-running-count">{{ messageStore.awaitingConfirmSessionCount }}</span>
        </span>
        <!-- 在跑是**灰的**:在跑是「还没到你」,未读才是「等你看」,只有后者用强调色抢注意力。 -->
        <span
          v-if="messageStore.runningSessionCount"
          name="maestro__sessions-running"
          class="chat-panel__sessions-running"
          :title="withCount(i18nHelper.maestroControl.chat.runningSessions, messageStore.runningSessionCount)"
        >
          <span class="chat-panel__sessions-running-spinner"></span>
          <span class="chat-panel__sessions-running-count">{{ messageStore.runningSessionCount }}</span>
        </span>
      </div>
      <!-- Session tabs 暂时隐藏(Ral 2026-09-18)。组件与 store 原样保留,恢复时把下面这行取消注释、
           连同 <script> 里的 import 一起放回即可。
           <AgentBrowserTabs :session-id="session.id" :running="Boolean(session.turn)" /> -->
      <!-- `…` 与 `+` 必须自成一组。这一行是 `justify-between`,**孩子多于两个时中间的会被均分推开** ——
           那正是 `…` 原来飘在中间的原因。成组之后组内间距由 8px 的 gap 决定,与整行的 gap 无关。 -->
      <div name="chat-panel__toolbar-actions" class="chat-panel__toolbar-actions">
        <Dropdown trigger="click" position="br">
          <IconBtn name="maestro__tasks-menu" class="chat-panel__tasks-menu" :aria-label="i18nHelper.workflow.tasks"><IconDotsVertical :size="16" /></IconBtn>
          <template #content><Doption @click="tasksVisible = true">{{ i18nHelper.workflow.tasks }}</Doption></template>
        </Dropdown>
        <Tooltip :content="shortcut('N')" position="bottom" mini>
          <IconBtn name="maestro__new_chat" class="chat-panel__new-chat" :disabled="Boolean(session.archivedAt)" :aria-label="i18nHelper.maestroControl.chat.newChat" @click="startNewChat"><IconPlus :size="16" stroke="1.8" /></IconBtn>
        </Tooltip>
      </div>
    </div>
    <MessageList :messages="session.messages" />
    <Modal v-model:visible="tasksVisible" :title="i18nHelper.workflow.tasks" :footer="false" :width="620" :mask-closable="true" :unmount-on-close="true" modal-class="chat-panel__tasks-modal">
      <WorkflowTaskBar :session-id="session.id" history @close="tasksVisible = false" />
    </Modal>

    <div class="chat-panel__composer">
      <div v-if="selectedSkill" name="chat-panel__selected-skill" class="chat-panel__selected-skill" :title="selectedSkill.path">
        <span>{{ selectedSkill.name }} · {{ skillLayerLabel(selectedSkill.layer) }}</span>
        <IconBtn :aria-label="i18nHelper.maestroControl.chat.removeSkillSelection" @click="selectedSkill = null"><IconX :size="14" /></IconBtn>
      </div>
      <slot name="before-composer"></slot>
      <div
        v-if="session.allowFiles && selectedFiles.length"
        name="maestro__composer__attachments"
        class="chat-panel__attachments"
      >
        <div
          v-for="(f, i) in selectedFiles"
          :key="f.path"
          class="chat-panel__attachment-card"
        >
          <AttachmentCard :name="f.name" :path="f.path" :is-directory="f.isDirectory" />
          <IconBtn
            class="chat-panel__attachment-remove"
            :disabled="turnLocked"
            :title="i18nHelper.maestroControl.chat.removeAttachment"
            :aria-label="i18nHelper.maestroControl.chat.removeAttachmentNamed.replace('{name}', f.name)"
            @click="removeFile(i)"
          >
            <IconX class="chat-panel__button-icon" :size="10" stroke="2.4" />
          </IconBtn>
        </div>
      </div>
      <div class="chat-panel__input-wrap">
        <SlashMenu :store="shortcutStore" @select="shortcutStore.activeIndex = $event" @commit="commitShortcut" />
        <textarea
          ref="composerRef"
          v-model="input"
          :disabled="Boolean(session.archivedAt)"
          :placeholder="session.archivedAt ? i18nHelper.maestroControl.chat.archivedConversation : session.placeholder"
          rows="1"
          class="chat-panel__textarea"
          aria-autocomplete="list"
          :aria-expanded="slashVisible"
          :aria-controls="slashVisible ? 'maestro-slash-menu' : undefined"
          :aria-activedescendant="slashVisible ? `maestro-slash-${shortcutStore.activeIndex}` : undefined"
          @input="onComposerInput"
          @click="updateComposerCaret"
          @keyup="updateComposerCaret"
          @keydown="onComposerKeydown"
          @paste="onComposerPaste"
        ></textarea>
      </div>
      <div class="chat-panel__composer-footer">
        <div v-if="session.allowFiles" name="maestro__composer__context" class="chat-panel__composer-tools">
          <!-- The duplicate Skills shortcut is intentionally hidden. The Workbench Skills pane
               and its internal coach/workbench-pane broadcast remain available in Workbench. -->
          <!-- 不套 Tooltip(Ral 2026-09-09)。它原来弹的是 "Set workspace",而按钮上写着
               "Choose workspace" —— 同一件事说两遍,且那句还是硬编码英文(违反本项目的 i18n 规则)。
               `v-if` 从被删掉的 Tooltip 挪到按钮自己身上;下面那个 workspace 芯片是
               `v-else-if`,两者必须**相邻**才成链,所以不能在中间插东西。
               `aria-label` 留着 —— tooltip 是给眼睛的,读屏器读的是它。 -->
          <Button
            v-if="session.allowFiles && !workspace"
            name="maestro__composer__choose-workspace"
            class="chat-panel__choose-workspace"
            type="text"
            size="small"
            :disabled="turnLocked || Boolean(session.archivedAt)"
            :aria-label="i18nHelper.maestroControl.chat.chooseWorkspace"
            @click="chooseWorkspace"
          >
            {{ i18nHelper.maestroControl.chat.chooseWorkspace }}
          </Button>
          <div
            v-else-if="session.allowFiles && workspace"
            name="maestro__composer__workspace"
            class="chat-panel__workspace"
          >
            <Tooltip :content="workspaceTitle" position="top" mini>
              <Button
                name="maestro__composer__workspace-open"
                class="chat-panel__workspace-select"
                type="text"
                html-type="button"
                :disabled="turnLocked || Boolean(session.archivedAt)"
                :aria-label="openWorkspaceLabel"
                @click="revealWorkspace"
              >
                <span name="maestro__composer__workspace-content" class="chat-panel__workspace-content">
                  <IconFolderOpen class="chat-panel__workspace-icon" :size="16" stroke="1.8" />
                  <span class="chat-panel__workspace-label">{{ workspaceLabel }}</span>
                </span>
              </Button>
            </Tooltip>
            <Tooltip :content="i18nHelper.maestroControl.chat.switchWorkspace" position="top" mini>
              <IconBtn
                name="maestro__composer__workspace-switch"
                class="chat-panel__workspace-action"
                :disabled="turnLocked || Boolean(session.archivedAt)"
                :aria-label="i18nHelper.maestroControl.chat.switchWorkspace"
                @click="chooseWorkspace"
              >
                <IconFolderSearch class="chat-panel__button-icon" :size="14" stroke="1.8" />
              </IconBtn>
            </Tooltip>
            <Tooltip :content="i18nHelper.maestroControl.chat.stopUsingWorkspaceTooltip" position="top" mini>
              <IconBtn
                name="maestro__composer__workspace-stop"
                class="chat-panel__workspace-action chat-panel__workspace-action--stop"
                :disabled="turnLocked || Boolean(session.archivedAt)"
                :aria-label="i18nHelper.maestroControl.chat.stopUsingWorkspaceTooltip"
                @click="stopUsingWorkspace"
              >
                <IconX class="chat-panel__button-icon" :size="13" stroke="2" />
              </IconBtn>
            </Tooltip>
          </div>
          <IconBtn
            v-if="session.allowFiles"
            name="maestro__composer__attach"
            class="chat-panel__tool-button"
            :disabled="turnLocked"
            title="Attach files (PDF, Excel, Word, text…)"
            aria-label="Attach files"
            @click="pickFiles"
          >
            <IconPaperclip class="chat-panel__button-icon" :size="18" stroke="1.8" />
          </IconBtn>
        </div>
        <div class="chat-panel__composer-actions">
          <div class="chat-panel__model-controls"><slot name="before-actions"></slot></div>
          <!-- Stop 与 Send 同形同位、互斥显示 —— 以 cowork 的 `chat-panel__composer-stop` 为准
               (Ral 2026-09-09:两边风格不一致,以 cowork 为准)。要点是**纯图标 + 软色底 + 无边框**:
               原先那版是 Arco `type="outline" status="danger"` 的带框胶囊还带 "Stop" 字样,
               在同一排 32px 图标按钮里既比别人高一截、又是这一排唯一有描边的东西。
               文案不丢:它挪到 title / aria-label 上,i18n key 照旧。 -->
          <IconBtn
            v-if="Boolean(session.turn) || session.compacting"
            name="maestro__composer__stop"
            class="chat-panel__stop-button"
            :class="{ 'chat-panel__stop-button--aborting': session.turn?.aborting }"
            :disabled="session.turn?.aborting && !session.turn?.stopError"
            :title="session.turn?.stopError ? i18nHelper.workflow.retry : session.turn?.aborting ? i18nHelper.maestroControl.chat.stopping : i18nHelper.maestroControl.chat.stop"
            :aria-label="session.turn?.stopError ? i18nHelper.workflow.retry : session.turn?.aborting ? i18nHelper.maestroControl.chat.stopping : i18nHelper.maestroControl.chat.stop"
            @click="stop"
          >
            <IconPlayerStop class="chat-panel__button-icon" :size="15" stroke="1.8" />
          </IconBtn>
          <IconBtn
            v-else
            name="maestro__composer__send"
            class="chat-panel__send-button"
            :disabled="!input.trim() || Boolean(session.archivedAt) || sendDisabled || Boolean(session.turn?.aborting)"
            :title="session.turn ? i18nHelper.maestroControl.chat.sendIntoTurn : i18nHelper.maestroControl.chat.send"
            :aria-label="i18nHelper.maestroControl.chat.send"
            @click="send"
          >
            <IconSend2 class="chat-panel__button-icon" :size="15" stroke="1.8" />
          </IconBtn>
        </div>
      </div>
      <input ref="fileInput" type="file" accept=".pdf,.doc,.docx,.docm,.ppt,.pps,.pot,.pptx,.pptm,.ppsx,.ppsm,.xls,.xlsx,.xlsm,.xlsb,.odt,.ods,.odp,.rtf,.epub,.csv,.tsv,.md,.markdown,.txt,.json,.html,.htm,.xml,.yaml,.yml,.log,.zip,.7z,.rar,.tar,.tgz,.gz,.xz,.bz2,.bz3,.zst,.lz4,.lzma,.lz,.sz,.br,.png,.jpg,.jpeg,.webp,.gif,image/png,image/jpeg,image/webp,image/gif" multiple class="chat-panel__file-input" @change="onFilesPicked" />
    </div>
    <!-- 弹窗挂在**面板根之内**,而且是最后一个子节点 —— 不是 body 级、也不是 Arco 的
         `a-modal`(它会把内容传送到 body)。两个理由:
         ① 遮罩只该盖住这一个面板(control 里它是 380–480px 的侧栏),盖住整窗就把旁边的
            Workbench 一起锁了,而这条命令读的只是这个会话;
         ② 点一块要滚过去的那条消息**就在这层遮罩底下** —— 落点和遮罩必须同一个定位上下文,
            body 级遮罩会把落点一起盖掉。
         既有先例是同在这个根里的 `.chat-panel__drop-overlay`(`position:absolute; inset:0`),
         所以弹窗的 z-index 必须大于它的 20。
         面板本身按会话 id 重挂(`ControlApp.vue` 的 `<ChatPanel :key="activeSession.id">`),
         换会话时这份图随组件一起消失,不需要额外的跨会话清理。 -->
    <ContextGraphModal v-if="contextGraph" :graph="contextGraph" @close="contextGraph = null" />
    <!-- 错误全文弹窗。挂这里的理由与上面那个一字不差(遮罩只盖这一个面板 + 落点同定位上下文),
         状态挂在 store 上 —— 卡片长在消息列表深处,emit 冒不上来。 -->
    <ChatErrorModal
      v-if="messageStore.errorDetail"
      :card="messageStore.errorDetail"
      @close="messageStore.closeErrorDetail()"
    />
  </div>
</template>
