import { execFile } from 'node:child_process'

export interface ProcessTreeCleanupOptions {
  platform?: NodeJS.Platform
  signal?: (pid: number, signal: NodeJS.Signals) => void
  isAlive?: (pid: number, group: boolean) => boolean | Promise<boolean>
  taskkill?: (pid: number) => Promise<void>
  graceMs?: number
  timeoutMs?: number
  pollMs?: number
}

let cleanupLaunchDepth = 0
/** Internal taskkill processes have their own timeout and must not recursively become owned trees. */
export const isProcessCleanupLaunch = (): boolean => cleanupLaunchDepth > 0

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))
const processExists = (pid: number, group: boolean): boolean => {
  try { process.kill(group ? -pid : pid, 0); return true }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false
    // EPERM is also an existence result (including transient unreaped groups on macOS).
    // Keep waiting; actual signal errors still fail cleanup instead of claiming success.
    if ((error as NodeJS.ErrnoException).code === 'EPERM') return true
    throw error
  }
}
const signalProcess = (pid: number, signal: NodeJS.Signals): void => {
  try { process.kill(pid, signal) }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error }
}
const taskkillTree = (pid: number): Promise<void> => new Promise((resolve, reject) => {
  cleanupLaunchDepth++
  try {
    execFile('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: 5000, maxBuffer: 64_000 }, error => {
      if (error) reject(new Error(`Windows process tree ${pid} cleanup was not confirmed (taskkill: ${String(error.code ?? error.message)})`))
      else resolve()
    })
  } catch (error) { reject(error) }
  finally { cleanupLaunchDepth-- }
})

const waitUntilGone = async (pid: number, group: boolean, options: {
  isAlive: NonNullable<ProcessTreeCleanupOptions['isAlive']>
  timeoutMs: number
  pollMs: number
}): Promise<boolean> => {
  const deadline = Date.now() + options.timeoutMs
  for (;;) {
    if (!await options.isAlive(pid, group)) return true
    if (Date.now() >= deadline) return false
    await sleep(Math.min(options.pollMs, Math.max(1, deadline - Date.now())))
  }
}

/** Resolve only after owned groups/trees have stopped, not merely after a signal was accepted. */
export const terminateOwnedProcesses = async (owned: ReadonlyMap<number, boolean>, options: ProcessTreeCleanupOptions = {}): Promise<void> => {
  const platform = options.platform ?? process.platform
  const signal = options.signal ?? signalProcess
  const isAlive = options.isAlive ?? processExists
  const timeoutMs = options.timeoutMs ?? 5000
  const pollMs = options.pollMs ?? 25
  const results = await Promise.allSettled([...owned].map(async ([pid, group]) => {
    if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid) throw new Error('Invalid owned process PID')
    if (platform === 'win32') {
      // A vanished parent PID does not prove that Windows descendants exited. Preserve ownership
      // and fail if taskkill cannot confirm its /T operation; never fall back to killing only PID.
      await (options.taskkill ?? taskkillTree)(pid)
    } else {
      if (!await isAlive(pid, group)) return
      signal(group ? -pid : pid, 'SIGTERM')
      if (await waitUntilGone(pid, group, { isAlive, timeoutMs: options.graceMs ?? 250, pollMs })) return
      signal(group ? -pid : pid, 'SIGKILL')
    }
    if (!await waitUntilGone(pid, group, { isAlive, timeoutMs, pollMs })) {
      throw new Error(`Owned process ${group ? 'group' : 'tree'} ${pid} termination was not confirmed`)
    }
  }))
  const failures = results.flatMap(result => result.status === 'rejected' ? [result.reason] : [])
  if (failures.length) throw new AggregateError(failures, failures.map(error => error instanceof Error ? error.message : String(error)).join('; '))
}
