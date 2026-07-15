import type { WebContents } from 'electron'
import { createXpcMainEmitter, xpcMain } from 'electron-xpc/main'
import type { AuthSession, SessionApi } from '@maestro-shared/session.api'
import { AUTH_BROADCAST } from '@maestro-shared/session.api'
import { writeMicromeetCliCredential } from '@maestro-main/cli/micromeetCli.service'

// Shell ↔ ai-crms login bridge. Runs ONLY on the pinned ai-crms tab. It piggybacks the
// capture-owned (already-attached) webContents.debugger — never attaches its own — to:
//   1. inject `window.isMicromeetAgentBrowser=true` + `window.__micromeetSharedSession`
//      at document-start (restore: ai-crms adopts the shell's session if its localStorage
//      is empty);
//   2. register `window.__micromeetAuth` (Runtime.addBinding) so ai-crms pushes the token
//      out on login / logout.
// Security: the caller MUST only attach this on our own ai-crms domain — never on embedded
// third-party / institution sites (else they could read the flag and exfiltrate the token).
// Design note: keep the login bridge attached only to the trusted AI-CRMS view.

const BINDING = '__micromeetAuth'

const session = createXpcMainEmitter<SessionApi>('MaestroSessionDao')

const sessionMeta = (s: AuthSession | null): Record<string, unknown> => ({
  authenticated: Boolean(s?.jwt_token),
  region: s?.region || ''
})

const injectSource = (s: AuthSession | null): string => {
  const shared = s ? JSON.stringify({ jwt_token: s.jwt_token, tenant_id: s.tenant_id, region: s.region }) : 'undefined'
  return `window.isMicromeetAgentBrowser = true; window.__micromeetSharedSession = ${shared};`
}

interface AuthPayload {
  type?: 'login' | 'logout'
  jwt_token?: string
  tenant_id?: string
  region?: string
}

class AuthBridge {
  private wc: WebContents | null = null
  private scriptId: string | null = null
  private current: AuthSession | null = null
  private wired = false
  private accepting = false
  private epoch = 0
  private pending = new Set<Promise<void>>()
  private transition: Promise<void> = Promise.resolve()

  /** Attach to the pinned ai-crms tab's webContents (debugger already attached by capture). */
  async attach(wc: WebContents): Promise<void> {
    const epoch = ++this.epoch
    this.disableCurrentListener()
    const attach = this.enqueueTransition(async () => {
      await this.drainPending()
      await this.clearAttachment()
      if (epoch !== this.epoch || wc.isDestroyed()) return

      this.wc = wc
      // Seed the restore value from the persisted shell session (best-effort; the sqlite
      // window may still be warming up on first boot — then we start with no shared session).
      this.current = await session.getSession().catch(() => null)
      if (epoch !== this.epoch || this.wc !== wc || wc.isDestroyed()) return
      console.log('[coach auth] attach bridge', sessionMeta(this.current))
      const dbg = wc.debugger
      // This bridge needs the Runtime event stream (for `bindingCalled`) and the Page domain
      // (for addScriptToEvaluateOnNewDocument). Capture no longer enables them globally — an
      // enabled Runtime is an anti-bot tell on third-party sites — so enable them here ourselves.
      // Safe: this bridge only ever runs on the pinned ai-crms tab, which has no bot detection.
      try {
        await dbg.sendCommand('Runtime.enable')
        await dbg.sendCommand('Page.enable')
      } catch {
        /* already enabled / teardown — fine */
      }
      if (epoch !== this.epoch || this.wc !== wc || wc.isDestroyed()) return
      try {
        await dbg.sendCommand('Runtime.addBinding', { name: BINDING })
      } catch {
        /* binding may already exist on a re-attach — fine */
      }
      if (epoch !== this.epoch || this.wc !== wc || wc.isDestroyed()) return
      dbg.on('message', this.onMessage)
      this.wired = true
      this.accepting = true
      await this.registerScript(epoch, wc)
      if (epoch !== this.epoch || this.wc !== wc || wc.isDestroyed()) return
      // Cover the already-loaded document too (addScriptToEvaluateOnNewDocument only fires on
      // the NEXT load).
      try {
        await dbg.sendCommand('Runtime.evaluate', { expression: injectSource(this.current) })
      } catch {
        /* no live document yet */
      }
    })
    await attach
  }

  async detach(): Promise<void> {
    this.epoch += 1
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
  private registerScript = async (epoch = this.epoch, wc = this.wc): Promise<void> => {
    const dbg = wc?.debugger
    if (!dbg || wc.isDestroyed() || this.wc !== wc || epoch !== this.epoch) return
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
    } catch {
      /* target closed / detached — ignore */
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
  }

  private onMessage = (_e: unknown, method: string, params?: { name?: string; payload?: string }): void => {
    if (!this.accepting || method !== 'Runtime.bindingCalled' || params?.name !== BINDING) return
    const pending = this.handle(params.payload || '')
    this.pending.add(pending)
    void pending.then(
      () => this.pending.delete(pending),
      (err) => {
        this.pending.delete(pending)
        console.error('[coach auth] bridge payload failed:', err)
      }
    )
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
