import childProcess, { type ChildProcess, type SpawnOptions } from 'node:child_process'
import { send } from './workerPort'
import { isProcessCleanupLaunch, terminateOwnedProcesses } from './processTree'

type NativeSpawn = (this: ChildProcess, options: SpawnOptions) => number
let installed = false

/** Install only inside disposable workers; all spawned processes are reported before model work starts. */
export function trackOwnedProcesses(): void {
  if (installed) return
  installed = true
  const tracked = new Set<number>()
  const track = (child: ChildProcess, group: boolean): void => {
    const pid = child.pid
    if (!pid || tracked.has(pid)) return
    tracked.add(pid)
    send({ type: 'process.owned', pid, group })
    child.once('exit', () => {
      // exit can precede close indefinitely when descendants retain stdio. Keep the main
      // supervisor's ownership until the group is gone, even when the direct child has exited.
      void terminateOwnedProcesses(new Map([[pid, group]])).then(() => {
        tracked.delete(pid)
        send({ type: 'process.released', pid })
      }, () => { /* Main retains the PID and must confirm cleanup before settling the run. */ })
    })
  }
  // Node's execFile calls an internal spawn and drops options.detached. Intercept the common
  // native boundary instead of wrapping public functions, preserving callbacks and promisify.
  const prototype = childProcess.ChildProcess.prototype as unknown as { spawn: NativeSpawn }
  const originalSpawn = prototype.spawn
  prototype.spawn = function (options) {
    if (isProcessCleanupLaunch()) return originalSpawn.call(this, options)
    const group = process.platform !== 'win32'
    const result = originalSpawn.call(this, { ...options, detached: group })
    track(this, group)
    return result
  }
}
