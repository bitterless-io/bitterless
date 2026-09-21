<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import MarkdownRender from 'markstream-vue'
import { Trigger } from '@arco-design/web-vue'
import { createXpcRendererEmitter } from 'electron-xpc/renderer'
import { IconActivity, IconDotsVertical, IconExternalLink, IconFolderOpen, IconSparkles } from '@tabler/icons-vue'
import { messageStore } from './store/message.store'
import type { AgentActivityStep, CoachXpcContract, FileStatusResult } from '@maestro-shared/coach.api'
import {
  linkifyOnlyPreviewReferences,
  parseOnlyPreviewReferenceHref
} from '@maestro-shared/fileReference.service'
import type { ChatFile, ChatMessage } from './store/message.type'
import AttachmentCard from './AttachmentCard.vue'
import ChatConfirm from './task/ChatConfirm.vue'
import ChatErrorCard from './task/ChatErrorCard.vue'
import TaskPart from './task/TaskPart.vue'
import { dismissMarkdownLinkTooltip } from './markdownLinkTooltip.service'
import './MessageItem.less'

const coach = createXpcRendererEmitter<CoachXpcContract>('CoachXpcHandler')
const props = defineProps<{ message: ChatMessage }>()
// 正文里的 `绝对路径[:行号]` 在这里被改写成引用链接(双击预览)。只关心**显示**,所以放在渲染前
// 的最后一步;代码块、行内代码、已有链接由 `linkifyOnlyPreviewReferences` 自己避开。
const displayContent = computed(() => linkifyOnlyPreviewReferences(props.message.content || ''))
const messageRoot = ref<HTMLElement | null>(null)
const fileStatuses = ref<Record<string, FileStatusResult>>({})

onBeforeUnmount(() => dismissMarkdownLinkTooltip(messageRoot.value))

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
const visibleActivity = computed(() => activityFeed.value.slice(-3))
const hiddenActivityCount = computed(() => Math.max(0, activityFeed.value.length - visibleActivity.value.length))
const artifactFiles = computed(() => (props.message.role === 'ai' ? (props.message.files || []).filter((file) => file.path) : []))
const taskParts = computed(() => (props.message.role === 'ai' ? props.message.tasks || [] : []))
const isTaskRow = computed(() => props.message.type === 'task')
const isConfirmRow = computed(() => props.message.type === 'confirm')
// 错误卡与 task/confirm 同级:它是一张**行卡**,不是气泡里的一段文字 ——
// 混在气泡里就只是一行红字,那正是 Ral 2026-09-10 说的「没展示出来」。
const isErrorRow = computed(() => props.message.type === 'error')
// 「刚被跳到的是不是我」—— **读 store,不在本组件里存第二份**。存副本就要自己接一个
// watch 去清它,而清晚一帧就是两行同时在闪:哪条在闪只能有一个真相。
const isJumped = computed(() => messageStore.highlightMessageId === props.message.id)
const artifactPathKey = computed(() => artifactFiles.value.map((file) => file.path || '').filter(Boolean).join('\n'))
const messageSkills = computed(() => {
  if (props.message.skills?.length) return props.message.skills
  return props.message.skill ? [props.message.skill] : []
})

const showBubble = computed(() => {
  const m = props.message
  if (isTaskRow.value || isConfirmRow.value || isErrorRow.value) return false
  if (m.role !== 'ai') return true
  return (
    Boolean(m.content) ||
    visibleActivity.value.length > 0 ||
    artifactFiles.value.length > 0 ||
    messageSkills.value.length > 0
  )
})

const messageBubbleClass = (message: ChatMessage): string => {
  if (message.source === 'connector') return 'message-item__bubble--connector'
  if (message.error) return 'message-item__bubble--error'
  // A slash command's receipt is `role: 'ai'`, so it reads exactly like the model's own answer.
  // Ral 2026-09-18:「这种快捷指令的输出改成淡灰色文字和 ai 主要回答区分开」. Keyed on `localOnly`,
  // which only this class of message carries — never on the wording. Paired with micromeet-cowork.
  if (message.localOnly) return 'message-item__bubble--notice'
  if (isMaestroHuman(message)) return 'message-item__bubble--human'
  return 'message-item__bubble--assistant'
}

const filePathLabel = (file: ChatFile): string => file.path || file.name
const fileStatus = (file: ChatFile): FileStatusResult | undefined => (file.path ? fileStatuses.value[file.path] : undefined)
const fileExists = (file: ChatFile): boolean => fileStatus(file)?.exists !== false

