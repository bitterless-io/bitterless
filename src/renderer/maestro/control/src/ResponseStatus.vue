<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import {
  IconAlertTriangle,
  IconChevronDown,
  IconClock,
  IconCornerDownRight
} from '@tabler/icons-vue'
import { isTaskLive, type MaestroTask } from '@maestro-shared/task.api'
import type { MessageSession } from './store/message.type'
import { isRejection } from './store/turn.service'
import { messageStore } from './store/message.store'
import { taskStore } from './store/task.store'
import './ResponseStatus.less'

const props = defineProps<{ session: MessageSession }>()

interface StatusView {
  tone: 'wait' | 'run'
  text: string
  meta?: string
  subject?: MaestroTask
  background?: boolean
}

const tick = ref(Date.now())
const turn = computed(() => props.session.turn)
const live = computed(() => taskStore.tasks.filter((task) => isTaskLive(task)))
const confirming = computed(() => live.value.find((task) => task.state.pendingConfirm))
const waiting = computed(() => live.value.find((task) => task.state.waitingFor))

const taskLabel = (task: MaestroTask): string => task.state.title || task.name
const compactNumber = (value: number): string =>
  value >= 1_000_000
    ? `${(value / 1_000_000).toFixed(1)}M`
    : value >= 1_000
      ? `${Math.round(value / 1_000)}K`
      : String(value)

const elapsed = (from: number): string => {
  const ms = Math.max(0, tick.value - from)
  if (ms < 60_000) return `${Math.round(ms / 1_000)}s`
  return `${Math.floor(ms / 60_000)}m${String(Math.round((ms % 60_000) / 1_000)).padStart(2, '0')}s`
}

const taskMeta = (task: MaestroTask): string => {
  const progress = task.state.progress
  const parts: string[] = []
  if (progress?.total) parts.push(`${progress.done ?? 0}/${progress.total}`)
  if (progress?.subject) parts.push(progress.subject)
  if (progress?.tokens) parts.push(`${compactNumber(progress.tokens)} tokens`)
  parts.push(elapsed(task.state.time.start))
  return parts.join(' · ')
}

const status = computed<StatusView | null>(() => {
  const retry = turn.value?.retry
  if (retry) return { tone: 'wait', text: `retried: ${retry.attempt}/${retry.max}` }

  const confirm = confirming.value
  if (confirm) {
    return {
      tone: 'wait',
      text: `Waiting for your decision · ${confirm.state.pendingConfirm?.title || taskLabel(confirm)}`,
      meta: 'Use the action panel below',
      subject: confirm
    }
  }

  const held = waiting.value
  if (held) {
    return {
      tone: 'run',
      text: `${taskLabel(held)} · waiting for ${held.state.waitingFor}`,
      meta: taskMeta(held),
      subject: held,
      background: !turn.value
    }
  }

  const running = live.value[0]
  if (running) {
    return {
      tone: 'run',
      text: taskLabel(running),
      meta: taskMeta(running),
      subject: running,
      background: !turn.value
    }
  }

  const active = turn.value
  if (!active) return null
  if (active.aborting) return { tone: 'wait', text: 'Stopping…' }
  if (active.thinking) return { tone: 'run', text: 'Thinking…', meta: elapsed(active.startedAt) }
  const latest = active.activity[active.activity.length - 1]
  if (latest) return { tone: 'run', text: latest.label, meta: elapsed(active.startedAt) }
  return {
    tone: 'run',
    text: active.phase === 'streaming' ? 'Responding…' : 'Sent · waiting for a response…',
    meta: elapsed(active.startedAt)
  }
})

const canRetry = computed(() =>
  Boolean(props.session.retryable && !messageStore.turnService.activeTurn())
)
const retriedLabel = computed(() => {
  const retry = props.session.retryable
  return retry ? `retried: ${retry.attempt}/${retry.max}` : ''
})
const steeringLabel = computed(() => {
  const steering = props.session.turn?.steering
  if (!steering) return ''
  return steering.pending
    ? 'Adding your message to this turn…'
    : `Added to this turn · ${steering.count}`
})

