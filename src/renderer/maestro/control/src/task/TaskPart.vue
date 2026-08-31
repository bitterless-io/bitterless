<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { Message } from '@arco-design/web-vue'
import { IconChevronRight } from '@tabler/icons-vue'
import { createXpcRendererEmitter } from 'electron-xpc/renderer'
import type { CoachXpcContract } from '@maestro-shared/coach.api'
import {
  stallHint,
  type MaestroTask,
  type MaestroTaskArtifact,
  type MaestroTaskKind,
  type MaestroTaskPart,
  type MaestroTaskState
} from '@maestro-shared/task.api'
import { taskStore } from '../store/task.store'
import './TaskPart.less'

interface TaskView {
  name: string
  kind: MaestroTaskKind
  state: MaestroTaskState
}

const props = defineProps<{ part: MaestroTaskPart }>()
const coach = createXpcRendererEmitter<CoachXpcContract>('CoachXpcHandler')
const expanded = ref(false)
const liveTask = computed<MaestroTask | undefined>(() => taskStore.get(props.part.taskId))
const task = computed<TaskView>(() => liveTask.value || props.part)
const artifacts = computed<MaestroTaskArtifact[]>(() => liveTask.value?.artifacts || [])
const alive = computed(
  () => task.value.state.status === 'pending' || task.value.state.status === 'running'
)
const pulsing = computed(
  () => task.value.state.status === 'running' && !task.value.state.stalled
)
const hasDetail = computed(() =>
  Boolean(
    task.value.state.output.length ||
      task.value.state.result ||
      task.value.state.error ||
      artifacts.value.length
  )
)

const statusTone = (value: TaskView): 'error' | 'stalled' | 'running' | 'completed' => {
  if (value.state.status === 'error') return 'error'
  if (value.state.stalled) return 'stalled'
  if (value.state.status === 'running' || value.state.status === 'pending') return 'running'
  return 'completed'
}
const statusLabel = (value: TaskView): string =>
  value.state.status === 'error'
    ? 'failed'
    : value.state.stalled
      ? 'stalled'
      : value.state.status
const percent = (value: TaskView): number => {
  const progress = value.state.progress
  if (!progress) return 0
  if (typeof progress.ratio === 'number') {
    return Math.max(0, Math.min(100, Math.round(progress.ratio * 100)))
  }
  if (progress.total && progress.done !== undefined) {
    return Math.max(0, Math.min(100, Math.round((progress.done / progress.total) * 100)))
  }
  return 0
}

const tick = ref(0)
const elapsed = (value: TaskView): string => {
  void tick.value
  const ms = (value.state.time.end || Date.now()) - value.state.time.start
  if (ms < 60_000) return `${Math.round(ms / 1_000)}s`
  return `${Math.floor(ms / 60_000)}m${String(Math.round((ms % 60_000) / 1_000)).padStart(2, '0')}s`
}
const outputTail = (value: TaskView): string =>
  value.state.output
    .slice(-60)
    .map((line) => (line.level === 'info' ? '' : `[${line.level}] `) + line.text)
    .join('\n')

const reveal = async (path: string): Promise<void> => {
  const result = await coach.showFileInFolder({ path }).catch(() => null)
  if (!result?.ok) Message.warning(result?.error || 'Could not show this path.')
}

let clock: ReturnType<typeof setInterval> | undefined
const stopClock = (): void => {
  if (!clock) return
  clearInterval(clock)
  clock = undefined
}
watch(
  alive,
  (active) => {
    if (!active) return stopClock()
    if (!clock) clock = setInterval(() => (tick.value += 1), 1_000)
  },
  { immediate: true }
)
onUnmounted(stopClock)
</script>

<template>
  <div name="maestro__task_part" class="task-part" :class="`task-part--${statusTone(task)}`">
    <button
      type="button"
      class="task-part__head"
      :disabled="!hasDetail"
      :title="hasDetail ? 'Show task output' : ''"
      @click="expanded = !expanded"
    >
      <span class="task-part__rail" :class="{ 'task-part__rail--pulse': pulsing }"></span>
      <span class="task-part__name">{{ task.name }}</span>
      <span class="task-part__status">{{ statusLabel(task) }}</span>
      <span v-if="task.kind === 'builtin'" class="task-part__kind">built-in</span>
      <span v-if="task.state.progress?.total" class="task-part__progress-count">
        {{ task.state.progress.done ?? 0 }}/{{ task.state.progress.total }}
      </span>
      <span class="task-part__elapsed">{{ elapsed(task) }}</span>
      <span class="task-part__spacer"></span>
      <IconChevronRight
        v-if="hasDetail"
        :size="13"
        stroke="1.8"
        class="task-part__chevron"
        :class="{ 'task-part__chevron--open': expanded }"
      />
    </button>

    <div class="task-part__title" :title="task.state.title">{{ task.state.title }}</div>
    <div v-if="percent(task) > 0" class="task-part__progress">
      <div class="task-part__progress-bar" :style="{ width: `${percent(task)}%` }"></div>
    </div>

    <div v-if="task.state.pendingConfirm" class="task-part__confirm-hint">
      Waiting for your decision: {{ task.state.pendingConfirm.title }}
    </div>
    <div v-if="task.state.stalled && !task.state.pendingConfirm" class="task-part__stall">
      {{ stallHint(task.name).en }}
    </div>

    <div v-if="expanded && hasDetail" class="task-part__detail">
      <div v-if="task.state.droppedLines" class="task-part__dropped">
        … {{ task.state.droppedLines }} earlier line{{ task.state.droppedLines === 1 ? '' : 's' }} dropped
      </div>
      <pre v-if="task.state.output.length" class="task-part__output">{{ outputTail(task) }}</pre>
      <div v-if="task.state.result" class="task-part__result">{{ task.state.result }}</div>
      <div v-if="task.state.error" class="task-part__error">{{ task.state.error }}</div>
      <div v-if="artifacts.length" class="task-part__artifacts">
        <button
          v-for="artifact in artifacts"
          :key="artifact.path"
          type="button"
          class="task-part__artifact"
          :title="`Show in folder: ${artifact.path}`"
          @click="reveal(artifact.path)"
        >
          {{ artifact.label }}: {{ artifact.path }}
        </button>
      </div>
    </div>
  </div>
</template>
