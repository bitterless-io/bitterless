import { XpcPreloadHandler } from 'electron-xpc/preload'
import type { AuthSession, SessionApi } from '@cowork-shared/session.api'
import { SESSION_TOKEN_KEY, SESSION_WORKSPACE_KEY, SESSION_REGION_KEY } from '@cowork-shared/session.api'

// localStorage is the sqlite window renderer's per-origin store; the preload's isolated
// world shares it. Declared locally because the preload tsconfig ships no DOM lib.
declare const localStorage: {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

const TS_KEY = 'mtk.ts'

const sessionMeta = (session: AuthSession | null): Record<string, unknown> => ({
  authenticated: Boolean(session?.jwt_token),
  region: session?.region || ''
})

// XpcPreloadHandler: instantiating it (bottom) auto-registers `xpc:CoworkSessionDao/<method>`,
// callable from main (createXpcMainEmitter) and any renderer (createXpcRendererEmitter)
// as <SessionApi>('CoworkSessionDao'). The token is the shell's single shared login session.
export class CoworkSessionDao extends XpcPreloadHandler implements SessionApi {
  async getSession(): Promise<AuthSession | null> {
    const jwt_token = localStorage.getItem(SESSION_TOKEN_KEY)
    if (!jwt_token) {
      console.log('[coach sqlite session] getSession miss')
      return null
    }
    const session = {
      jwt_token,
      tenant_id: localStorage.getItem(SESSION_WORKSPACE_KEY) || '',
      region: localStorage.getItem(SESSION_REGION_KEY) || undefined,
      ts: Number(localStorage.getItem(TS_KEY)) || 0
    }
    console.log('[coach sqlite session] getSession hit', sessionMeta(session))
    return session
  }

  async setSession(params: AuthSession): Promise<{ ok: boolean }> {
    localStorage.setItem(SESSION_TOKEN_KEY, params.jwt_token)
    localStorage.setItem(SESSION_WORKSPACE_KEY, params.tenant_id || '')
    if (params.region) localStorage.setItem(SESSION_REGION_KEY, params.region)
    localStorage.setItem(TS_KEY, String(params.ts || 0))
    console.log('[coach sqlite session] setSession', sessionMeta(params))
    return { ok: true }
  }

  async clearSession(): Promise<{ ok: boolean }> {
    // Drop auth; keep region (it's a UI preference, not a credential).
    localStorage.removeItem(SESSION_TOKEN_KEY)
    localStorage.removeItem(SESSION_WORKSPACE_KEY)
    localStorage.removeItem(TS_KEY)
    console.log('[coach sqlite session] clearSession')
    return { ok: true }
  }
}

export const sessionDao = new CoworkSessionDao()
