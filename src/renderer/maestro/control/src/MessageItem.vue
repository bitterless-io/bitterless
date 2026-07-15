<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import MarkdownRender from 'markstream-vue'
import { Spin, Trigger } from '@arco-design/web-vue'
import { createXpcRendererEmitter } from 'electron-xpc/renderer'
import { IconActivity, IconDotsVertical, IconExternalLink, IconFolderOpen, IconSparkles } from '@tabler/icons-vue'
import type { AgentActivityStep, CoachXpcContract, FileStatusResult, ReplayResult } from '@maestro-shared/coach.api'
import type { ChatFile, ChatMessage } from './store/message.type'
import { fileIcon } from './fileIcon'
import './MessageItem.less'

const coach = createXpcRendererEmitter<CoachXpcContract>('CoachXpcHandler')
const props = defineProps<{ message: ChatMessage }>()
const fileStatuses = ref<Record<string, FileStatusResult>>({})

const ACTIVITY_TAGS: Record<AgentActivityStep['phase'], { tag: string; cls: string }> = {
  think: { tag: 'think', cls: 'message-activity__tag--think' },
  tool: { tag: 'tool', cls: 'message-activity__tag--tool' },
  skill: { tag: 'skill', cls: 'message-activity__tag--skill' },
  observe: { tag: 'see', cls: 'message-activity__tag--observe' },
  act: { tag: 'do', cls: 'message-activity__tag--act' },
  'api-read': { tag: 'read api', cls: 'message-activity__tag--api-read' },
  'api-call': { tag: 'call api', cls: 'message-activity__tag--api-call' },
  api: { tag: 'api', cls: 'message-activity__tag--api-call' },
  tab: { tag: 'tab', cls: 'message-activity__tag--tab' }
}

