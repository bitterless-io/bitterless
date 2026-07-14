<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import MarkdownRender from 'markstream-vue'
import { Spin, Trigger } from '@arco-design/web-vue'
import { createXpcRendererEmitter } from 'electron-xpc/renderer'
import { IconActivity, IconDotsVertical, IconExternalLink, IconFolderOpen, IconSparkles } from '@tabler/icons-vue'
import type { AgentActivityStep, CoachXpcContract, FileStatusResult, ReplayResult } from '@cowork-shared/coach.api'
import type { ChatFile, ChatMessage } from './store/message.type'
import { fileIcon } from './fileIcon'

const coach = createXpcRendererEmitter<CoachXpcContract>('CoachXpcHandler')
const props = defineProps<{ message: ChatMessage }>()
const fileStatuses = ref<Record<string, FileStatusResult>>({})

const ACTIVITY_TAGS: Record<AgentActivityStep['phase'], { tag: string; cls: string }> = {
  think: { tag: 'think', cls: 'bg-gray-100 text-gray-600' },
  tool: { tag: 'tool', cls: 'bg-slate-100 text-slate-700' },
  skill: { tag: 'skill', cls: 'bg-violet-100 text-violet-700' },
  observe: { tag: 'see', cls: 'bg-sky-100 text-sky-700' },
  act: { tag: 'do', cls: 'bg-amber-100 text-amber-700' },
  'api-read': { tag: 'read api', cls: 'bg-cyan-100 text-cyan-700' },
  'api-call': { tag: 'call api', cls: 'bg-teal-100 text-teal-700' },
  api: { tag: 'api', cls: 'bg-teal-100 text-teal-700' },
  tab: { tag: 'tab', cls: 'bg-indigo-100 text-indigo-700' }
}

const isCoworkHuman = (message: ChatMessage): boolean => message.source === 'cowork' && message.role === 'human'
const activityTag = (phase: AgentActivityStep['phase']): string => ACTIVITY_TAGS[phase]?.tag || phase
const activityTagClass = (phase: AgentActivityStep['phase']): string => ACTIVITY_TAGS[phase]?.cls || 'bg-gray-100 text-gray-600'
const messageAlignClass = (message: ChatMessage): string => (isCoworkHuman(message) ? 'justify-end' : 'justify-start')

const compactActivitySteps = (activity: AgentActivityStep[]): AgentActivityStep[] => {
  const compact: AgentActivityStep[] = []
  for (const item of activity) {
    if (item.phase === 'think') continue
    compact.push(item)
  }
  return compact
}

const activityFeed = computed(() => compactActivitySteps(props.message.activity || []))
const visibleActivity = computed(() => activityFeed.value.slice(-12))
const hiddenActivityCount = computed(() => Math.max(0, activityFeed.value.length - visibleActivity.value.length))
const artifactFiles = computed(() => (props.message.role === 'ai' ? (props.message.files || []).filter((file) => file.path) : []))
const artifactPathKey = computed(() => artifactFiles.value.map((file) => file.path || '').filter(Boolean).join('\n'))
const messageSkills = computed(() => {
  if (props.message.skills?.length) return props.message.skills
  return props.message.skill ? [props.message.skill] : []
})
const replaySummary = (replay?: ReplayResult): string => {
  if (!replay) return ''
  const mode = replay.mode === 'api' ? 'API' : replay.mode === 'ui' ? 'UI' : 'Run'
  const calls = replay.apiCalls ? ` · ${replay.apiCalls} API` : ''
  const steps = replay.stepsRun ? ` · ${replay.stepsRun} step${replay.stepsRun === 1 ? '' : 's'}` : ''
  return `${mode}${calls}${steps}`
}
const replayPreview = (replay?: ReplayResult): string => {
  const text = replay?.responseText?.trim()
  if (!text) return ''
  return text.length > 360 ? text.slice(0, 360) + '...' : text
}
const replayAuth = (replay?: ReplayResult): string => {
  const auth = replay?.auth || []
  if (!auth.length) return ''
  return auth
    .map((item) => {
      const source = item.applied ? item.source : 'missing'
      return item.key ? `${item.header}: ${source}(${item.key})` : `${item.header}: ${source}`
    })
    .join(', ')
}

