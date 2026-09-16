<script setup lang="ts">
import { computed, nextTick, onBeforeUpdate, onMounted, onUnmounted, onUpdated, ref, watch } from 'vue'
import { IconAlertTriangle, IconCheck, IconChevronDown, IconClock, IconLoader2, IconPlayerPause, IconPlayerPlay, IconPlayerStop, IconRefresh, IconSquares, IconX } from '@tabler/icons-vue'
import IconBtn from '@renderer/common/components/IconBtn/IconBtn.vue'
import { isWorkflowAgentActive, isWorkflowAgentLive, type WorkflowAgentTask, type WorkflowRunSnapshot } from '@shared/agentWorkflow.api'
import { workflowStore } from './store/workflow.store'
import { workflowText } from './workflow.text'
import { groupWorkflowTasks, newestWorkflowRuns } from './workflow.presentation'
import './WorkflowTaskBar.less'

const props = defineProps<{ sessionId: string; history?: boolean }>()
const emit = defineEmits<{ close: [] }>()
const text = computed(workflowText)
const root = ref<HTMLElement>()
const trigger = ref<HTMLButtonElement>()
const list = ref<HTMLElement>()
const open = ref(Boolean(props.history))
const expanded = ref<string | null>(null)
const maximumHeight = ref(360)
const tick = ref(Date.now())
const pending = ref(new Set<string>())
const actionError = ref('')
const runs = computed(() => workflowStore.runs.filter(run => run.sessionId === props.sessionId))
const tasks = computed(() => runs.value.flatMap(run => run.agents))
const active = computed(() => tasks.value.filter(task => isWorkflowAgentActive(task.status)))
const groups = computed(() => groupWorkflowTasks(runs.value).map(group => ({ ...group, tasks: props.history ? group.tasks : group.tasks.filter(task => isWorkflowAgentActive(task.status)) })).filter(group => group.tasks.length))
const latestRun = computed(() => newestWorkflowRuns(runs.value)[0])
const historyOpen = ref({ failed: false, stopped: false })
const liveRuns = computed(() => runs.value.filter(run => run.status === 'running' || run.status === 'stopping'))
const cleanupFailed = computed(() => liveRuns.value.some(run => Boolean(run.error)))
const canRetry = (task: WorkflowAgentTask): boolean => Boolean(actionError.value || runs.value.find(run => run.id === task.runId)?.error)
const cancellable = computed(() => liveRuns.value.some(run => run.status === 'running') || cleanupFailed.value || Boolean(actionError.value))
const busyAll = computed(() => pending.value.has(props.sessionId))
const count = computed(() => text.value.count.replace('{count}', String(active.value.length)))
const summary = computed(() => {
  if (cleanupFailed.value) return text.value.stopError
  if (active.value.length && active.value.every(task => task.status === 'stopping')) return text.value.stoppingAll
  const confirmations = active.value.filter(task => task.status === 'approval').length
  if (confirmations) return text.value.waiting.replace('{count}', String(confirmations))
  if (liveRuns.value.some(run => run.status === 'running')) return text.value.working
  const latest = latestRun.value
  if (!latest) return ''
  const failures = latest.agents.filter(task => task.status === 'failed').length
  if (failures) return text.value.failures.replace('{count}', String(failures))
  if (latest.status === 'failed') return latest.error || text.value.failures.replace('{count}', '1')
  if (latest.status === 'stopped') return text.value.states.stopped
  return liveRuns.value.length ? text.value.working : text.value.complete
})
const identity = (task: WorkflowAgentTask) => `${task.runId}:${task.id}`
const duration = (milliseconds: number): string => {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000))
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}
const elapsed = (task: WorkflowAgentTask): string => duration((task.endedAt ?? tick.value) - (task.startedAt ?? task.queuedAt))
const runElapsed = computed(() => {
  const current = runs.value.filter(run => run.status === 'running' || run.status === 'stopping')
  const latest = latestRun.value
  return current.length ? duration(tick.value - Math.min(...current.map(run => run.createdAt))) : latest ? duration((latest.endedAt ?? tick.value) - latest.createdAt) : ''
})
const statusIcon = (task: WorkflowAgentTask) => task.status === 'completed' ? IconCheck : task.status === 'failed' ? IconAlertTriangle : task.status === 'stopped' ? IconPlayerStop : task.status === 'running' || task.status === 'stopping' ? IconLoader2 : IconClock
const updateGeometry = (): void => {
  const shell = root.value?.closest('.chat-panel')
  if (!shell || !root.value) return
  const top = shell.querySelector('.chat-panel__toolbar')?.getBoundingClientRect().bottom ?? shell.getBoundingClientRect().top
  maximumHeight.value = Math.max(0, Math.min(360, root.value.getBoundingClientRect().top - top - 12))
}
let scrollTop = 0
onBeforeUpdate(() => { if (list.value) scrollTop = list.value.scrollTop })
onUpdated(() => { if (list.value) list.value.scrollTop = scrollTop; updateGeometry() })
const toggle = async (): Promise<void> => {
  open.value = !open.value
  await nextTick()
  updateGeometry()
}
const close = (focus = false): void => { open.value = false; if (props.history) emit('close'); if (focus) trigger.value?.focus() }
const stop = async (task?: WorkflowAgentTask): Promise<void> => {
  const sessionId = props.sessionId
  const key = task ? identity(task) : sessionId
  if (pending.value.has(key)) return
  pending.value.add(key)
  actionError.value = ''
  try {
    if (task) await workflowStore.stopAgent(sessionId, task.runId, task.id)
    else await workflowStore.stopSession(sessionId)
  } catch { if (props.sessionId === sessionId) actionError.value = text.value.stopError }
  finally { pending.value.delete(key) }
}
const retry = async (run: WorkflowRunSnapshot): Promise<void> => {
  const sessionId = props.sessionId
  const key = `retry:${run.id}`
  if (pending.value.has(key)) return
  pending.value.add(key)
  actionError.value = ''
  try { await workflowStore.retry(sessionId, run.id) }
  catch (error) { if (props.sessionId === sessionId) actionError.value = error instanceof Error ? error.message : text.value.retryError }
  finally { pending.value.delete(key) }
}
const pauseOrResume = async (task: WorkflowAgentTask): Promise<void> => {
  const key = identity(task)
  if (pending.value.has(key)) return
  pending.value.add(key)
  try {
    if (task.status === 'paused' || task.status === 'pausing') await workflowStore.resumeAgent(props.sessionId, task.runId, task.id)
    else await workflowStore.pauseAgent(props.sessionId, task.runId, task.id)
  } catch (error) { actionError.value = error instanceof Error ? error.message : text.value.stopError }
  finally { pending.value.delete(key) }
}
const taskRun = (task: WorkflowAgentTask) => runs.value.find(run => run.id === task.runId)
const pointer = (event: PointerEvent): void => { if (!props.history && open.value && event.target instanceof Node && !root.value?.contains(event.target)) close() }
const keydown = (event: KeyboardEvent): void => { if (open.value && event.key === 'Escape') { event.preventDefault(); close(true) } }
watch(() => props.sessionId, () => { close(); expanded.value = null; scrollTop = 0; actionError.value = '' })
watch(() => active.value.length, count => { if (!count && !props.history) close() })
watch(() => latestRun.value?.id, () => {
  historyOpen.value = { failed: false, stopped: false }
  expanded.value = null
  scrollTop = 0
  if (list.value) list.value.scrollTop = 0
  void nextTick(() => { if (list.value) list.value.scrollTop = 0 })
})
let observer: ResizeObserver | undefined
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  void workflowStore.init()
  observer = new ResizeObserver(updateGeometry)
  const shell = root.value?.closest('.chat-panel')
  if (shell) observer.observe(shell)
  const composer = root.value?.closest('.chat-panel__composer')
  if (composer) observer.observe(composer)
  document.addEventListener('pointerdown', pointer)
  document.addEventListener('keydown', keydown)
  timer = setInterval(() => { if (runs.value.some(run => run.status === 'running' || run.status === 'stopping')) tick.value = Date.now() }, 1000)
  updateGeometry()
})
onUnmounted(() => { observer?.disconnect(); clearInterval(timer); document.removeEventListener('pointerdown', pointer); document.removeEventListener('keydown', keydown) })
</script>

