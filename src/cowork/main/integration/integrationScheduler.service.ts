import type { IntegrationTarget, IntegrationTargetRunResult } from '@cowork-shared/coach.api'
import { integrationTargetStore } from './integrationTarget.service'

export type IntegrationSchedulerPhase = 'scheduled' | 'started' | 'completed' | 'failed'

export interface IntegrationSchedulerEvent {
  targetId: string
  phase: IntegrationSchedulerPhase
  message: string
  runKind?: string
  nextRunAt?: number
  result?: IntegrationTargetRunResult
  error?: string
}

type IntegrationSchedulerEmit = (event: IntegrationSchedulerEvent) => void
type IntegrationSchedulerRunKind = 'migration-dry-run' | 'report-readiness' | 'recorded-site-dry-run'

interface IntegrationSchedulerStartOptions {
  emit?: IntegrationSchedulerEmit
  runRecordedSiteDryRun?: (target: IntegrationTarget) => Promise<IntegrationTargetRunResult>
}

const SCHEDULER_POLL_MS = 30_000

const dueAt = (target: IntegrationTarget): number | undefined =>
  target.schedule.nextRunAt || undefined

const effectiveRunKind = (target: IntegrationTarget): IntegrationSchedulerRunKind => {
  if (target.source.kind === 'ai-crms-migration' || target.schedule.runKind === 'migration-dry-run') return 'migration-dry-run'
  if (target.schedule.runKind === 'report-readiness') return 'report-readiness'
  return 'recorded-site-dry-run'
}

class IntegrationSchedulerService {
  private timer: ReturnType<typeof setInterval> | null = null
  private emit: IntegrationSchedulerEmit | null = null
  private runRecordedSiteDryRun: ((target: IntegrationTarget) => Promise<IntegrationTargetRunResult>) | null = null
  private started = false
  private activeTick: Promise<void> | null = null
  private activeRuns = new Set<Promise<void>>()
  private runningTargets = new Set<string>()

  start(options?: IntegrationSchedulerEmit | IntegrationSchedulerStartOptions): void {
    if (typeof options === 'function') {
      this.emit = options
    } else if (options) {
      this.emit = options.emit || this.emit
      this.runRecordedSiteDryRun = options.runRecordedSiteDryRun || this.runRecordedSiteDryRun
    }
    this.started = true
    if (this.timer) return
    this.timer = setInterval(() => {
      void this.tick()
    }, SCHEDULER_POLL_MS)
    void this.tick()
    console.info('[coach:integration:scheduler] started')
  }

  async stop(): Promise<void> {
    this.started = false
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    await this.activeTick
    await Promise.allSettled([...this.activeRuns])
    this.emit = null
    this.runRecordedSiteDryRun = null
    this.runningTargets.clear()
    console.info('[coach:integration:scheduler] stopped')
  }

  async tick(): Promise<void> {
    if (!this.started) return
    if (this.activeTick) return await this.activeTick
    const tick = this.runTick()
    this.activeTick = tick
    try {
      await tick
    } finally {
      if (this.activeTick === tick) this.activeTick = null
    }
  }

  private async runTick(): Promise<void> {
    try {
      const now = Date.now()
      const targets = await integrationTargetStore.listTargets()
      if (!this.started) return
      for (const target of targets) {
        if (!this.started) return
        if (!target.schedule.enabled) continue
        if (this.runningTargets.has(target.id)) continue
        const nextRunAt = dueAt(target)
        if (!nextRunAt) {
          const result = await integrationTargetStore.setSchedule({
            targetId: target.id,
            enabled: true,
            intervalMinutes: target.schedule.intervalMinutes,
            runKind: target.schedule.runKind
          })
          this.emitEvent({
            targetId: target.id,
            phase: 'scheduled',
            runKind: result.target?.schedule.runKind,
            nextRunAt: result.target?.schedule.nextRunAt,
            message: 'Initialized integration schedule.'
          })
          continue
        }
        if (nextRunAt > now) continue
        this.trackRun(target)
      }
    } catch (err) {
      console.error('[coach:integration:scheduler] tick failed', err)
    }
  }

  private trackRun(target: IntegrationTarget): void {
    const run = this.runTarget(target)
    this.activeRuns.add(run)
    void run.then(
      () => this.activeRuns.delete(run),
      () => this.activeRuns.delete(run)
    )
  }

  private async runTarget(target: IntegrationTarget): Promise<void> {
    const runKind = effectiveRunKind(target)
    const startedAt = Date.now()
    this.runningTargets.add(target.id)
    this.emitEvent({
      targetId: target.id,
      phase: 'started',
      runKind,
      message: `Started scheduled ${runKind}.`
    })
    console.info('[coach:integration:scheduler] run started', { targetId: target.id, runKind })
    try {
      const result = await this.runScheduledTarget(target, runKind)
      const next = await integrationTargetStore.markScheduledRunCompleted(target.id, startedAt)
      this.emitEvent({
        targetId: target.id,
        phase: result.ok ? 'completed' : 'failed',
        runKind,
        result,
        nextRunAt: next?.schedule.nextRunAt,
        message: result.message
      })
      console.info('[coach:integration:scheduler] run finished', {
        targetId: target.id,
        runKind,
        ok: result.ok,
        nextRunAt: next?.schedule.nextRunAt
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const next = await integrationTargetStore.markScheduledRunCompleted(target.id, startedAt).catch(() => null)
      this.emitEvent({
        targetId: target.id,
        phase: 'failed',
        runKind,
        nextRunAt: next?.schedule.nextRunAt,
        message,
        error: message
      })
      console.error('[coach:integration:scheduler] run failed', { targetId: target.id, runKind, error: message })
    } finally {
      this.runningTargets.delete(target.id)
    }
  }

  private async runScheduledTarget(target: IntegrationTarget, runKind: IntegrationSchedulerRunKind): Promise<IntegrationTargetRunResult> {
    if (runKind === 'migration-dry-run') return await integrationTargetStore.runMigration({ targetId: target.id, apply: false })
    if (runKind === 'report-readiness') return await integrationTargetStore.runReportReadiness({ targetId: target.id, pageSize: 20, generate: false })
    if (this.runRecordedSiteDryRun) return await this.runRecordedSiteDryRun(target)
    return {
      ok: false,
      targetId: target.id,
      message: 'Recorded-site scheduler needs a live browser runner.',
      error: 'recorded-site-runner-unavailable'
    }
  }

  private emitEvent(event: IntegrationSchedulerEvent): void {
    this.emit?.(event)
  }
}

export const integrationScheduler = new IntegrationSchedulerService()
