<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import { IconFolder, IconFolderOpen, IconListDetails, IconLoader2, IconMicrophone, IconPaperclip, IconPlayerPause, IconPlayerStop, IconPlus, IconRefresh, IconSend2, IconSparkles, IconX } from '@tabler/icons-vue'
import { fileIcon } from './fileIcon'
import { Drawer, Message, Modal, Tooltip } from '@arco-design/web-vue'
import { createXpcRendererEmitter, xpcRenderer } from 'electron-xpc/renderer'
import type { AgentReply } from '@cowork-shared/coach.api'
import type { CoachXpcContract } from '@cowork-shared/coach.api'
import IconBtn from '@cowork-renderer/common/components/IconBtn.vue'
import MessageList from './MessageList.vue'
import { channelStore } from './store/channel.store'
import { messageStore } from './store/message.store'
import type { ChatAttachment, MessageSession } from './store/message.type'

const coach = createXpcRendererEmitter<CoachXpcContract>('CoachXpcHandler')
const props = defineProps<{ session: MessageSession; sendDisabled?: boolean }>()
const emit = defineEmits<{ sent: [reply: AgentReply] }>()
const VOICE_SCRIBE_SAMPLE_RATE = 16_000
const VOICE_SCRIBE_MAX_MS = 5 * 60 * 1000

const input = ref('')
// Composer attachments: picked/dropped files, kept as {name, absolute path}. On send the
// paths (never bytes) are registered with main; the agent reads them via read_file.
const selectedFiles = ref<ChatAttachment[]>([])
const fileInput = ref<HTMLInputElement | null>(null)
const composerRef = ref<HTMLTextAreaElement | null>(null)
const historyVisible = ref(false)
const historyContainer = ref<HTMLElement | null>(null)
const voiceRecording = ref(false)
const voiceBusy = ref(false)

interface VoiceRecorder {
  context: AudioContext
  source: MediaStreamAudioSourceNode
  processor: ScriptProcessorNode
  stream: MediaStream
  chunks: Float32Array[]
  sampleRate: number
}

const voiceRecorder = ref<VoiceRecorder | null>(null)
const voiceRecordingStartedAt = ref(0)
const voiceRecordingElapsedMs = ref(0)
let voiceRecordingTimer: ReturnType<typeof setInterval> | undefined

const contextPercent = computed(() => Math.min(100, Math.max(0, props.session.contextUsage.percent)))
const contextMeterColor = computed(() => (props.session.contextUsage.compressionTriggered ? '#f59e0b' : '#165dff'))
const contextMeterStyle = computed(() => ({
  background: `conic-gradient(${contextMeterColor.value} ${contextPercent.value}%, #d9e2ee 0)`
}))
const workspace = computed(() => props.session.detail.workspace)
const workspaceLabel = computed(() => workspace.value?.name || 'Workspace')
const workspaceTitle = computed(() => workspace.value?.path || 'Set workspace')
const voiceRecordingLabel = computed(() => {
  const totalSeconds = Math.floor(voiceRecordingElapsedMs.value / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
})

const formatCompactTokens = (tokens: number): string => {
  const n = Math.max(0, Math.round(tokens || 0))
  if (n >= 1024 * 1024) {
    const value = n / (1024 * 1024)
    return `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)}M`
  }
  if (n >= 1024) return `${Math.round(n / 1024)}k`
  return n.toLocaleString()
}

const contextTooltipLines = computed(() => {
  const usage = props.session.contextUsage
  return [
    `Context window: ${usage.percent}% full`,
    `${formatCompactTokens(usage.usedTokens)} / ${formatCompactTokens(usage.maxTokens)} tokens used`
  ]
})

const formatSessionTime = (ts: number): string => {
  if (!ts) return ''
  const date = new Date(ts)
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

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

function startVoiceTimer(): void {
  if (voiceRecordingTimer) clearInterval(voiceRecordingTimer)
  voiceRecordingStartedAt.value = Date.now()
  voiceRecordingElapsedMs.value = 0
  voiceRecordingTimer = setInterval(() => {
    const elapsedMs = Date.now() - voiceRecordingStartedAt.value
    voiceRecordingElapsedMs.value = Math.min(elapsedMs, VOICE_SCRIBE_MAX_MS)
    if (elapsedMs >= VOICE_SCRIBE_MAX_MS) void stopVoiceScribe(true)
  }, 250)
}

function stopVoiceTimer(): void {
  if (!voiceRecordingTimer) return
  clearInterval(voiceRecordingTimer)
  voiceRecordingTimer = undefined
}

function cleanupVoiceRecorder(): void {
  const recorder = voiceRecorder.value
  voiceRecording.value = false
  voiceRecorder.value = null
  stopVoiceTimer()
  if (!recorder) return
  recorder.processor.disconnect()
  recorder.source.disconnect()
  recorder.stream.getTracks().forEach((track) => track.stop())
  void recorder.context.close().catch(() => undefined)
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i))
}

