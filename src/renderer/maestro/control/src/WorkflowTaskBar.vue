<script setup lang="ts">
import { computed, nextTick, onBeforeUpdate, onMounted, onUnmounted, onUpdated, ref, watch } from 'vue'
import { IconAlertTriangle, IconCheck, IconChevronDown, IconClock, IconLoader2, IconPlayerPause, IconPlayerPlay, IconPlayerStop, IconRefresh, IconSquares, IconX } from '@tabler/icons-vue'
import IconBtn from '@renderer/common/components/IconBtn/IconBtn.vue'
import { isWorkflowAgentActive, type WorkflowAgentTask, type WorkflowRunSnapshot } from '@shared/agentWorkflow.api'
import { workflowStore } from './store/workflow.store'
import { workflowText } from './workflow.text'
import { groupWorkflowRuns, newestWorkflowRuns, workflowActivityFacts, type WorkflowRunGroup } from './workflow.presentation'
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
// The roster groups by workflow: with two runs live, a flat status list cannot say which is which.
const groups = computed(() => groupWorkflowRuns(runs.value)
  .map(group => ({ ...group, agents: props.history ? group.agents : group.agents.filter(task => isWorkflowAgentActive(task.status)) }))
  // A live run with no Agent yet still gets its header, so it can be seen and stopped at once.
  .filter(group => props.history || group.agents.length || !group.ended))
