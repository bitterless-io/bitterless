import type { WebContents } from 'electron'
import { createXpcMainEmitter, xpcMain } from 'electron-xpc/main'
import type { AuthSession, SessionApi } from '@maestro-shared/session.api'
import { AUTH_BROADCAST } from '@maestro-shared/session.api'
import { writeMicromeetCliCredential } from '@maestro-main/cli/micromeetCli.service'

// Shell ↔ AI-CRMS login bridge. Runs ONLY on the dedicated, host-confined AI-CRMS login tab. It
// piggybacks that tab's already-attached webContents.debugger — never attaches its own — to:
//   1. inject `window.isMicromeetAgentBrowser=true` + `window.__micromeetSharedSession`
//      at document-start (restore: ai-crms adopts the shell's session if its localStorage
//      is empty);
//   2. register `window.__micromeetAuth` (Runtime.addBinding) so ai-crms pushes the token
//      out on login / logout.
// Security: the caller MUST only attach this on our own AI-CRMS domain. The document-start value
// is installed only in the main frame, and binding calls are accepted only after verifying that
// their execution context is the trusted main frame. Third-party iframes may still be required by
// the login page, but they never receive the shared session and cannot forge token callbacks.

const BINDING = '__micromeetAuth'
export const AI_CRMS_AUTH_HOST = 'crms.micromeet.ai'

const session = createXpcMainEmitter<SessionApi>('MaestroSessionDao')

const sessionMeta = (s: AuthSession | null): Record<string, unknown> => ({
  authenticated: Boolean(s?.jwt_token),
  region: s?.region || ''
})

const injectSource = (s: AuthSession | null): string => {
  const shared = s ? JSON.stringify({ jwt_token: s.jwt_token, tenant_id: s.tenant_id, region: s.region }) : 'undefined'
  const host = JSON.stringify(AI_CRMS_AUTH_HOST)
  return `if (window.top === window && window.location.hostname.toLowerCase() === ${host} && ((window.location.protocol === 'http:' && (!window.location.port || window.location.port === '80')) || (window.location.protocol === 'https:' && (!window.location.port || window.location.port === '443')))) { window.isMicromeetAgentBrowser = true; window.__micromeetSharedSession = ${shared}; }`
}

export const isTrustedAiCrmsAuthUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url)
    if (parsed.hostname.toLowerCase() !== AI_CRMS_AUTH_HOST) return false
    if (parsed.protocol === 'http:') return !parsed.port || parsed.port === '80'
    if (parsed.protocol === 'https:') return !parsed.port || parsed.port === '443'
    return false
  } catch {
    return false
  }
}

interface AuthPayload {
  type?: 'login' | 'logout'
  jwt_token?: string
  tenant_id?: string
  region?: string
}

class AuthBridge {
  private wc: WebContents | null = null
  private target: WebContents | null = null
  private scriptId: string | null = null
  private current: AuthSession | null = null
  private wired = false
  private accepting = false
  private epoch = 0
  private pending = new Set<Promise<void>>()
  private transition: Promise<void> = Promise.resolve()
  private bindingTransition: Promise<void> = Promise.resolve()