const retryAgain = async (): Promise<void> => {
  const previous = props.session.retryable
  if (!previous) return
  const root = props.session.messages.find((message) => message.id === previous.rootHumanMessageId)
  const text = root?.content || previous.rootText
  if (!text.trim()) return
  props.session.retryable = undefined
  const result = await messageStore.turnService.send(props.session.id, text)
  if (!result || isRejection(result)) props.session.retryable = previous
}

const roster = computed(() => live.value.filter((task) => task !== status.value?.subject))
const rosterOpen = ref(false)
const rosterLabel = computed(() => `${roster.value.length} other running task${roster.value.length === 1 ? '' : 's'}`)
const rootEl = ref<HTMLElement | null>(null)

const onDocumentPointer = (event: MouseEvent): void => {
  if (!rosterOpen.value) return
  if (rootEl.value && event.target instanceof Node && rootEl.value.contains(event.target)) return
  rosterOpen.value = false
}
const onDocumentKeydown = (event: KeyboardEvent): void => {
  if (event.key === 'Escape') rosterOpen.value = false
}

let clock: ReturnType<typeof setInterval> | undefined
const stopClock = (): void => {
  if (!clock) return
  clearInterval(clock)
  clock = undefined
}

watch(
  () => Boolean(status.value),
  (active) => {
    if (!active) return stopClock()
    if (!clock) clock = setInterval(() => (tick.value = Date.now()), 1_000)
  },
  { immediate: true }
)
watch(
  () => roster.value.length,
  (count) => {
    if (!count) rosterOpen.value = false
  }
)

onMounted(() => {
  document.addEventListener('mousedown', onDocumentPointer)
  document.addEventListener('keydown', onDocumentKeydown)
})
onUnmounted(() => {
  stopClock()
  document.removeEventListener('mousedown', onDocumentPointer)
  document.removeEventListener('keydown', onDocumentKeydown)
})
</script>

<template>
  <div
    v-if="status || canRetry || steeringLabel"
    ref="rootEl"
    name="maestro__response_status"
    class="response-status"
  >
    <div v-if="rosterOpen && roster.length" class="response-status__roster">
      <div v-for="task in roster" :key="task.id" class="response-status__task-row">
        <span class="response-status__task-name">{{ task.name }}</span>
        <span class="response-status__task-title" :title="taskLabel(task)">{{ taskLabel(task) }}</span>
        <span class="response-status__task-meta">{{ taskMeta(task) }}</span>
      </div>
    </div>

    <div v-if="canRetry" class="response-status__retry">
      <IconAlertTriangle :size="13" stroke="1.9" />
      <span class="response-status__retry-count">{{ retriedLabel }}</span>
      <button type="button" class="response-status__retry-button" @click="retryAgain">
        Try again
      </button>
    </div>

    <div v-if="steeringLabel" class="response-status__steering">
      <IconCornerDownRight :size="13" stroke="1.9" />
      <span :title="steeringLabel">{{ steeringLabel }}</span>
    </div>

    <div v-if="status" class="response-status__bar">
      <span
        class="response-status__dot"
        :class="{
          'response-status__dot--wait': status.tone === 'wait',
          'response-status__dot--run': status.tone === 'run'
        }"
      ></span>
      <IconAlertTriangle v-if="status.tone === 'wait'" :size="13" stroke="1.9" />
      <div class="response-status__copy">
        <span class="response-status__text" :class="`response-status__text--${status.tone}`" :title="status.text">
          {{ status.text }}
        </span>
        <span v-if="status.background" class="response-status__background">background</span>
        <span v-if="status.meta" class="response-status__meta">{{ status.meta }}</span>
      </div>
      <button
        v-if="roster.length"
        type="button"
        class="response-status__others"
        :title="rosterLabel"
        @click="rosterOpen = !rosterOpen"
      >
        <span>+{{ roster.length }}</span>
        <IconChevronDown :size="10" stroke="2.4" :class="{ 'response-status__chevron--open': rosterOpen }" />
      </button>
      <IconClock v-if="status.tone === 'wait'" :size="12" stroke="1.8" class="response-status__clock" />
    </div>
  </div>
</template>