const showThinking = computed(() => props.message.role === 'ai' && props.message.streaming && Boolean(props.message.thinking))
const showInitialLoading = computed(() => props.message.role === 'ai' && props.message.streaming && !props.message.content && !showThinking.value)

// While streaming with no content yet, show the bubble for waiting, real thinking,
// or internal tool calls. Finished messages always render their bubble.
const showBubble = computed(() => {
  const m = props.message
  if (m.role !== 'ai') return true
  if (!m.streaming) return true
  return Boolean(m.content) || showInitialLoading.value || showThinking.value || visibleActivity.value.length > 0 || artifactFiles.value.length > 0
})

const messageBubbleClass = (message: ChatMessage): string => {
  if (message.source === 'connector') return 'bg-emerald-50 text-emerald-950'
  if (message.error) return 'bg-red-50 text-red-700'
  if (isCoworkHuman(message)) return 'bg-[#eaf2ff] text-gray-900'
  return 'bg-white text-gray-800'
}

const fileMeta = (file: ChatFile): string => {
  const action = file.action === 'updated' ? 'updated' : 'created'
  if (!file.size) return action
  if (file.size >= 1024 * 1024) return `${action} · ${(file.size / 1024 / 1024).toFixed(1)} MB`
  if (file.size >= 1024) return `${action} · ${Math.round(file.size / 1024)} KB`
  return `${action} · ${file.size} B`
}

const filePathLabel = (file: ChatFile): string => file.path || file.name
const fileStatus = (file: ChatFile): FileStatusResult | undefined => (file.path ? fileStatuses.value[file.path] : undefined)
const fileExists = (file: ChatFile): boolean => fileStatus(file)?.exists !== false

const markMissing = (path: string): void => {
  fileStatuses.value = {
    ...fileStatuses.value,
    [path]: { path, exists: false, isFile: false, error: 'not-found' }
  }
}

const refreshFileStatuses = async (): Promise<void> => {
  const paths = artifactFiles.value.map((file) => file.path || '').filter(Boolean)
  if (!paths.length) {
    fileStatuses.value = {}
    return
  }
  const statuses = await coach.getFileStatuses({ paths }).catch(() => [] as FileStatusResult[])
  fileStatuses.value = Object.fromEntries(statuses.map((status) => [status.path, status]))
}

const openFile = async (path?: string): Promise<void> => {
  if (!path) return
  const result = await coach.openFile({ path }).catch(() => null)
  if (!result?.ok) markMissing(path)
}

const showFileInFolder = async (path?: string): Promise<void> => {
  if (!path) return
  const result = await coach.showFileInFolder({ path }).catch(() => null)
  if (!result?.ok) markMissing(path)
}

const openSkillDirectory = async (skillId?: string): Promise<void> => {
  if (!skillId) return
  await coach.openSkillDirectory({ skillId }).catch(() => undefined)
}

watch(artifactPathKey, () => void refreshFileStatuses(), { immediate: true })
</script>