function concatPcmChunks(chunks: Float32Array[]): Float32Array {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const samples = new Float32Array(length)
  let offset = 0
  for (const chunk of chunks) {
    samples.set(chunk, offset)
    offset += chunk.length
  }
  return samples
}

function resamplePcm(samples: Float32Array, sourceSampleRate: number, targetSampleRate: number): Float32Array {
  if (!samples.length || sourceSampleRate === targetSampleRate) return samples
  const ratio = sourceSampleRate / targetSampleRate
  const length = Math.max(1, Math.floor(samples.length / ratio))
  const out = new Float32Array(length)
  for (let i = 0; i < length; i += 1) {
    const sourceIndex = i * ratio
    const left = Math.floor(sourceIndex)
    const right = Math.min(samples.length - 1, left + 1)
    const mix = sourceIndex - left
    out[i] = samples[left] * (1 - mix) + samples[right] * mix
  }
  return out
}

function encodeWav(chunks: Float32Array[], sourceSampleRate: number): { buffer: ArrayBuffer; sampleRate: number } {
  const roundedSourceSampleRate = Math.max(1, Math.round(sourceSampleRate))
  const outputSampleRate = roundedSourceSampleRate > VOICE_SCRIBE_SAMPLE_RATE ? VOICE_SCRIBE_SAMPLE_RATE : roundedSourceSampleRate
  const samples = resamplePcm(concatPcmChunks(chunks), roundedSourceSampleRate, outputSampleRate)
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  writeAscii(view, 8, 'WAVE')
  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, outputSampleRate, true)
  view.setUint32(28, outputSampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeAscii(view, 36, 'data')
  view.setUint32(40, samples.length * 2, true)
  let offset = 44
  for (const sample of samples) {
    const clipped = Math.max(-1, Math.min(1, sample))
    view.setInt16(offset, clipped < 0 ? clipped * 0x8000 : clipped * 0x7fff, true)
    offset += 2
  }
  return { buffer, sampleRate: outputSampleRate }
}

async function appendTranscript(text: string): Promise<void> {
  const transcript = text.trim()
  if (!transcript) return
  input.value = input.value.trim() ? `${input.value.trimEnd()}\n${transcript}` : transcript
  await nextTick()
  resizeComposer()
  composerRef.value?.focus()
}

function promptAiCrmsLogin(): void {
  Modal.confirm({
    title: 'AI-CRMS login required',
    content: 'Voice scribe uses Bailian ASR through AI-CRMS. Log in first, then record again.',
    okText: 'Login',
    cancelText: 'Cancel',
    onOk: () => coach.loginLlm({ provider: 'ai-crms', method: 'browser' }).then(() => undefined)
  })
}

async function ensureAiCrmsScribeReady(): Promise<boolean> {
  const cfg = await coach.getLlmConfig().catch(() => null)
  if (!cfg) {
    Message.error('Could not check AI-CRMS login state.')
    return false
  }
  if (cfg.providers.some((provider) => provider.provider === 'ai-crms' && provider.ready)) return true
  promptAiCrmsLogin()
  return false
}

async function startVoiceScribe(): Promise<void> {
  if (voiceRecording.value || voiceBusy.value || props.session.busy || props.session.archivedAt) return
  if (!(await ensureAiCrmsScribeReady())) return
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const context = new AudioContext()
    const source = context.createMediaStreamSource(stream)
    const processor = context.createScriptProcessor(4096, 1, 1)
    const chunks: Float32Array[] = []
    processor.onaudioprocess = (event) => {
      chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)))
    }
    source.connect(processor)
    processor.connect(context.destination)
    voiceRecorder.value = { context, source, processor, stream, chunks, sampleRate: context.sampleRate }
    startVoiceTimer()
    voiceRecording.value = true
  } catch (err) {
    Message.error('Microphone unavailable: ' + (err as Error).message)
  }
}

