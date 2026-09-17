import type { AgentRuntimeSession } from './agentRuntime.types'

/** The ordinary turn budget excludes native compaction, which follows Pi's provider policy. */
export const withCompactionAwareTimeout = async <T>(
  operation: () => Promise<T>,
  session: Pick<AgentRuntimeSession, 'subscribe'>,
  ms: number,
  timeoutError: () => Error
): Promise<T> => {
  let remaining = ms
  let started = Date.now()
  let paused = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let expire: () => void = () => undefined
  const deadline = new Promise<never>((_, reject) => { expire = () => reject(timeoutError()) })
  const resume = (): void => { started = Date.now(); timer = setTimeout(expire, Math.max(0, remaining)) }
  const unsubscribe = session.subscribe(event => {
    if (event.type === 'compaction_start' && !paused) {
      paused = true
      remaining -= Date.now() - started
      clearTimeout(timer)
    } else if (event.type === 'compaction_end' && paused) {
      paused = false
      resume()
    }
  })
  resume()
  try { return await Promise.race([operation(), deadline]) }
  finally { clearTimeout(timer); unsubscribe?.() }
}
