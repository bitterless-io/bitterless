import { EnvHttpProxyAgent, getGlobalDispatcher, setGlobalDispatcher, type Dispatcher } from 'undici'

let maestroDispatcher: EnvHttpProxyAgent | null = null
let previousDispatcher: Dispatcher | null = null
let activeLeases = 0

const hasExplicitProxyEnvironment = (): boolean =>
  Boolean(
    process.env.HTTPS_PROXY ||
      process.env.https_proxy ||
      process.env.HTTP_PROXY ||
      process.env.http_proxy ||
      process.env.ALL_PROXY ||
      process.env.all_proxy
  )

/**
 * While Maestro is open, route main-process undici traffic through the user's
 * explicit proxy environment. The previous host dispatcher is restored after
 * Maestro agents and windows have drained and shut down.
 */
export const acquireMaestroProxyDispatcher = (): (() => void) => {
  if (!hasExplicitProxyEnvironment()) return () => undefined

  if (activeLeases === 0) {
    previousDispatcher = getGlobalDispatcher()
    maestroDispatcher ??= new EnvHttpProxyAgent()
    setGlobalDispatcher(maestroDispatcher)
    console.log('[coach] outbound HTTP proxy active while Maestro is open')
  }
  activeLeases += 1

  let released = false
  return (): void => {
    if (released) return
    released = true
    activeLeases = Math.max(0, activeLeases - 1)
    if (activeLeases !== 0) return

    if (maestroDispatcher && previousDispatcher && getGlobalDispatcher() === maestroDispatcher) {
      setGlobalDispatcher(previousDispatcher)
    }
    previousDispatcher = null
  }
}
