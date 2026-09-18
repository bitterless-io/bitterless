import { app, webContents } from 'electron'
import { freemem, totalmem } from 'os'
import { monitorEventLoopDelay } from 'perf_hooks'
import { moduleLog } from './moduleLog'

const log = moduleLog('health')

const TICK_MS = 10_000
/** Report normally only this often; a warning still prints on the tick that earns it. */
const INFO_EVERY = 6
/** A tick this late means the loop could not run the timer — that is the stall, not a slow tick. */
const OVERDUE_MS = TICK_MS * 2
const LAG_WARN_MS = 1_000
const FREE_MEMORY_WARN = 0.05

const mb = (bytes: number): number => Math.round(bytes / 1024 / 1024)

export interface HealthSample {
  sinceLastTickMs: number
  overdueMs: number
  loopP50Ms: number
  loopP99Ms: number
  loopMaxMs: number
  rssMb: number
  heapUsedMb: number
  freeMemoryMb: number
  freeMemoryRatio: number
  processes: string
}

/**
 * Why a tick reports its own lateness: this timer runs ON the main event loop, so while that loop is
 * blocked the timer cannot fire. The overdue interval is therefore the measurement — a 10s tick that
 * took 47s says main was stalled for 37s, which no other line in the log can say. The libuv
 * histogram keeps recording through the same window, so the tick that recovers still carries the lag
 * it missed.
 */
export const describeHealth = (sample: HealthSample): { level: 'info' | 'warn'; msg: string } => {
  const reasons = [
    sample.overdueMs > 0 ? `tick overdue by ${sample.overdueMs}ms — main event loop was blocked` : '',
    sample.loopMaxMs >= LAG_WARN_MS ? `event loop lag reached ${sample.loopMaxMs}ms` : '',
    sample.freeMemoryRatio < FREE_MEMORY_WARN ? `only ${Math.round(sample.freeMemoryRatio * 100)}% system memory free` : ''
  ].filter(Boolean)
  const body = `loop p50=${sample.loopP50Ms}ms p99=${sample.loopP99Ms}ms max=${sample.loopMaxMs}ms`
    + ` tick=${sample.sinceLastTickMs}ms rss=${sample.rssMb}MB heap=${sample.heapUsedMb}MB`
    + ` freeMem=${sample.freeMemoryMb}MB(${Math.round(sample.freeMemoryRatio * 100)}%) ${sample.processes}`
  return reasons.length ? { level: 'warn', msg: `${reasons.join('; ')} · ${body}` } : { level: 'info', msg: body }
}

/**
 * pid → the surface actually loaded there. Without it a runaway renderer reads as `Tab=1786MB`,
 * which names nothing: every tab, mini-app and hidden runtime window reports the same word, so the
 * one that is leaking cannot be told from the four that are not.
 */
const surfaceByPid = (): Map<number, string> => {
  const byPid = new Map<number, string>()
  try {
    for (const contents of webContents.getAllWebContents()) {
      let pid = 0
      try { pid = contents.getOSProcessId() } catch { continue }
      if (!pid || byPid.has(pid)) continue
      const url = (() => { try { return contents.getURL() } catch { return '' } })()
      const title = (() => { try { return contents.getTitle() } catch { return '' } })()
      // The tail of the URL is what distinguishes our surfaces (…/onlypreview/shell/index.html);
      // the title is often the same product name on all of them.
      const tail = url.split(/[?#]/)[0].split('/').filter(Boolean).slice(-2).join('/')
      byPid.set(pid, tail || title || `wc${contents.id}`)
    }
  } catch { /* metrics must never become the fault */ }
  return byPid
}

/** Heaviest processes first, so a runaway renderer or utility is attributable rather than inferred. */
const describeProcesses = (): string => {
  try {
    const surfaces = surfaceByPid()
    return app.getAppMetrics()
      .map((metric) => ({
        label: `${metric.type}${surfaces.get(metric.pid) ? `[${surfaces.get(metric.pid)}]` : metric.name ? `:${metric.name}` : ''}`,
        memoryMb: mb((metric.memory?.workingSetSize ?? 0) * 1024),
        cpu: Math.round(metric.cpu?.percentCPUUsage ?? 0)
      }))
      .sort((a, b) => b.memoryMb - a.memoryMb)
      .slice(0, 4)
      .map(({ label, memoryMb, cpu }) => `${label}=${memoryMb}MB/${cpu}%`)
      .join(' ')
  } catch {
    return 'procs=unavailable'
  }
}

export const startMainHealthMonitor = (): void => {
  const loop = monitorEventLoopDelay({ resolution: 20 })
  loop.enable()
  let lastTickAt = Date.now()
  let ticks = 0

  const timer = setInterval(() => {
    const now = Date.now()
    const sinceLastTickMs = now - lastTickAt
    lastTickAt = now
    ticks += 1
    const free = freemem()
    const sample: HealthSample = {
      sinceLastTickMs,
      overdueMs: Math.max(0, sinceLastTickMs - OVERDUE_MS),
      loopP50Ms: Math.round(loop.percentile(50) / 1e6),
      loopP99Ms: Math.round(loop.percentile(99) / 1e6),
      loopMaxMs: Math.round(loop.max / 1e6),
      rssMb: mb(process.memoryUsage.rss()),
      heapUsedMb: mb(process.memoryUsage().heapUsed),
      freeMemoryMb: mb(free),
      freeMemoryRatio: free / totalmem(),
      processes: describeProcesses()
    }
    loop.reset()
    const { level, msg } = describeHealth(sample)
    if (level === 'warn') log.warn(msg, { ...sample, processes: undefined })
    else if (ticks % INFO_EVERY === 1) log.info(msg)
  }, TICK_MS)
  // Never keep the process alive for a diagnostic.
  timer.unref()
}
