// Shared login session contract — the JWT + tenant the Coach shell shares with the embedded
// ai-crms. Stored in the sqlite window's renderer localStorage (key `mtk`, same key ai-crms
// uses on its own domain) and exposed over electron-xpc as CoworkSessionDao, reached via
// createXpc{Main,Renderer}Emitter<SessionApi>('CoworkSessionDao').

export interface AuthSession {
  /** ai-crms JWT (Authorization: Bearer <jwt_token>). */
  jwt_token: string
  /** ai-crms workspace / tenant id (x-workspace-id header). */
  tenant_id: string
  /** Selected region (SG/HK/ID); carried for parity, not required for auth. */
  region?: string
  /** ms timestamp the session was last written (0 if unknown). */
  ts: number
}

// Implemented by CoworkSessionDao (sqlite preload); consumed by main + control via xpc emitters.
export interface SessionApi {
  getSession(): Promise<AuthSession | null>
  setSession(params: AuthSession): Promise<{ ok: boolean }>
  clearSession(): Promise<{ ok: boolean }>
}

// Unified localStorage keys — identical on both the ai-crms origin and the shell's sqlite
// renderer, so the token key is the same everywhere ('mtk').
export const SESSION_TOKEN_KEY = 'mtk'
export const SESSION_WORKSPACE_KEY = 'crms.workspaceId'
export const SESSION_REGION_KEY = 'crms.region'

// Broadcast channel main → renderers when the login state changes (login / logout).
export const AUTH_BROADCAST = 'coach/auth'
export interface AuthBroadcast {
  loggedIn: boolean
  session: AuthSession | null
}
