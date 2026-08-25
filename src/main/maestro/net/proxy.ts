import { acquireMaestroProxyLease } from '@main/networking/outboundHttpDispatcher.service'
import { EnvHttpProxyAgent } from 'undici'

let maestroDispatcher: EnvHttpProxyAgent | null = null

const hasExplicitProxyEnvironment = (): boolean =>
  Boolean(
    process.env.HTTPS_PROXY ||
      process.env.https_proxy ||
      process.env.HTTP_PROXY ||
      process.env.http_proxy ||
      process.env.ALL_PROXY ||
      process.env.all_proxy
  )

const createMaestroProxyDispatcher = (): EnvHttpProxyAgent => {
  const allProxy = process.env.all_proxy || process.env.ALL_PROXY
  if (!allProxy) return new EnvHttpProxyAgent()

  const httpProxy = process.env.http_proxy || process.env.HTTP_PROXY || allProxy
  const httpsProxy = process.env.https_proxy || process.env.HTTPS_PROXY || httpProxy
  return new EnvHttpProxyAgent({ httpProxy, httpsProxy })
}

/**
 * While Maestro is open, route non-Codex main-process Undici traffic through
 * the user's explicit proxy environment. The shared routing dispatcher owns
 * lease counting and remains installed throughout Codex and Maestro activity.
 */
export const acquireMaestroProxyDispatcher = (): (() => void) => {
  if (!hasExplicitProxyEnvironment()) return () => undefined

  if (!maestroDispatcher) {
    maestroDispatcher = createMaestroProxyDispatcher()
    console.log('[coach] outbound HTTP proxy active while Maestro is open')
  }
  return acquireMaestroProxyLease(maestroDispatcher)
}