const markMissing = (path: string): void => {
  fileStatuses.value = {
    ...fileStatuses.value,
    [path]: { path, exists: false, isFile: false, isDirectory: false, error: 'not-found' }
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

// Absolute local links emitted by file tools reveal their target in Finder/Explorer. Network links
// remain normal Markdown links; the chat renderer must never navigate itself to a local path.
const RAW_LOCAL_PATH = /^(?:\/|[A-Za-z]:[\\/]|\\\\)/
const localPathFromHref = (href: string): string | null => {
  if (/^file:/i.test(href)) {
    try {
      const parsed = new URL(href)
      if (parsed.protocol !== 'file:') return null
      let path = decodeURIComponent(parsed.pathname)
      if (parsed.hostname && parsed.hostname.toLowerCase() !== 'localhost') {
        path = `//${parsed.hostname}${path}`
      } else if (/^\/[A-Za-z]:[\\/]/.test(path)) {
        // WHATWG file URLs keep a leading slash before a Windows drive letter.
        path = path.slice(1)
      }
      return path || null
    } catch {
      return null
    }
  }
  if (!RAW_LOCAL_PATH.test(href)) return null
  try {
    return decodeURIComponent(href)
  } catch {
    return null
  }
}

const onMarkdownClick = (event: MouseEvent): void => {
  const anchor = (event.target as HTMLElement | null)?.closest?.('a')
  if (!anchor) return
  const href = anchor.getAttribute('href') || ''
  // `file:line` 引用是**双击**打开的(下面 `onMarkdownDoubleClick`)。单击在这里被吃掉而不是放行:
  // 否则渲染库会把这个未知 scheme 当普通链接去导航,聊天窗口直接白掉。
  if (parseOnlyPreviewReferenceHref(href)) {
    event.preventDefault()
    event.stopPropagation()
    return
  }
  const path = localPathFromHref(href)
  if (!path) return
  event.preventDefault()
  event.stopPropagation()
  void showFileInFolder(path)
}

/**
 * 正文里 `路径:行号` 的**双击**打开(Ral 2026-09-21)。
 *
 * 为什么不是单击:这些路径出现在正文中间,人经常要**选中它复制**。单击打开会把复制这件事抢走;
 * 双击在这里把「双击选词」的语义换成「打开」,是冲突最小的那个选择。
 *
 * 注意它和上面那条产出物链接的差别:那条**单击**是「在 Finder 里定位」,这条是「在预览里看内容」。
 * 两个动作不同,所以两个手势 —— 不是同一件事的两种触发方式。
 */
const onMarkdownDoubleClick = (event: MouseEvent): void => {
  const anchor = (event.target as HTMLElement | null)?.closest?.('a')
  if (!anchor) return
  const reference = parseOnlyPreviewReferenceHref(anchor.getAttribute('href') || '')
  if (!reference) return
  event.preventDefault()
  event.stopPropagation()
  void coach.openWorkspaceInPreview({ path: reference.path, line: reference.line }).catch(() => undefined)
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
  <div
    ref="messageRoot"
    name="messageItem"
    class="message-item"
    :class="[messageAlignClass(props.message), { 'message-item--jumped': isJumped }]"
    :data-message-id="props.message.id"
  >
    <div
      class="message-item__content"
      :class="{
        'message-item__content--human': isMaestroHuman(props.message),
        'message-item__content--timeline': isTaskRow || isConfirmRow || isErrorRow
      }"
    >
      <div v-if="isTaskRow" name="messageItem__tasks" class="message-item__tasks">
        <TaskPart v-for="part in taskParts" :key="part.taskId" :part="part" />
      </div>
      <ChatConfirm v-else-if="isConfirmRow" :message="props.message" />
      <ChatErrorCard v-else-if="isErrorRow" :message="props.message" />
      <div
        v-else-if="showBubble"
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
            :class="{ 'message-activity--spaced': props.message.content || messageSkills.length || artifactFiles.length }"
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
          <div
            v-if="props.message.content"
            class="message-item__markdown"
            @click="onMarkdownClick"
            @dblclick="onMarkdownDoubleClick"
          >
            <MarkdownRender
              :content="displayContent"
              :is-dark="false"
              :max-live-nodes="props.message.streaming ? 0 : undefined"
              :code-block-props="{ lightTheme: 'github-light' }"
            />
          </div>
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
            v-if="artifactFiles.length"
            name="messageItem__artifacts"
            class="message-artifacts"
          >
            <div class="message-artifacts__title">Files</div>
            <div name="messageItem__attachments" class="message-artifacts__list">
              <div
                v-for="(f, i) in artifactFiles"
                :key="f.path || i"
                class="message-artifacts__file"
              >
                <AttachmentCard
                  :name="f.name"
                  :path="filePathLabel(f)"
                  :is-directory="f.isDirectory"
                  :missing="!fileExists(f)"
                />
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
        </template>
        <template v-else>
          <div v-if="props.message.type === 'files'" name="messageItem__files" class="message-files">
            <AttachmentCard
              v-for="(f, i) in props.message.files || []"
              :key="f.path || i"
              :name="f.name"
              :path="f.path || ''"
              :is-directory="f.isDirectory"
            />
          </div>
          <div v-else name="messageItem__text" class="message-item__text">{{ props.message.content }}</div>
        </template>
      </div>
    </div>
  </div>
</template>