async function stopVoiceScribe(autoStopped = false): Promise<void> {
  const recorder = voiceRecorder.value
  if (!recorder) return
  voiceRecording.value = false
  voiceRecorder.value = null
  stopVoiceTimer()
  recorder.processor.disconnect()
  recorder.source.disconnect()
  recorder.stream.getTracks().forEach((track) => track.stop())
  await recorder.context.close().catch(() => undefined)
  if (!recorder.chunks.length) {
    Message.warning('No audio recorded.')
    return
  }
  voiceBusy.value = true
  try {
    if (autoStopped) Message.info('Voice recording reached 5 minutes; processing now.')
    const wav = encodeWav(recorder.chunks, recorder.sampleRate)
    const path = window.audioBridge.writeTempAudio({ bytes: wav.buffer, extension: 'wav' })
    const result = await coach.scribeAudio({ path, mime: 'audio/wav', format: 'wav', sampleRate: wav.sampleRate })
    if (result.ok) {
      await appendTranscript(result.text)
      Message.success('Voice scribe inserted')
      return
    }
    if (result.code === 'ai-crms-login-required') promptAiCrmsLogin()
    else Message.error(result.error || 'Voice scribe failed')
  } catch (err) {
    Message.error('Voice scribe failed: ' + (err as Error).message)
  } finally {
    voiceBusy.value = false
  }
}

async function toggleVoiceScribe(): Promise<void> {
  if (voiceRecording.value) await stopVoiceScribe()
  else await startVoiceScribe()
}

onBeforeUnmount(() => cleanupVoiceRecorder())

async function send(): Promise<void> {
  const message = input.value.trim()
  // Text is REQUIRED to send, even when files are attached.
  if (!message || props.session.busy || props.sendDisabled) return
  const files = selectedFiles.value.length ? selectedFiles.value.slice() : undefined
  input.value = ''
  selectedFiles.value = []
  await nextTick()
  resetComposerHeight()
  const reply = await messageStore.send(props.session.id, message, files)
  if (reply) emit('sent', reply)
}

function pickFiles(): void {
  fileInput.value?.click()
}

// Add files by ABSOLUTE PATH only (resolved via the preload bridge — webUtils, no bytes
// read). On send the paths are registered with main and the agent reads them via read_file.
function addFiles(files: File[]): void {
  for (const file of files) {
    const path = window.fileBridge?.getPathForFile(file) || ''
    if (!path || selectedFiles.value.some((f) => f.path === path)) continue
    selectedFiles.value.push({ name: file.name, path })
  }
}

function onFilesPicked(event: Event): void {
  const el = event.target as HTMLInputElement
  addFiles(Array.from(el.files || []))
  el.value = '' // reset so picking the same file again still fires change
}

async function onComposerPaste(event: ClipboardEvent): Promise<void> {
  if (!props.session.allowFiles || props.session.busy || props.session.archivedAt) return
  const hasImage = Array.from(event.clipboardData?.items || []).some((item) => item.kind === 'file' && item.type.startsWith('image/'))
  if (!hasImage) return
  event.preventDefault()
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
  if (!props.session.allowFiles) return
  addFiles(Array.from(event.dataTransfer?.files || []))
}

function removeFile(i: number): void {
  selectedFiles.value.splice(i, 1)
}

async function startNewChat(): Promise<void> {
  if (props.session.busy || props.session.source === 'connector') return
  input.value = ''
  selectedFiles.value = []
  await nextTick()
  resetComposerHeight()
  await channelStore.startNewCoworkSession(props.session.id)
}

async function selectHistory(sessionId: string): Promise<void> {
  await channelStore.selectCoworkHistorySession(sessionId)
  historyVisible.value = false
}

async function stop(): Promise<void> {
  await messageStore.stop(props.session.id)
}

function onComposerKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Enter' || event.shiftKey) return
  event.preventDefault()
  void send()
}

async function openSkills(): Promise<void> {
  await coach.setWorkbenchVisible({ visible: true })
  xpcRenderer.broadcast('coach/workbench-pane', { pane: 'skills' })
}

async function chooseWorkspace(): Promise<void> {
  if (props.session.busy || props.session.archivedAt) return
  await messageStore.chooseWorkspace(props.session.id)
}