const latestRun = computed(() => newestWorkflowRuns(runs.value)[0])
/** Only an explicit user choice is stored; the default follows whether the run is still going. */
const runOpen = ref(new Map<string, boolean>())
const isRunOpen = (group: WorkflowRunGroup): boolean => runOpen.value.get(group.run.id) ?? !group.ended
const toggleRun = (group: WorkflowRunGroup): void => { runOpen.value.set(group.run.id, !isRunOpen(group)) }
// Paused counts as live: it can still be resumed or stopped, and dropping it here is what used to
// hide Stop all and freeze the elapsed ticker the moment a run was paused.
const liveRuns = computed(() => runs.value.filter(run => run.status === 'running' || run.status === 'paused' || run.status === 'stopping'))
const cleanupFailed = computed(() => liveRuns.value.some(run => Boolean(run.error)))
const cancellable = computed(() => liveRuns.value.some(run => run.status === 'running') || cleanupFailed.value || Boolean(actionError.value))
const busyAll = computed(() => pending.value.has(props.sessionId))
// Same shared computation the status row uses, so the bar and that row can never disagree.
const facts = computed(() => workflowActivityFacts(workflowStore.runs, props.sessionId))
const count = computed(() => text.value.counts.replace('{workflows}', String(facts.value.runs)).replace('{agents}', String(facts.value.agents)))
const groupSubtitle = (group: WorkflowRunGroup): string => {
  const copy = text.value
  if (group.awaitingUser) return copy.runApproval.replace('{count}', String(group.awaitingUser))
  if (group.failedCount) return copy.runFailed.replace('{count}', String(group.failedCount))
  if (group.activeCount) return copy.runWorking.replace('{count}', String(group.activeCount))
  return group.run.result?.trim() || group.run.error?.trim() || copy.categories[group.category]
}
const groupElapsed = (group: WorkflowRunGroup): string => duration((group.run.endedAt ?? tick.value) - group.run.createdAt)
const stopRun = async (group: WorkflowRunGroup): Promise<void> => {
  const key = `run:${group.run.id}`
  if (pending.value.has(key)) return
  pending.value.add(key)
  actionError.value = ''
  try { await workflowStore.stopWorkflow(props.sessionId, group.run.id) }
  catch (error) { actionError.value = error instanceof Error ? error.message : text.value.stopError }
  finally { pending.value.delete(key) }
}
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
const stop = async (): Promise<void> => {
  const sessionId = props.sessionId
  if (pending.value.has(sessionId)) return
  pending.value.add(sessionId)
  actionError.value = ''
  try { await workflowStore.stopSession(sessionId) }
  catch { if (props.sessionId === sessionId) actionError.value = text.value.stopError }
  finally { pending.value.delete(sessionId) }
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
/**
 * Pause or resume a whole RUN.
 *
 * It used to pause one Agent. This engine schedules its own agents and exposes no per-agent channel,
 * so those buttons would have accepted the click and done nothing — worse than not being there,
 * because the row would then sit at "Pausing" forever. Run-level is what the engine can actually
 * honour, and it keeps the journal: resuming continues from the unchanged prefix.
 */
const pauseOrResume = async (group: WorkflowRunGroup): Promise<void> => {
  const key = `run:${group.run.id}`
  if (pending.value.has(key)) return
  pending.value.add(key)
  actionError.value = ''
  try { await workflowStore.controlWorkflow(props.sessionId, group.run.id, group.run.status === 'paused' ? 'resume' : 'pause') }
  catch (error) { actionError.value = error instanceof Error ? error.message : text.value.stopError }
  finally { pending.value.delete(key) }
}
const pointer = (event: PointerEvent): void => { if (!props.history && open.value && event.target instanceof Node && !root.value?.contains(event.target)) close() }
const keydown = (event: KeyboardEvent): void => { if (open.value && event.key === 'Escape') { event.preventDefault(); close(true) } }
watch(() => props.sessionId, () => { close(); expanded.value = null; scrollTop = 0; actionError.value = '' })
// Closing on "no active Agents" alone would shut the popover the moment a run is paused, taking the
// Resume button with it.
watch(() => [active.value.length, liveRuns.value.length], ([agents, live]) => { if (!agents && !live && !props.history) close() })
watch(() => latestRun.value?.id, () => {
  // A new run resets explicit collapse choices, so older runs fall back to "ended ⇒ collapsed".
  runOpen.value = new Map()
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
  <div v-show="history || active.length > 0 || liveRuns.length > 0" ref="root" name="workflow-taskbar" class="workflow-taskbar" :class="{ 'workflow-taskbar--history': history }">
    <section v-if="open" class="workflow-taskbar__popover" name="workflow-taskbar__popover" :aria-label="text.current" :style="{ maxHeight: history ? '65vh' : `${maximumHeight}px` }">
      <header class="workflow-taskbar__header" name="workflow-taskbar__header">
        <strong>{{ text.current }}</strong>
        <div class="workflow-taskbar__actions">
          <button v-if="liveRuns.length" type="button" class="workflow-taskbar__stop-all" :disabled="busyAll || !cancellable" @click="stop()">{{ busyAll || !cancellable ? text.stoppingAll : text.stopAll }}</button>
          <IconBtn class="workflow-taskbar__icon-button" :title="text.collapse" :aria-label="text.collapse" @click="close(true)"><IconX :size="14" /></IconBtn>
        </div>
      </header>
      <div ref="list" class="workflow-taskbar__list" name="workflow-taskbar__list" tabindex="0" :aria-label="text.current">
        <section v-for="group in groups" :key="group.run.id" class="workflow-taskbar__run" name="workflow-taskbar__run" :data-run-id="group.run.id" :data-category="group.category" :class="{ 'workflow-taskbar__run--ended': group.ended }">
          <div class="workflow-taskbar__run-head" name="workflow-taskbar__run-head">
            <button type="button" class="workflow-taskbar__run-toggle" :aria-expanded="isRunOpen(group)" :aria-label="`${isRunOpen(group) ? text.runCollapse : text.runExpand}: ${group.run.name}`" @click="toggleRun(group)">
              <IconChevronDown :size="12" :class="{ 'workflow-taskbar__run-chevron--closed': !isRunOpen(group) }" />
              <span class="workflow-taskbar__run-copy">
                <strong :title="group.run.name">{{ group.run.name }}</strong>
                <span class="workflow-taskbar__run-sub" :title="groupSubtitle(group)">{{ groupSubtitle(group) }}</span>
              </span>
              <time>{{ groupElapsed(group) }}</time>
            </button>
            <IconBtn v-if="!group.ended" class="workflow-taskbar__icon-button" :disabled="busyAll || pending.has(`run:${group.run.id}`)" :aria-label="`${group.run.status === 'paused' ? text.resume : text.pause}: ${group.run.name}`" :title="`${group.run.status === 'paused' ? text.resume : text.pause}: ${group.run.name}`" @click="pauseOrResume(group)"><component :is="group.run.status === 'paused' ? IconPlayerPlay : IconPlayerPause" :size="14" /></IconBtn>
            <IconBtn v-if="!group.ended" class="workflow-taskbar__icon-button" :disabled="busyAll || pending.has(`run:${group.run.id}`)" :aria-label="`${text.runStop}: ${group.run.name}`" :title="`${text.runStop}: ${group.run.name}`" @click="stopRun(group)"><IconPlayerStop :size="14" /></IconBtn>
            <IconBtn v-else-if="group.run.entry" class="workflow-taskbar__icon-button" :disabled="pending.has(`retry:${group.run.id}`)" :aria-label="`${text.rerun}: ${group.run.name}`" :title="`${text.rerun}: ${group.run.name}`" @click="retry(group.run)"><IconRefresh :size="14" /></IconBtn>
          </div>
          <template v-if="isRunOpen(group)">
          <article v-for="task in group.agents" :key="identity(task)" class="workflow-taskbar__row" name="workflow-taskbar__row" :data-agent-id="task.id" :data-status="task.status" :class="{ 'workflow-taskbar__row--expanded': expanded === identity(task) }">
            <div class="workflow-taskbar__row-line">
              <button type="button" class="workflow-taskbar__task" :aria-expanded="expanded === identity(task)" @click="expanded = expanded === identity(task) ? null : identity(task)">
                <component :is="statusIcon(task)" :size="15" class="workflow-taskbar__state-icon" />
                <span class="workflow-taskbar__copy">
                  <span class="workflow-taskbar__identity"><strong :title="task.label">{{ task.label }}</strong><span class="workflow-taskbar__state">{{ text.states[task.status] }}</span></span>
                  <span class="workflow-taskbar__work" :title="task.currentAction || task.prompt">{{ task.currentAction || task.prompt }}</span>
                </span>
              </button>
              <div class="workflow-taskbar__side">
                <!-- Per-Agent Pause / Resume / Stop stood here. This engine runs its own scheduler and
                     offers no per-agent channel, so those three buttons could only have accepted the
                     click and done nothing. The run's own controls are in its header. -->
                <time>{{ elapsed(task) }}</time>
              </div>
            </div>
            <div v-if="expanded === identity(task)" class="workflow-taskbar__detail" name="workflow-taskbar__detail">
              <p class="workflow-taskbar__phase">{{ task.runId.slice(0, 8) }} · {{ task.id }}</p>
              <p>{{ task.prompt }}</p>
              <p v-if="task.phase || task.model" class="workflow-taskbar__phase">{{ [task.phase, task.model].filter(Boolean).join(' · ') }}</p>
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
