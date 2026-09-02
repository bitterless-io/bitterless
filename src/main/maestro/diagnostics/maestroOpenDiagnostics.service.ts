export const MAESTRO_OPEN_STAGES = [
  'runtime',
  'proxy',
  'sqlite-window',
  'sqlite-preload',
  'session',
  'controller',
  'shell',
  'home-mount',
  'home-tab',
  'startup-tab',
  'control',
  'workbench',
  'all-ready',
  'show'
] as const

export type MaestroOpenStage = (typeof MAESTRO_OPEN_STAGES)[number]
export type MaestroOpenRoute = 'reuse' | 'join-boot' | 'cold-boot'
export type MaestroOpenCleanupState = 'none' | 'joined' | 'auth-cleanup' | 'blocked'
export type MaestroOpenOutcome = 'success' | 'failure'
export type MaestroOpenReason =
  | 'ready'
  | 'timeout'
  | 'failed'
  | 'auth-blocked'
  | 'cleanup-failed'

export const MAX_MAESTRO_OPEN_DURATION_MS = 3_600_000

type MaestroOpenEvent =
  | 'request-start'
  | 'cleanup-wait'
  | 'route'
  | 'stage'
  | 'request-terminal'
  | 'boot-terminal'

export interface MaestroOpenDiagnosticsOptions {
  clock?: () => number
  write?: (line: string) => void
}

const ROUTES = new Set<MaestroOpenRoute>(['reuse', 'join-boot', 'cold-boot'])
const CLEANUP_STATES = new Set<MaestroOpenCleanupState>([
  'none',
  'joined',
  'auth-cleanup',
  'blocked'
])
const OUTCOMES = new Set<MaestroOpenOutcome>(['success', 'failure'])
const REASONS = new Set<MaestroOpenReason>([
  'ready',
  'timeout',
  'failed',
  'auth-blocked',
  'cleanup-failed'
])
const STAGES = new Set<MaestroOpenStage>(MAESTRO_OPEN_STAGES)
const EVENTS = new Set<MaestroOpenEvent>([
  'request-start',
  'cleanup-wait',
  'route',
  'stage',
  'request-terminal',
  'boot-terminal'
])
const PROCESS_LOCAL_ID = /^[ob][1-9a-z][0-9a-z]*$/

const clampDuration = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.min(MAX_MAESTRO_OPEN_DURATION_MS, Math.max(0, Math.floor(value)))
}

const isProcessLocalId = (value: unknown, prefix: 'o' | 'b'): value is string =>
  typeof value === 'string' && value.startsWith(prefix) && PROCESS_LOCAL_ID.test(value)

const isEnumValue = <T extends string>(values: Set<T>, value: unknown): value is T =>
  typeof value === 'string' && values.has(value as T)

export class MaestroOpenTimeoutError extends Error {
  constructor(message: string) {
    super(message)
  }
}

export const classifyMaestroOpenFailure = (error: unknown): MaestroOpenReason =>
  error instanceof MaestroOpenTimeoutError ? 'timeout' : 'failed'

export class MaestroOpenDiagnostics {
  private readonly clock: () => number
  private readonly write: (line: string) => void
  private lastNow = 0
  private requestSequence = 0
  private bootSequence = 0

  constructor(options: MaestroOpenDiagnosticsOptions = {}) {
    this.clock = options.clock ?? (() => globalThis.performance.now())
    this.write = options.write ?? ((line) => console.info(line))
  }