  /** Attach to the trusted AI-CRMS login tab's webContents (debugger already attached). */
  async attach(wc: WebContents): Promise<void> {
    const epoch = ++this.epoch
    this.target = wc
    this.disableCurrentListener()
    const attach = this.enqueueTransition(async () => {
      await this.drainPending()
      await this.clearAttachment()
      if (epoch !== this.epoch || this.target !== wc || wc.isDestroyed()) return

      this.wc = wc
      try {
        // Seed the restore value from the persisted shell session. The hidden sqlite host is ready
        // before Maestro opens, but a read failure still means "no restore value", not an unsafe
        // partial bridge.
        this.current = await session.getSession().catch(() => null)
        if (epoch !== this.epoch || this.target !== wc || this.wc !== wc || wc.isDestroyed()) return
        console.log('[coach auth] attach bridge', sessionMeta(this.current))
        const dbg = wc.debugger
        if (!dbg.isAttached()) throw new Error('AI-CRMS auth bridge requires an attached debugger.')

        // Runtime belongs to this bridge on the non-recordable auth tab. Attachment is fail-closed:
        // no trusted page navigation occurs unless every command and the document-start script work.
        await dbg.sendCommand('Runtime.enable')
        await dbg.sendCommand('Page.enable')
        await dbg.sendCommand('Runtime.addBinding', { name: BINDING })
        if (epoch !== this.epoch || this.target !== wc || this.wc !== wc || wc.isDestroyed()) return
        dbg.on('message', this.onMessage)
        this.wired = true
        await this.registerScript(epoch, wc, true)
        await dbg.sendCommand('Runtime.evaluate', { expression: injectSource(this.current) })
        if (
          epoch !== this.epoch ||
          this.target !== wc ||
          this.wc !== wc ||
          wc.isDestroyed() ||
          !this.scriptId
        ) {
          return
        }
        this.accepting = true
      } catch (err) {
        if (this.target === wc) this.target = null
        await this.clearAttachment()
        throw err
      }
    })
    await attach
  }

  isAttached(wc: WebContents): boolean {
    return (
      !wc.isDestroyed() &&
      this.target === wc &&
      this.wc === wc &&
      this.accepting &&
      Boolean(this.scriptId) &&
      wc.debugger.isAttached()
    )
  }

  async detach(wc?: WebContents): Promise<void> {
    if (wc && this.target !== wc && this.wc !== wc) return
    this.epoch += 1
    this.target = null
    this.disableCurrentListener()
    await this.enqueueTransition(async () => {
      await this.drainPending()
      await this.clearAttachment()
    })
  }

  async quiesce(): Promise<void> {
    await this.detach()
  }

  // (Re)register the document-start injection so a fresh ai-crms load sees the current
  // shared session. Called on attach and whenever the session changes.
  private registerScript = async (
    epoch = this.epoch,
    wc = this.wc,
    strict = false
  ): Promise<void> => {
    const dbg = wc?.debugger
    if (!dbg || wc.isDestroyed() || this.wc !== wc || epoch !== this.epoch) {
      if (strict) throw new Error('AI-CRMS auth bridge target changed before script registration.')
      return
    }
    try {
      const previousScriptId = this.scriptId
      if (previousScriptId) {
        await dbg.sendCommand('Page.removeScriptToEvaluateOnNewDocument', { identifier: previousScriptId })
        if (this.wc !== wc || epoch !== this.epoch) return
        if (this.scriptId === previousScriptId) this.scriptId = null
      }
      const res = (await dbg.sendCommand('Page.addScriptToEvaluateOnNewDocument', {
        source: injectSource(this.current)
      })) as { identifier?: string }
      if (this.wc !== wc || epoch !== this.epoch || wc.isDestroyed()) {
        if (res.identifier && !wc.isDestroyed()) {
          await dbg
            .sendCommand('Page.removeScriptToEvaluateOnNewDocument', { identifier: res.identifier })
            .catch(() => undefined)
        }
        return
      }
      this.scriptId = res.identifier ?? null
      if (!this.scriptId && strict) throw new Error('AI-CRMS auth bridge document-start script was not registered.')
    } catch (err) {
      if (strict) throw err
    }
  }

  private enqueueTransition(task: () => Promise<void>): Promise<void> {
    const run = this.transition.catch(() => undefined).then(task)
    this.transition = run.catch(() => undefined)
    return run
  }

  private disableCurrentListener(): void {
    this.accepting = false
    const dbg = this.wc?.debugger
    if (dbg && this.wired) dbg.removeListener('message', this.onMessage)
    this.wired = false
  }

  private async drainPending(): Promise<void> {
    while (this.pending.size > 0) await Promise.allSettled([...this.pending])
  }

