import { createHash, randomUUID } from 'node:crypto'
import type { CustomerSessionPayload } from '../../shared/auth/auth.type'
import type { InstitutionScopeSnapshot } from '../../shared/institutionScope.type'
import { assetScope } from './assetScope.service'

/**
 * Which institution this account is currently acting as.
 *
 * It used to live inside the remote workflow library, which resolved `/auth/me` + `/institution/mine`
 * on the way to syncing packages and set `assetScope` as a side effect. The workflow library is now a
 * local directory (docs/features/local-workflow-directory.md) and makes no network calls at all — but
 * institution **skills** still authorize through `assetScope`, so the resolution moves here instead of
 * being deleted with the workflow sync. Same requests, same namespace derivation, same generation
 * semantics; only the caller changed.
 */
interface ScopeOptions {
  session: () => CustomerSessionPayload | null
  fetch?: typeof fetch
  changed?: (snapshot: InstitutionScopeSnapshot) => void
}
class ScopeHttpError extends Error { constructor(readonly status: number) { super(`Institution service returned ${status}. Refresh and try again.`) } }
const empty = (context: string): InstitutionScopeSnapshot => ({ context, status: 'unauthenticated', institutions: [], institutionId: null, error: null })
const positive = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0

export class InstitutionScopeService {
  private state = empty(randomUUID())
  private controller = new AbortController()
  private queue: Promise<unknown> = Promise.resolve()
  private refreshPromise: Promise<InstitutionScopeSnapshot> | null = null
  private disposed = false
  constructor(private readonly options: ScopeOptions) {}

  reset(): void {
    assetScope.set(null)
    this.controller.abort()
    this.controller = new AbortController()
    this.state = empty(randomUUID())
    this.refreshPromise = null
    this.options.changed?.(this.state)
  }

  dispose(): void { this.disposed = true; this.reset() }

  async snapshot(params?: { institutionId?: number }): Promise<InstitutionScopeSnapshot> {
    if (params?.institutionId !== undefined) {
      if (!positive(params.institutionId)) throw new Error('Select a valid institution.')
      if (params.institutionId !== this.state.institutionId) {
        const institutions = this.state.institutions
        this.reset()
        this.state.institutions = institutions
        this.state.institutionId = params.institutionId
      }
    }
    if (this.refreshPromise) return this.refreshPromise
    const context = this.state.context
    const pending = this.serial(() => this.refresh(context))
    this.refreshPromise = pending
    try { return await pending }
    finally { if (this.refreshPromise === pending) this.refreshPromise = null }
  }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.queue.catch(() => undefined).then(operation)
    this.queue = pending.catch(() => undefined)
    return pending
  }

  private assertCurrent(context: string): void {
    if (this.disposed || context !== this.state.context || !this.options.session()) throw new Error('Account or institution changed. Refresh.')
  }

  private async refresh(context: string): Promise<InstitutionScopeSnapshot> {
    if (!this.options.session()) { if (context === this.state.context) this.reset(); return this.state }
    this.assertCurrent(context)
    try {
      const me = await this.api('/auth/me', undefined, context) as { id: number; scope: string; status: string }
      if (!positive(me.id) || me.scope !== 'customer' || me.status !== 'active') throw new ScopeHttpError(401)
      const memberships = await this.api('/institution/mine', undefined, context) as { list: Array<{ role: string; institution: { id: number; name: string } }> }
      if (!Array.isArray(memberships.list) || memberships.list.some(row => !positive(row.institution?.id) || typeof row.institution?.name !== 'string')) throw new Error('Invalid institution membership response.')
      this.assertCurrent(context)
      this.state.institutions = memberships.list.map(row => ({ id: row.institution.id, name: row.institution.name, role: row.role }))
      const previous = this.state.institutionId
      const selected = this.state.institutions.find(row => row.id === previous) ?? (previous ? undefined : this.state.institutions[0])
      if (!selected) {
        assetScope.set(null)
        this.state = { ...this.state, status: 'no-institution', institutionId: null, error: null }
        this.options.changed?.(this.state)
        return this.state
      }
      const session = this.options.session()!
      const namespace = createHash('sha256').update(`${session.baseUrl}\n${me.id}`).digest('hex')
      assetScope.set({ backend: session.baseUrl, accountId: me.id, institutionId: selected.id, institutionName: selected.name, namespace, generation: context })
      this.state = { ...this.state, status: 'ready', institutionId: selected.id, error: null }
      this.options.changed?.(this.state)
      return this.state
    } catch (error) {
      if (context !== this.state.context) return this.state
      if (error instanceof ScopeHttpError && [401, 403].includes(error.status)) {
        this.reset()
        this.state.status = error.status === 401 ? 'unauthenticated' : 'no-institution'
        this.state.error = error.message
      } else this.state = { ...this.state, status: 'error', error: error instanceof Error ? error.message : 'Institution request failed.' }
      this.options.changed?.(this.state)
      return this.state
    }
  }

  private async api(path: string, body: unknown, context: string): Promise<unknown> {
    this.assertCurrent(context)
    const session = this.options.session()!
    const response = await (this.options.fetch ?? fetch)(`${session.baseUrl}${path}`, {
      method: body === undefined ? 'GET' : 'POST', redirect: 'error', credentials: 'omit',
      headers: { 'content-type': 'application/json', '-x-bl-token': session.token },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(25_000)])
    })
    this.assertCurrent(context)
    if (!response.ok) throw new ScopeHttpError(response.status)
    return JSON.parse((await this.readBounded(response, 4 * 1024 * 1024)).toString('utf8'))
  }

  private async readBounded(response: Response, max: number): Promise<Buffer> {
    if (Number(response.headers.get('content-length')) > max) { await response.body?.cancel(); throw new Error('Institution response exceeds the size limit.') }
    if (!response.body) throw new Error('Institution response is empty.')
    const reader = response.body.getReader()
    const chunks: Buffer[] = []
    let size = 0
    try {
      for (;;) {
        const next = await reader.read()
        if (next.done) break
        size += next.value.length
        if (size > max) throw new Error('Institution response exceeds the size limit.')
        chunks.push(Buffer.from(next.value))
      }
      return Buffer.concat(chunks)
    } finally { await reader.cancel().catch(() => undefined); reader.releaseLock() }
  }
}