<template>
  <div v-show="history || active.length > 0" ref="root" name="workflow-taskbar" class="workflow-taskbar" :class="{ 'workflow-taskbar--history': history }">
    <section v-if="open" class="workflow-taskbar__popover" name="workflow-taskbar__popover" :aria-label="text.current" :style="{ maxHeight: history ? '65vh' : `${maximumHeight}px` }">
      <header class="workflow-taskbar__header" name="workflow-taskbar__header">
        <strong>{{ text.current }}</strong>
        <div class="workflow-taskbar__actions">
          <button v-if="liveRuns.length" type="button" class="workflow-taskbar__stop-all" :disabled="busyAll || !cancellable" @click="stop()">{{ busyAll || !cancellable ? text.stoppingAll : text.stopAll }}</button>
          <IconBtn class="workflow-taskbar__icon-button" :title="text.collapse" :aria-label="text.collapse" @click="close(true)"><IconX :size="14" /></IconBtn>
        </div>
      </header>
      <div ref="list" class="workflow-taskbar__list" name="workflow-taskbar__list" tabindex="0" :aria-label="text.current">
        <section v-for="group in groups" :key="group.category" class="workflow-taskbar__category" name="workflow-taskbar__category" :data-category="group.category">
          <button v-if="group.category === 'failed' || group.category === 'stopped'" type="button" class="workflow-taskbar__category-toggle" :aria-expanded="historyOpen[group.category]" @click="historyOpen[group.category] = !historyOpen[group.category]">
            <IconChevronDown :size="12" :class="{ 'workflow-taskbar__category-chevron--closed': !historyOpen[group.category] }" /><strong>{{ text.categories[group.category] }}</strong><span v-if="group.tasks.length">{{ group.tasks.length }}</span>
          </button>
          <h3 v-else class="workflow-taskbar__category-title">{{ text.categories[group.category] }}<span v-if="group.tasks.length">{{ group.tasks.length }}</span></h3>
          <template v-if="(group.category !== 'failed' && group.category !== 'stopped') || historyOpen[group.category]">
          <article v-for="task in group.tasks" :key="identity(task)" class="workflow-taskbar__row" name="workflow-taskbar__row" :data-agent-id="task.id" :data-status="task.status" :class="{ 'workflow-taskbar__row--expanded': expanded === identity(task) }">
            <div class="workflow-taskbar__row-line">
              <button type="button" class="workflow-taskbar__task" :aria-expanded="expanded === identity(task)" @click="expanded = expanded === identity(task) ? null : identity(task)">
                <component :is="statusIcon(task)" :size="15" class="workflow-taskbar__state-icon" />
                <span class="workflow-taskbar__copy">
                  <span class="workflow-taskbar__identity"><strong :title="task.label">{{ task.label }}</strong><span class="workflow-taskbar__state">{{ text.states[task.status] }}</span></span>
                  <span class="workflow-taskbar__work" :title="task.currentAction || task.prompt">{{ task.currentAction || task.prompt }}</span>
                </span>
              </button>
              <div class="workflow-taskbar__side">
                <IconBtn v-if="isWorkflowAgentLive(task.status) && task.status !== 'stopping'" class="workflow-taskbar__icon-button" :disabled="pending.has(identity(task))" :aria-label="`${task.status === 'paused' || task.status === 'pausing' ? text.resume : text.pause}: ${task.label}`" :title="task.status === 'paused' || task.status === 'pausing' ? text.resume : text.pause" @click="pauseOrResume(task)"><component :is="task.status === 'paused' || task.status === 'pausing' ? IconPlayerPlay : IconPlayerPause" :size="14" /></IconBtn>
                <IconBtn v-if="isWorkflowAgentLive(task.status)" class="workflow-taskbar__icon-button" :disabled="(task.status === 'stopping' && !canRetry(task)) || busyAll || pending.has(identity(task))" :aria-label="`${text.stop}: ${task.label}`" :title="`${text.stop}: ${task.label}`" @click="stop(task)"><IconPlayerStop :size="14" /></IconBtn>
                <time>{{ elapsed(task) }}</time>
              </div>
            </div>
            <div v-if="expanded === identity(task)" class="workflow-taskbar__detail" name="workflow-taskbar__detail">
              <p class="workflow-taskbar__phase">{{ taskRun(task)?.name }} · {{ task.runId.slice(0, 8) }}</p>
              <p>{{ task.prompt }}</p>
              <button v-if="task.status === 'failed' && taskRun(task)?.entry" type="button" class="workflow-taskbar__stop-all" :disabled="pending.has(`retry:${task.runId}`)" @click="retry(taskRun(task)!)"><IconRefresh :size="12" /> {{ text.rerun }}</button>
              <p v-if="task.phase" class="workflow-taskbar__phase">{{ task.phase }}</p>
              <strong v-if="task.logs.length">{{ text.logs }}</strong>
              <ol><li v-for="(log, logIndex) in task.logs" :key="`${log.ts}:${logIndex}`">{{ log.text }}</li></ol>
              <pre v-if="task.error" class="workflow-taskbar__error">{{ task.error }}</pre>
              <template v-if="task.output"><strong>{{ text.result }}</strong><pre>{{ task.output }}</pre></template>
            </div>
          </article>

          </template>
        </section>
        <div v-if="!runs.length && !tasks.length" class="workflow-taskbar__empty"><IconSquares :size="23" /><strong>{{ text.empty }}</strong><p>{{ text.emptyHint }}</p></div>
      </div>
    </section>
    <div v-if="!history" class="workflow-taskbar__bar" name="workflow-taskbar__bar">
      <button ref="trigger" type="button" class="workflow-taskbar__trigger" :aria-expanded="open" :aria-label="open ? text.collapse : text.expand" @click="toggle"><IconSquares :size="13" /><span>{{ workflowStore.loading && workflowStore.revision < 0 ? text.loading : count }}</span><IconChevronDown :size="12" :class="{ 'workflow-taskbar__chevron--open': open }" /></button>
      <span class="workflow-taskbar__summary" :title="summary">{{ summary }}</span>
      <time v-if="runElapsed" class="workflow-taskbar__elapsed">{{ runElapsed }}</time>
    </div>
    <div v-if="workflowStore.loadFailed || actionError || cleanupFailed" class="workflow-taskbar__notice" role="alert"><span>{{ actionError || (cleanupFailed ? text.stopError : text.loadError) }}</span><button v-if="workflowStore.loadFailed" type="button" @click="workflowStore.refresh()">{{ text.retry }}</button></div>
  </div>
</template>