  private async clearAttachment(): Promise<void> {
    const wc = this.wc
    const dbg = wc?.debugger
    const scriptId = this.scriptId
    this.disableCurrentListener()
    this.wc = null
    this.scriptId = null
    this.current = null
    if (dbg && scriptId && !wc?.isDestroyed()) {
      await dbg
        .sendCommand('Page.removeScriptToEvaluateOnNewDocument', { identifier: scriptId })
        .catch(() => undefined)
    }
    if (dbg && !wc?.isDestroyed() && dbg.isAttached()) {
      await dbg.sendCommand('Runtime.removeBinding', { name: BINDING }).catch(() => undefined)
      await dbg.sendCommand('Runtime.disable').catch(() => undefined)
    }
  }

  private onMessage = (
    _e: unknown,
    method: string,
    params?: { name?: string; payload?: string; executionContextId?: number }
  ): void => {
    if (!this.accepting || method !== 'Runtime.bindingCalled' || params?.name !== BINDING) return
    const wc = this.wc
    const executionContextId = params.executionContextId
    if (!wc || wc.isDestroyed() || typeof executionContextId !== 'number' || !Number.isInteger(executionContextId)) return
    const epoch = this.epoch
    const pending = this.bindingTransition
      .catch(() => undefined)
      .then(() => this.handleBindingCall(wc, epoch, executionContextId, params.payload || ''))
    this.bindingTransition = pending.catch(() => undefined)
    this.pending.add(pending)
    void pending.then(
      () => this.pending.delete(pending),
      (err) => {
        this.pending.delete(pending)
        console.error('[coach auth] bridge payload failed:', err)
      }
    )
  }

  private async handleBindingCall(
    wc: WebContents,
    epoch: number,
    executionContextId: number,
    payloadJson: string
  ): Promise<void> {
    let result: { result?: { value?: { top?: unknown; href?: unknown } } }
    try {
      result = (await wc.debugger.sendCommand('Runtime.evaluate', {
        expression: '({ top: window.top === window, href: window.location.href })',
        contextId: executionContextId,
        returnByValue: true,
        silent: true
      })) as { result?: { value?: { top?: unknown; href?: unknown } } }
    } catch {
      return
    }
    if (
      !this.accepting ||
      this.epoch !== epoch ||
      this.wc !== wc ||
      wc.isDestroyed() ||
      result.result?.value?.top !== true ||
      typeof result.result?.value?.href !== 'string' ||
      !isTrustedAiCrmsAuthUrl(result.result.value.href) ||
      !isTrustedAiCrmsAuthUrl(wc.getURL())
    ) {
      return
    }
    await this.handle(payloadJson)
  }

  private async handle(payloadJson: string): Promise<void> {
    let payload: AuthPayload
    try {
      payload = JSON.parse(payloadJson) as AuthPayload
    } catch {
      console.warn('[coach auth] ignored malformed bridge payload')
      return
    }
    if (payload.type === 'login' && payload.jwt_token) {
      this.current = {
        jwt_token: payload.jwt_token,
        tenant_id: payload.tenant_id || '',
        region: payload.region,
        ts: Date.now()
      }
      console.log('[coach auth] login payload received', sessionMeta(this.current))
      let persisted = false
      await session
        .setSession(this.current)
        .then(() => {
          persisted = true
          console.log('[coach auth] sqlite session set ok', sessionMeta(this.current))
        })
        .catch((err) => console.error('[coach auth] sqlite session set failed:', err))
      if (persisted) writeMicromeetCliCredential(this.current)
      await this.registerScript()
      this.broadcast()
    } else if (payload.type === 'logout') {
      this.current = null
      console.log('[coach auth] logout payload received')
      await session
        .clearSession()
        .then(() => console.log('[coach auth] sqlite session cleared'))
        .catch((err) => console.error('[coach auth] sqlite session clear failed:', err))
      writeMicromeetCliCredential(null)
      await this.registerScript()
      this.broadcast()
    }
  }

  private broadcast(): void {
    console.log('[coach auth] broadcast', sessionMeta(this.current))
    xpcMain.broadcast(AUTH_BROADCAST, { loggedIn: !!this.current, session: this.current })
  }
}

export const authBridge = new AuthBridge()