const isMaestroHuman = (message: ChatMessage): boolean => message.source === 'cowork' && message.role === 'human'
const activityTag = (phase: AgentActivityStep['phase']): string => ACTIVITY_TAGS[phase]?.tag || phase
const activityTagClass = (phase: AgentActivityStep['phase']): string => ACTIVITY_TAGS[phase]?.cls || 'message-activity__tag--think'
const messageAlignClass = (message: ChatMessage): string => (isMaestroHuman(message) ? 'message-item--human' : 'message-item--assistant')

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
  if (message.source === 'connector') return 'message-item__bubble--connector'
  if (message.error) return 'message-item__bubble--error'
  if (isMaestroHuman(message)) return 'message-item__bubble--human'
  return 'message-item__bubble--assistant'
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
  <div name="messageItem" class="message-item" :class="messageAlignClass(props.message)">
    <div class="message-item__content" :class="{ 'message-item__content--human': isMaestroHuman(props.message) }">
      <div
        v-if="showBubble"
        name="messageItem__bubble"
        class="message-item__bubble"
        :class="messageBubbleClass(props.message)"
      >
        <div v-if="props.message.compressed" class="message-item__compressed">
          Compressed
        </div>
        <template v-if="props.message.role === 'ai'">
          <ul
            v-if="visibleActivity.length"
            name="messageItem__activity"
            class="message-activity"
            :class="{ 'message-activity--spaced': props.message.content || messageSkills.length || props.message.replay || artifactFiles.length }"
          >
            <li v-if="hiddenActivityCount" class="message-activity__hidden">
              {{ hiddenActivityCount }} earlier step{{ hiddenActivityCount === 1 ? '' : 's' }}
            </li>
            <li
              v-for="(a, i) in visibleActivity"
              :key="i"
              class="message-activity__step"
              :class="{ 'message-activity__step--error': !a.ok }"
            >
              <span
                class="message-activity__tag"
                :class="activityTagClass(a.phase)"
              >
                {{ activityTag(a.phase) }}
              </span>
              <span class="message-activity__label">{{ a.label }}</span>
            </li>
          </ul>
          <MarkdownRender
            v-if="props.message.content"
            class="message-item__markdown"
            :content="props.message.content"
            :is-dark="false"
            :max-live-nodes="props.message.streaming ? 0 : undefined"
            :code-block-props="{ lightTheme: 'github-light' }"
          />
          <div v-if="messageSkills.length" name="messageItem__skills" class="message-skills">
            <div
              v-for="skill in messageSkills"
              :key="skill.id"
              name="messageItem__skill"
              class="message-skills__card"
            >
              <div class="message-skills__row">
                <IconSparkles :size="16" stroke="1.8" class="message-skills__icon" />
                <div class="message-skills__name" :title="skill.name">{{ skill.name }}</div>
                <button
                  type="button"
                  class="message-skills__open"
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
            class="message-replay"
            :class="props.message.replay.ok ? 'message-replay--success' : 'message-replay--error'"
          >
            <div class="message-replay__row">
              <IconActivity
                :size="16"
                stroke="1.8"
                class="message-replay__icon"
              />
              <div class="message-replay__content">
                <div class="message-replay__title">
                  {{ props.message.replay.ok ? 'Run succeeded' : 'Run failed' }}
                  <span class="message-replay__summary">{{ replaySummary(props.message.replay) }}</span>
                </div>
                <div v-if="props.message.replay.errors.length" class="message-replay__errors">
                  {{ props.message.replay.errors.join('; ') }}
                </div>
                <div v-if="replayAuth(props.message.replay)" class="message-replay__auth">
                  {{ replayAuth(props.message.replay) }}
                </div>
                <pre
                  v-if="replayPreview(props.message.replay)"
                  class="message-replay__preview"
                >{{ replayPreview(props.message.replay) }}</pre>
              </div>
            </div>
          </div>
          <div
            v-if="artifactFiles.length"
            name="messageItem__artifacts"
            class="message-artifacts"
          >
            <div class="message-artifacts__title">Files</div>
            <div class="message-artifacts__list">
              <div
                v-for="(f, i) in artifactFiles"
                :key="f.path || i"
                class="message-artifacts__file"
                :class="{ 'message-artifacts__file--missing': !fileExists(f) }"
              >
                <component :is="fileIcon(f.name)" :size="16" stroke="1.8" class="message-artifacts__icon" />
                <div class="message-artifacts__body">
                  <div class="message-artifacts__heading">
                    <span class="message-artifacts__name" :title="f.name">{{ f.name }}</span>
                    <span class="message-artifacts__meta">{{ fileMeta(f) }}</span>
                    <span v-if="!fileExists(f)" class="message-artifacts__missing">missing</span>
                  </div>
                  <div class="message-artifacts__path" :title="filePathLabel(f)">
                    {{ filePathLabel(f) }}
                  </div>
                </div>
                <Trigger trigger="click" position="bottom" :popup-offset="6" :unmount-on-close="true" :content-style="{ padding: '0' }">
                  <button
                    type="button"
                    class="message-artifacts__actions"
                    title="File actions"
                    aria-label="File actions"
                  >
                    <IconDotsVertical :size="15" stroke="1.8" />
                  </button>
                  <template #content>
                    <div class="message-artifacts__menu">
                      <button
                        type="button"
                        class="message-artifacts__menu-item"
                        :disabled="!fileExists(f)"
                        @click="openFile(f.path)"
                      >
                        <IconExternalLink :size="14" stroke="1.8" />
                        <span>Open</span>
                      </button>
                      <button
                        type="button"
                        class="message-artifacts__menu-item"
                        :disabled="!fileExists(f)"
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
            class="message-item__waiting"
            title="Waiting for response"
          >
            <Spin :loading="true" :size="12" />
          </div>
          <div
            v-if="showThinking"
            name="messageItem__thinking"
            class="message-item__thinking"
          >
            <span class="message-item__thinking-text">Thinking...</span>
          </div>
        </template>
        <template v-else>
          <div v-if="props.message.type === 'files'" name="messageItem__files" class="message-files">
            <span
              v-for="(f, i) in props.message.files || []"
              :key="i"
              :title="f.path || f.name"
              class="message-files__item"
            >
              <component :is="fileIcon(f.name)" :size="15" stroke="1.8" class="message-files__icon" />
              <span class="message-files__name">{{ f.name }}</span>
            </span>
          </div>
          <div v-else name="messageItem__text" class="message-item__text">{{ props.message.content }}</div>
        </template>
      </div>
    </div>
  </div>
</template>