async function clearWorkspace(): Promise<void> {
  if (props.session.busy || props.session.archivedAt) return
  await messageStore.clearWorkspace(props.session.id)
}

async function refreshWorkspace(): Promise<void> {
  if (props.session.busy || props.session.archivedAt) return
  await messageStore.refreshWorkspace(props.session.id)
}

function setHistoryContainer(el: HTMLElement | null): void {
  historyContainer.value = el
}
</script>

<template>
  <div
    class="relative flex min-h-0 flex-1 flex-col bg-white"
    @dragenter.prevent="onDragEnter"
    @dragover.prevent
    @dragleave="onDragLeave"
    @drop.prevent="onDrop"
  >
    <div
      v-if="dragging && session.allowFiles"
      class="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-[#eef4ff]/85"
    >
      <div class="rounded-xl border-2 border-dashed border-[#165dff] px-6 py-4 text-[14px] font-semibold text-[#165dff]">
        Drop files to attach
      </div>
    </div>
    <div class="mb-2 flex shrink-0 items-center justify-between gap-2 rounded-xl bg-[rgb(248,250,252)] p-1.5">
      <IconBtn
        name="cowork__history"
        title="Chat history"
        aria-label="Chat history"
        @click="historyVisible = !historyVisible"
      >
        <IconListDetails :size="16" stroke="1.8" />
      </IconBtn>
      <button
        name="cowork__new_chat"
        type="button"
        class="control-llm-text-btn gap-1.5"
        :disabled="session.busy || session.source === 'connector'"
        title="New chat"
        @click="startNewChat"
      >
        <IconPlus :size="15" stroke="1.8" />
        <span>New chat</span>
      </button>
    </div>
    <MessageList :messages="session.messages" @container-ready="setHistoryContainer" />
    <Drawer
      v-if="historyContainer"
      v-model:visible="historyVisible"
      placement="left"
      :width="280"
      :popup-container="historyContainer"
      :header="false"
      :footer="false"
      :body-style="{ padding: '0', overflow: 'hidden' }"
      unmount-on-close
    >
      <div class="flex h-full min-h-0 flex-col bg-white">
        <div class="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-gray-100 px-3">
          <div class="text-[12px] font-semibold text-gray-800">Chat history</div>
          <button
            type="button"
            title="Close"
            aria-label="Close"
            class="flex h-7 w-7 items-center justify-center rounded-md text-[18px] leading-none text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            @click="historyVisible = false"
          >
            ×
          </button>
        </div>
        <div class="min-h-0 flex-1 overflow-auto p-2">
          <div v-if="!messageStore.historySessions.length" class="px-3 py-6 text-center text-[12px] font-semibold text-gray-400">
            No history
          </div>
          <button
            v-for="item in messageStore.historySessions"
            :key="item.id"
            type="button"
            class="mb-1 block w-full rounded-lg px-3 py-2 text-left transition"
            :class="item.id === session.id ? 'bg-[#edf4ff] text-[#165dff]' : 'text-gray-700 hover:bg-[#f4f7fb]'"
            @click="selectHistory(item.id)"
          >
            <span class="block truncate text-[12px] font-semibold">{{ item.title || 'Cowork' }}</span>
            <span class="mt-0.5 block truncate text-[11px] text-gray-400">{{ item.preview || formatSessionTime(item.updatedAt) }}</span>
          </button>
        </div>
      </div>
    </Drawer>
    <div class="shrink-0 bg-white pt-2">
      <slot name="before-composer"></slot>
      <!-- Attached files: flex list of removable chips ABOVE the input; hover shows full path. -->
      <div v-if="session.allowFiles && selectedFiles.length" class="mb-2 flex flex-wrap gap-1.5">
        <Tooltip v-for="(f, i) in selectedFiles" :key="f.path" :content="f.path" position="top">
          <span class="inline-flex max-w-[200px] items-center gap-1 rounded-md border border-gray-300 bg-white py-1 pl-1.5 pr-1 text-[12px] text-gray-700">
            <component :is="fileIcon(f.name)" :size="15" stroke="1.8" class="shrink-0 text-gray-400" />
            <span class="truncate">{{ f.name }}</span>
            <button
              type="button"
              class="flex h-4 w-4 shrink-0 items-center justify-center rounded text-gray-400 transition hover:bg-gray-100 hover:text-red-600"
              title="Remove"
              @click="removeFile(i)"
            >
              <IconX :size="12" stroke="2" />
            </button>
          </span>
        </Tooltip>
      </div>
      <div class="relative">
        <textarea
          ref="composerRef"
          v-model="input"
          :disabled="session.busy || Boolean(session.archivedAt)"
          :placeholder="session.archivedAt ? 'Archived conversation' : session.placeholder"
          rows="1"
          class="h-[44px] max-h-[120px] min-h-[44px] w-full resize-none overflow-y-auto rounded-lg border border-gray-300 bg-[#fbfcfe] px-3 py-[7px] text-[13px] leading-5 outline-none transition focus:border-[#165dff] focus:bg-white"
          :class="voiceRecording ? 'pr-[132px]' : ''"
          @input="resizeComposer"
          @keydown="onComposerKeydown"
          @paste="onComposerPaste"
        ></textarea>
        <div
          v-if="voiceRecording"
          name="cowork__composer__voice_recording"
          class="pointer-events-none absolute right-2 top-2 flex h-7 items-center gap-2 rounded-md border border-red-100 bg-white/95 px-2 text-[11px] font-semibold text-red-600 shadow-sm"
        >
          <span class="voice-wave" aria-hidden="true">
            <span class="voice-wave__bar"></span>
            <span class="voice-wave__bar"></span>
            <span class="voice-wave__bar"></span>
            <span class="voice-wave__bar"></span>
            <span class="voice-wave__bar"></span>
          </span>
          <span class="tabular-nums">{{ voiceRecordingLabel }}</span>
        </div>
      </div>
      <div class="mt-2 flex items-center justify-between gap-2">
        <div class="flex min-w-0 items-center gap-1.5">
          <IconBtn
            name="cowork__composer__skills"
            title="Skills"
            aria-label="Skills"
            @click="openSkills"
          >
            <IconSparkles :size="15" stroke="1.8" />
          </IconBtn>
          <!-- File attach — bottom-left. Opens a multi-select file picker. -->
          <button
            v-if="session.allowFiles"
            type="button"
            :disabled="session.busy"
            title="Attach files (PDF, Excel, Word, text…)"
            class="flex h-8 w-8 items-center justify-center rounded-md text-gray-500 hover:bg-black/5 hover:text-gray-800 disabled:cursor-not-allowed disabled:text-gray-300"
            @click="pickFiles"
          >
            <IconPaperclip :size="18" stroke="1.8" />
          </button>
          <Tooltip v-if="session.allowFiles && !workspace" content="Set workspace" position="top">
            <button
              type="button"
              :disabled="session.busy || Boolean(session.archivedAt)"
              title="Set workspace"
              class="flex h-8 w-8 items-center justify-center rounded-md text-gray-500 hover:bg-black/5 hover:text-gray-800 disabled:cursor-not-allowed disabled:text-gray-300"
              @click="chooseWorkspace"
            >
              <IconFolder :size="18" stroke="1.8" />
            </button>
          </Tooltip>
          <Tooltip v-else-if="session.allowFiles && workspace" :content="workspaceTitle" position="top">
            <div
              name="cowork__composer__workspace"
              class="flex h-8 min-w-0 max-w-[220px] items-center overflow-hidden rounded-md border border-[#d9e2ee] bg-white text-gray-700 shadow-sm"
            >
              <button
                type="button"
                :disabled="session.busy || Boolean(session.archivedAt)"
                class="flex min-w-0 flex-1 items-center gap-1.5 px-2 text-left text-[12px] font-semibold hover:bg-[#f4f7fb] disabled:cursor-not-allowed disabled:text-gray-300"
                title="Switch workspace"
                @click="chooseWorkspace"
              >
                <IconFolderOpen :size="16" stroke="1.8" class="shrink-0 text-[#165dff]" />
                <span class="truncate">{{ workspaceLabel }}</span>
              </button>
              <button
                type="button"
                :disabled="session.busy || Boolean(session.archivedAt)"
                class="flex h-8 w-7 shrink-0 items-center justify-center border-l border-[#edf2f7] text-gray-400 hover:bg-[#f4f7fb] hover:text-[#165dff] disabled:cursor-not-allowed disabled:text-gray-300"
                title="Refresh workspace"
                @click="refreshWorkspace"
              >
                <IconRefresh :size="13" stroke="2" />
              </button>
              <button
                type="button"
                :disabled="session.busy || Boolean(session.archivedAt)"
                class="flex h-8 w-7 shrink-0 items-center justify-center border-l border-[#edf2f7] text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:text-gray-300"
                title="Clear workspace"
                @click="clearWorkspace"
              >
                <IconX :size="13" stroke="2" />
              </button>
            </div>
          </Tooltip>
        </div>
        <div class="flex items-center gap-1.5">
          <slot name="before-actions"></slot>
          <Tooltip position="top">
            <template #content>
              <div class="min-w-[190px] text-center leading-6">
                <div class="text-[13px] text-white/70">{{ contextTooltipLines[0] }}</div>
                <div class="text-[14px] font-medium text-white">{{ contextTooltipLines[1] }}</div>
              </div>
            </template>
            <div
              name="cowork__composer__context"
              class="relative h-4 w-4 shrink-0 rounded-full p-[2px]"
              :style="contextMeterStyle"
              title="Context usage"
            >
              <div class="h-full w-full rounded-full bg-white"></div>
            </div>
          </Tooltip>
          <button
            type="button"
            :disabled="Boolean(session.archivedAt) || (!voiceRecording && (session.busy || voiceBusy))"
            :title="voiceRecording ? 'Stop voice scribe' : voiceBusy ? 'Uploading voice' : 'Voice scribe'"
            :aria-label="voiceRecording ? 'Stop voice scribe' : 'Voice scribe'"
            class="flex h-8 w-8 items-center justify-center rounded-md transition disabled:cursor-not-allowed disabled:text-gray-300"
            :class="voiceRecording ? 'bg-red-50 text-red-600 animate-pulse hover:bg-red-100' : voiceBusy ? 'bg-[#edf4ff] text-[#165dff]' : 'text-gray-500 hover:bg-black/5 hover:text-gray-800'"
            @click="toggleVoiceScribe"
          >
            <IconLoader2 v-if="voiceBusy" :size="18" stroke="1.8" class="animate-spin" />
            <IconPlayerPause v-else-if="voiceRecording" :size="18" stroke="1.8" />
            <IconMicrophone v-else :size="18" stroke="1.8" />
          </button>
          <button
            v-if="session.busy"
            type="button"
            class="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-2.5 text-[12px] font-semibold text-red-600 transition hover:bg-red-100 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-60"
            :class="session.aborting ? 'animate-pulse' : ''"
            :disabled="session.aborting"
            :title="session.aborting ? 'Stopping' : 'Stop'"
            :aria-label="session.aborting ? 'Stopping' : 'Stop'"
            @click="stop"
          >
            <IconPlayerStop :size="15" stroke="1.8" />
            <span>Stop</span>
          </button>
          <button
            v-else
            name="cowork__composer__send"
            type="button"
            class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border-0 bg-[#165dff] text-white transition hover:bg-[#0f4fd8] disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
            :disabled="!input.trim() || Boolean(session.archivedAt) || sendDisabled"
            title="Send"
            aria-label="Send"
            @click="send"
          >
            <IconSend2 :size="15" stroke="1.8" />
          </button>
        </div>
      </div>
      <input ref="fileInput" type="file" accept=".pdf,.xlsx,.xlsm,.docx,.csv,.tsv,.md,.markdown,.txt,.json,.html,.htm,.xml,.yaml,.yml,.log,.png,.jpg,.jpeg,.webp,.gif,image/png,image/jpeg,image/webp,image/gif" multiple class="hidden" @change="onFilesPicked" />
    </div>
  </div>
</template>

<style scoped>
.voice-wave {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  height: 14px;
}

.voice-wave__bar {
  width: 2px;
  height: 8px;
  border-radius: 999px;
  background: currentColor;
  animation: voice-wave-pulse 0.8s ease-in-out infinite;
}

.voice-wave__bar:nth-child(2) {
  animation-delay: 0.1s;
}

.voice-wave__bar:nth-child(3) {
  animation-delay: 0.2s;
}

.voice-wave__bar:nth-child(4) {
  animation-delay: 0.3s;
}

.voice-wave__bar:nth-child(5) {
  animation-delay: 0.4s;
}

@keyframes voice-wave-pulse {
  0%,
  100% {
    transform: scaleY(0.45);
    opacity: 0.5;
  }

  50% {
    transform: scaleY(1.25);
    opacity: 1;
  }
}
</style>