<template>
  <div name="messageItem" class="control-message-item flex items-start" :class="messageAlignClass(props.message)">
    <div class="flex max-w-[88%] flex-col gap-1" :class="isCoworkHuman(props.message) ? 'items-end' : 'items-start'">
      <div
        v-if="showBubble"
        name="messageItem__bubble"
        class="control-message-bubble relative max-w-full rounded-lg px-3 py-2"
        :class="messageBubbleClass(props.message)"
      >
        <div v-if="props.message.compressed" class="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
          Compressed
        </div>
        <template v-if="props.message.role === 'ai'">
          <ul
            v-if="visibleActivity.length"
            name="messageItem__activity"
            class="space-y-1 rounded-md bg-[rgb(248,250,252)] px-2 py-1.5"
            :class="props.message.content || messageSkills.length || props.message.replay || artifactFiles.length ? 'mb-2' : ''"
          >
            <li v-if="hiddenActivityCount" class="text-[10.5px] font-semibold leading-tight text-gray-400">
              {{ hiddenActivityCount }} earlier step{{ hiddenActivityCount === 1 ? '' : 's' }}
            </li>
            <li
              v-for="(a, i) in visibleActivity"
              :key="i"
              class="flex items-center gap-1.5 text-[11px] leading-tight opacity-85"
              :class="a.ok ? 'text-gray-600' : 'text-red-600'"
            >
              <span
                class="shrink-0 rounded px-1 py-px font-mono text-[9px] font-bold uppercase tracking-wide"
                :class="activityTagClass(a.phase)"
              >
                {{ activityTag(a.phase) }}
              </span>
              <span class="truncate">{{ a.label }}</span>
            </li>
          </ul>
          <MarkdownRender
            v-if="props.message.content"
            class="md control-message-markdown"
            :content="props.message.content"
            :is-dark="false"
            :max-live-nodes="props.message.streaming ? 0 : undefined"
            :code-block-props="{ lightTheme: 'github-light' }"
          />
          <div v-if="messageSkills.length" name="messageItem__skills" class="mt-2 flex flex-col gap-1.5">
            <div
              v-for="skill in messageSkills"
              :key="skill.id"
              name="messageItem__skill"
              class="rounded-md border border-violet-100 bg-violet-50/70 px-2.5 py-2"
            >
              <div class="flex min-w-0 items-center gap-2">
                <IconSparkles :size="16" stroke="1.8" class="shrink-0 text-violet-600" />
                <div class="min-w-0 flex-1 truncate text-[12px] font-semibold text-violet-950" :title="skill.name">{{ skill.name }}</div>
                <button
                  type="button"
                  class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-violet-500 hover:bg-white hover:text-violet-800"
                  title="Open skill folder"
                  aria-label="Open skill folder"
                  @click="openSkillDirectory(skill.id)"
                >
                  <IconFolderOpen :size="15" stroke="1.8" />
                </button>
              </div>
            </div>
          </div>
          <div
            v-if="props.message.replay"
            name="messageItem__replay"
            class="mt-2 rounded-md border px-2.5 py-2"
            :class="props.message.replay.ok ? 'border-emerald-100 bg-emerald-50/70' : 'border-red-100 bg-red-50/80'"
          >
            <div class="flex min-w-0 items-start gap-2">
              <IconActivity
                :size="16"
                stroke="1.8"
                class="mt-0.5 shrink-0"
                :class="props.message.replay.ok ? 'text-emerald-600' : 'text-red-500'"
              />
              <div class="min-w-0 flex-1">
                <div class="truncate text-[12px] font-semibold" :class="props.message.replay.ok ? 'text-emerald-950' : 'text-red-800'">
                  {{ props.message.replay.ok ? 'Run succeeded' : 'Run failed' }}
                  <span class="font-normal opacity-75">{{ replaySummary(props.message.replay) }}</span>
                </div>
                <div v-if="props.message.replay.errors.length" class="mt-0.5 line-clamp-2 text-[11px] leading-4 text-red-700">
                  {{ props.message.replay.errors.join('; ') }}
                </div>
                <div v-if="replayAuth(props.message.replay)" class="mt-1 text-[10.5px] leading-4 text-gray-500">
                  {{ replayAuth(props.message.replay) }}
                </div>
                <pre
                  v-if="replayPreview(props.message.replay)"
                  class="mt-1 max-h-[88px] overflow-auto whitespace-pre-wrap rounded bg-white/75 px-2 py-1 font-mono text-[10.5px] leading-4 text-gray-600"
                >{{ replayPreview(props.message.replay) }}</pre>
              </div>
            </div>
          </div>
          <div
            v-if="artifactFiles.length"
            name="messageItem__artifacts"
            class="mt-2 border-t border-gray-100 pt-2"
          >
            <div class="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-gray-400">Files</div>
            <div class="flex flex-col gap-1.5">
              <div
                v-for="(f, i) in artifactFiles"
                :key="f.path || i"
                class="flex min-w-0 items-center gap-2 rounded-md border border-[#e6edf5] bg-[#f8fafc] px-2 py-1.5"
                :class="fileExists(f) ? '' : 'border-red-100 bg-red-50/80'"
              >
                <component :is="fileIcon(f.name)" :size="16" stroke="1.8" class="shrink-0" :class="fileExists(f) ? 'text-[#64748b]' : 'text-red-400'" />
                <div class="min-w-0 flex-1">
                  <div class="flex min-w-0 items-center gap-1.5">
                    <span class="min-w-0 truncate text-[12px] font-semibold text-gray-800" :title="f.name">{{ f.name }}</span>
                    <span class="shrink-0 rounded bg-white px-1.5 py-px text-[10px] font-semibold text-gray-500">{{ fileMeta(f) }}</span>
                    <span v-if="!fileExists(f)" class="shrink-0 rounded bg-red-100 px-1.5 py-px text-[10px] font-semibold text-red-600">missing</span>
                  </div>
                  <div class="mt-0.5 truncate font-mono text-[10.5px] leading-4 text-[#64748b]" :title="filePathLabel(f)">
                    {{ filePathLabel(f) }}
                  </div>
                </div>
                <Trigger trigger="click" position="bottom" :popup-offset="6" :unmount-on-close="true" :content-style="{ padding: '0' }">
                  <button
                    type="button"
                    class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-500 hover:bg-white hover:text-gray-900"
                    title="File actions"
                    aria-label="File actions"
                  >
                    <IconDotsVertical :size="15" stroke="1.8" />
                  </button>
                  <template #content>
                    <div class="w-[156px] rounded-lg bg-white p-1.5 text-[12px] shadow-lg ring-1 ring-black/10">
                      <button
                        type="button"
                        class="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left font-semibold text-gray-700 transition hover:bg-black/5"
                        :disabled="!fileExists(f)"
                        :class="fileExists(f) ? '' : 'cursor-not-allowed opacity-50'"
                        @click="openFile(f.path)"
                      >
                        <IconExternalLink :size="14" stroke="1.8" />
                        <span>Open</span>
                      </button>
                      <button
                        type="button"
                        class="mt-1 flex h-8 w-full items-center gap-2 rounded-md px-2 text-left font-semibold text-gray-700 transition hover:bg-black/5"
                        :disabled="!fileExists(f)"
                        :class="fileExists(f) ? '' : 'cursor-not-allowed opacity-50'"
                        @click="showFileInFolder(f.path)"
                      >
                        <IconFolderOpen :size="14" stroke="1.8" />
                        <span>Show in folder</span>
                      </button>
                    </div>
                  </template>
                </Trigger>
              </div>
            </div>
          </div>
          <div
            v-if="showInitialLoading"
            name="messageItem__waiting"
            class="mt-1 flex items-center text-gray-400"
            title="Waiting for response"
          >
            <Spin :loading="true" :size="12" />
          </div>
          <div
            v-if="showThinking"
            name="messageItem__thinking"
            class="mt-2 flex items-center justify-end border-t border-gray-100 pt-2 text-[11px] font-semibold"
          >
            <span class="messageItem__thinkingText">Thinking...</span>
          </div>
        </template>
        <template v-else>
          <div v-if="props.message.type === 'files'" name="messageItem__files" class="flex flex-col gap-1 py-0.5">
            <span
              v-for="(f, i) in props.message.files || []"
              :key="i"
              :title="f.path || f.name"
              class="inline-flex max-w-full items-center gap-1.5 rounded-md bg-white/70 px-2 py-1 text-[12px] text-gray-700"
            >
              <component :is="fileIcon(f.name)" :size="15" stroke="1.8" class="shrink-0 text-gray-400" />
              <span class="truncate">{{ f.name }}</span>
            </span>
          </div>
          <div v-else name="messageItem__text" class="whitespace-pre-wrap break-words text-[13px] leading-5">{{ props.message.content }}</div>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.messageItem__thinkingText {
  background: linear-gradient(90deg, #64748b 0%, #94a3b8 38%, #0f172a 50%, #94a3b8 62%, #64748b 100%);
  background-size: 220% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  animation: messageItemThinkingShimmer 1.35s ease-in-out infinite;
}

@keyframes messageItemThinkingShimmer {
  0% {
    background-position: 120% 0;
  }

  100% {
    background-position: -120% 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .messageItem__thinkingText {
    animation: none;
    color: #64748b;
  }
}
</style>
