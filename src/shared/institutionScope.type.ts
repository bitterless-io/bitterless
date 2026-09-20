export interface InstitutionOption { id: number; name: string; role: string }
export interface InstitutionScopeSnapshot {
  context: string
  status: 'ready' | 'unauthenticated' | 'no-institution' | 'error'
  institutions: InstitutionOption[]
  institutionId: number | null
  error: string | null
}
export type InstitutionScopeReply<T> = { ok: true; value: T } | { ok: false; error: string }
export interface InstitutionScopeApi {
  snapshot(params?: { institutionId?: number }): Promise<InstitutionScopeReply<InstitutionScopeSnapshot>>
}
export const INSTITUTION_SCOPE_HANDLER = 'InstitutionScopeHandler'
export const INSTITUTION_SCOPE_CHANGED = 'institution-scope/changed'