  now(): number {
    let candidate: number
    try {
      candidate = this.clock()
    } catch {
      return this.lastNow
    }
    if (!Number.isFinite(candidate)) return this.lastNow
    const normalized = Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(candidate)))
    this.lastNow = Math.max(this.lastNow, normalized)
    return this.lastNow
  }

  elapsed(startedAt: number, completedAt = this.now()): number {
    if (!Number.isSafeInteger(startedAt) || startedAt < 0) return 0
    if (!Number.isSafeInteger(completedAt) || completedAt < startedAt) return 0
    return clampDuration(completedAt - startedAt)
  }

  startRequest(): MaestroOpenRequestTrace {
    const id = `o${(++this.requestSequence).toString(36)}`
    const trace = new MaestroOpenRequestTrace(this, id, this.now())
    this.emit('request-start', { openId: id })
    return trace
  }

  startBoot(): MaestroOpenBootTrace {
    const id = `b${(++this.bootSequence).toString(36)}`
    return new MaestroOpenBootTrace(this, id, this.now())
  }

  emit(event: unknown, fields: Record<string, unknown>): boolean {
    if (!isEnumValue(EVENTS, event)) return false
    try {
      const parts = this.allowlistedParts(event, fields)
      if (!parts) return false
      this.write(`[maestro-open] event=${event} ${parts.join(' ')}`)
      return true
    } catch {
      return false
    }
  }

  private allowlistedParts(
    event: MaestroOpenEvent,
    fields: Record<string, unknown>
  ): string[] | null {
    if (event === 'request-start') {
      if (!isProcessLocalId(fields.openId, 'o')) return null
      return [`openId=${fields.openId}`]
    }

    if (event === 'cleanup-wait') {
      if (
        !isProcessLocalId(fields.openId, 'o') ||
        !isEnumValue(CLEANUP_STATES, fields.state)
      ) return null
      return [
        `openId=${fields.openId}`,
        `state=${fields.state}`,
        `elapsedMs=${clampDuration(fields.elapsedMs)}`
      ]
    }

    if (event === 'route') {
      if (
        !isProcessLocalId(fields.openId, 'o') ||
        !isEnumValue(ROUTES, fields.route)
      ) return null
      if (fields.route === 'reuse') {
        return [`openId=${fields.openId}`, `route=${fields.route}`]
      }
      if (!isProcessLocalId(fields.bootId, 'b')) return null
      return [
        `openId=${fields.openId}`,
        `route=${fields.route}`,
        `bootId=${fields.bootId}`
      ]
    }

    if (event === 'stage') {
      if (
        !isProcessLocalId(fields.bootId, 'b') ||
        !isEnumValue(STAGES, fields.stage)
      ) return null
      return [
        `bootId=${fields.bootId}`,
        `stage=${fields.stage}`,
        `elapsedMs=${clampDuration(fields.elapsedMs)}`,
        `stageMs=${clampDuration(fields.stageMs)}`
      ]
    }

    if (event === 'request-terminal') {
      if (
        !isProcessLocalId(fields.openId, 'o') ||
        !isEnumValue(OUTCOMES, fields.outcome) ||
        !isEnumValue(REASONS, fields.reason) ||
        !this.isOutcomeReasonPair(fields.outcome, fields.reason)
      ) return null
      const parts = [`openId=${fields.openId}`]
      if (isProcessLocalId(fields.bootId, 'b')) parts.push(`bootId=${fields.bootId}`)
      parts.push(
        `outcome=${fields.outcome}`,
        `reason=${fields.reason}`,
        `elapsedMs=${clampDuration(fields.elapsedMs)}`
      )
      return parts
    }

    if (
      !isProcessLocalId(fields.bootId, 'b') ||
      !isEnumValue(OUTCOMES, fields.outcome) ||
      !isEnumValue(REASONS, fields.reason) ||
      !this.isOutcomeReasonPair(fields.outcome, fields.reason)
    ) return null
    const suppliedPending = Array.isArray(fields.pending) ? fields.pending : []
    const pending = MAESTRO_OPEN_STAGES.filter((stage) => suppliedPending.includes(stage))
    return [
      `bootId=${fields.bootId}`,
      `outcome=${fields.outcome}`,
      `reason=${fields.reason}`,
      `elapsedMs=${clampDuration(fields.elapsedMs)}`,
      `pending=${pending.length ? pending.join(',') : 'none'}`
    ]
  }

  private isOutcomeReasonPair(
    outcome: MaestroOpenOutcome,
    reason: MaestroOpenReason
  ): boolean {
    return outcome === 'success' ? reason === 'ready' : reason !== 'ready'
  }
}

export class MaestroOpenRequestTrace {
  readonly id: string
  private readonly diagnostics: MaestroOpenDiagnostics
  private readonly startedAt: number
  private cleanupWritten = false
  private routeWritten = false
  private terminalWritten = false
  private bootId: string | null = null

  constructor(
    diagnostics: MaestroOpenDiagnostics,
    id: string,
    startedAt: number
  ) {
    this.diagnostics = diagnostics
    this.id = id
    this.startedAt = startedAt
  }

  mark(): number {
    return this.diagnostics.now()
  }

  cleanupWait(state: MaestroOpenCleanupState, stageStartedAt: number): boolean {
    if (this.cleanupWritten || this.terminalWritten) return false
    this.cleanupWritten = true
    const completedAt = this.diagnostics.now()
    return this.diagnostics.emit('cleanup-wait', {
      openId: this.id,
      state,
      elapsedMs: this.diagnostics.elapsed(stageStartedAt, completedAt)
    })
  }

  route(route: MaestroOpenRoute, boot?: MaestroOpenBootTrace | null): boolean {
    if (this.routeWritten || this.terminalWritten) return false
    this.routeWritten = true
    this.bootId = route === 'reuse' ? null : (boot?.id ?? null)
    return this.diagnostics.emit('route', {
      openId: this.id,
      route,
      bootId: this.bootId
    })
  }

  terminal(outcome: MaestroOpenOutcome, reason: MaestroOpenReason): boolean {
    if (this.terminalWritten) return false
    this.terminalWritten = true
    const completedAt = this.diagnostics.now()
    return this.diagnostics.emit('request-terminal', {
      openId: this.id,
      bootId: this.bootId,
      outcome,
      reason,
      elapsedMs: this.diagnostics.elapsed(this.startedAt, completedAt)
    })
  }
}

export class MaestroOpenBootTrace {
  readonly id: string
  private readonly diagnostics: MaestroOpenDiagnostics
  private readonly startedAt: number
  private readonly pending = new Set<MaestroOpenStage>(MAESTRO_OPEN_STAGES)
  private terminalWritten = false

  constructor(
    diagnostics: MaestroOpenDiagnostics,
    id: string,
    startedAt: number
  ) {
    this.diagnostics = diagnostics
    this.id = id
    this.startedAt = startedAt
  }

  mark(): number {
    return this.diagnostics.now()
  }

  completeStage(stage: MaestroOpenStage, stageStartedAt: number): boolean {
    if (this.terminalWritten || !this.pending.delete(stage)) return false
    const completedAt = this.diagnostics.now()
    return this.diagnostics.emit('stage', {
      bootId: this.id,
      stage,
      elapsedMs: this.diagnostics.elapsed(this.startedAt, completedAt),
      stageMs: this.diagnostics.elapsed(stageStartedAt, completedAt)
    })
  }

  terminal(outcome: MaestroOpenOutcome, reason: MaestroOpenReason): boolean {
    if (this.terminalWritten) return false
    this.terminalWritten = true
    const completedAt = this.diagnostics.now()
    return this.diagnostics.emit('boot-terminal', {
      bootId: this.id,
      outcome,
      reason,
      elapsedMs: this.diagnostics.elapsed(this.startedAt, completedAt),
      pending: [...this.pending]
    })
  }
}

export const maestroOpenDiagnostics = new MaestroOpenDiagnostics()
