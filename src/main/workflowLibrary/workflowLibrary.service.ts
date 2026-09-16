import { createHash, randomUUID } from 'node:crypto'
import { join } from 'node:path'
import AdmZip from 'adm-zip'
import type { CustomerSessionPayload } from '../../shared/auth/auth.type'
import type { CloudWorkflow, InstalledWorkflow, WorkflowLibraryDetail, WorkflowLibrarySnapshot, WorkflowLibraryItem } from '../../shared/workflowLibrary.type'
import { sharedWorkflowDemoFiles } from '../../shared/sharedWorkflowDemo'
import { WORKFLOW_LIMITS } from '../../shared/workflowPackage'
import { WorkflowPackageStorage } from './workflowPackageStorage'
import { assetScope } from './assetScope.service'

interface LibraryOptions {
  session: () => CustomerSessionPayload | null
  root: () => string
  fetch?: typeof fetch
  changed?: (snapshot: WorkflowLibrarySnapshot) => void
}
class LibraryHttpError extends Error { constructor(readonly status: number) { super(`Workflow service returned ${status}. Refresh and try again.`) } }
const empty = (context: string): WorkflowLibrarySnapshot => ({ context, status: 'unauthenticated', institutions: [], institutionId: null, items: [], lastChecked: null, error: null })
const positive = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0
const cloudWorkflow = (value: unknown, institutionId: number): CloudWorkflow => {
  const row = value as CloudWorkflow
  if (!row || !positive(row.id) || !positive(row.revision) || row.institution_id !== institutionId || typeof row.name !== 'string' || typeof row.description !== 'string' || typeof row.file_name !== 'string' || !positive(row.size) || row.size > WORKFLOW_LIMITS.compressed || !/^[a-f0-9]{64}$/.test(row.hash)) throw new Error('Invalid workflow metadata returned by the server.')
  return { id: row.id, institution_id: row.institution_id, revision: row.revision, name: row.name, description: row.description, file_name: row.file_name, size: row.size, hash: row.hash, created_at: row.created_at, updated_at: row.updated_at }
}

export class WorkflowLibraryService {
  private state = empty(randomUUID())
  private controller = new AbortController()
  private storage: WorkflowPackageStorage | null = null
  private queue: Promise<unknown> = Promise.resolve()
  private refreshPromise: Promise<WorkflowLibrarySnapshot> | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private disposed = false
  constructor(private readonly options: LibraryOptions) {}

  start(): void {
    if (this.timer || this.disposed) return
    this.timer = setInterval(() => { if (this.options.session()) void this.snapshot().catch(() => undefined) }, 60_000)
    this.timer.unref?.()
  }

  reset(): void {
    assetScope.set(null)
    this.controller.abort()
    this.controller = new AbortController()
    this.storage = null
    this.state = empty(randomUUID())
    this.refreshPromise = null
    this.emit()
  }

  dispose(): void { this.disposed = true; if (this.timer) clearInterval(this.timer); this.timer = null; this.reset() }

  async snapshot(params?: { institutionId?: number }): Promise<WorkflowLibrarySnapshot> {
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

  async preview(params: { id: number; context: string; scope?: 'shared' | 'institution' }): Promise<WorkflowLibraryDetail> {
    if (!positive(params.id)) throw new Error('Select a valid workflow.')
    if (params.scope === 'shared') {
      const row = this.sharedStorage().read(params.id)
      if (!row) throw new Error('Shared workflow not found.')
      return { workflow: this.sharedItem(row), manifest: row.manifest, entry: row.entry, installedRevision: row.revision }
    }
    return this.serial(async () => {
      this.assertCurrent(params.context)
      const institutionId = this.state.institutionId
      if (!institutionId || !this.storage) throw new Error('Select an institution and refresh its workflows.')
      try {
        const row = cloudWorkflow(await this.api('/workflow/detail', { institution_id: institutionId, id: params.id }, params.context), institutionId)
        const installed = await this.install(row, params.context)
        this.assertCurrent(params.context)
        this.state.items = this.state.items.map(item => item.scope === 'institution' && item.id === row.id ? { ...this.institutionItem(row), installedRevision: installed.revision } : item)
        this.emit()
        return { workflow: { ...this.institutionItem(row), installedRevision: installed.revision }, manifest: installed.manifest, entry: installed.entry, installedRevision: installed.revision }
      } catch (error) {
        this.recordError(error, params.context, params.id)
        throw error
      }
    })
  }

  importShared(bytes: Buffer): WorkflowLibraryDetail {
    const storage = this.sharedStorage()
    const hash = createHash('sha256').update(bytes).digest('hex')
    const existing = storage.list().find(row => row.hash === hash)
    const row = existing ?? storage.install({ id: Date.now(), revision: 1, size: bytes.length, hash }, bytes)
    this.emit()
    return { workflow: this.sharedItem(row), manifest: row.manifest, entry: row.entry, installedRevision: row.revision }
  }

  private sharedStorage(): WorkflowPackageStorage {
    const storage = new WorkflowPackageStorage(join(this.options.root(), 'shared'))
    if (!storage.read(1)) {
      const archive = new AdmZip()
      for (const [name, content] of Object.entries(sharedWorkflowDemoFiles)) archive.addFile(name, Buffer.from(content))
      const bytes = archive.toBuffer()
      storage.install({ id: 1, revision: 1, size: bytes.length, hash: createHash('sha256').update(bytes).digest('hex') }, bytes)
    }
    return storage
  }

  private sharedItem(row: InstalledWorkflow): WorkflowLibraryItem {
    return { id: row.id, institution_id: 0, revision: row.revision, name: row.manifest.name, description: row.manifest.description, file_name: `${row.manifest.name}.zip`, size: row.size, hash: row.hash, created_at: row.installedAt, updated_at: row.installedAt, scope: 'shared', ref: `shared:${row.id}`, installedRevision: row.revision }
  }

  private institutionItem(row: CloudWorkflow): WorkflowLibraryItem { return { ...row, scope: 'institution', ref: `institution:${row.institution_id}:${row.id}` } }

  libraryItems(): WorkflowLibraryItem[] {
    return [...this.sharedStorage().list().map(row => this.sharedItem(row)), ...this.state.items.filter(row => row.scope === 'institution')]
  }

  currentInstalled(): InstalledWorkflow[] { return this.storage?.list() ?? [] }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.queue.catch(() => undefined).then(operation)
    this.queue = pending.catch(() => undefined)
    return pending
  }

  private assertCurrent(context: string): void {
    if (this.disposed || context !== this.state.context || !this.options.session()) throw new Error('Workflow account or institution changed. Refresh the library.')
  }

  private async refresh(context: string): Promise<WorkflowLibrarySnapshot> {
    if (!this.options.session()) { if (context === this.state.context) this.reset(); return this.state }
    this.assertCurrent(context)
    try {
      const me = await this.api('/auth/me', undefined, context) as { id: number; scope: string; status: string }
      if (!positive(me.id) || me.scope !== 'customer' || me.status !== 'active') throw new LibraryHttpError(401)
      const memberships = await this.api('/institution/mine', undefined, context) as { list: Array<{ role: string; institution: { id: number; name: string } }> }
      if (!Array.isArray(memberships.list) || memberships.list.some(row => !positive(row.institution?.id) || typeof row.institution?.name !== 'string')) throw new Error('Invalid institution membership response.')
      this.assertCurrent(context)
      this.state.institutions = memberships.list.map(row => ({ id: row.institution.id, name: row.institution.name, role: row.role }))
      const previousInstitution = this.state.institutionId
      const selected = this.state.institutions.find(row => row.id === previousInstitution) ?? (previousInstitution ? undefined : this.state.institutions[0])
      if (!selected) {
        assetScope.set(null)
        this.storage = null
        this.state = { ...this.state, status: 'no-institution', institutionId: null, items: [], error: null }
        this.emit()
        return this.state
      }
      this.state.institutionId = selected.id
      const session = this.options.session()!
      const namespace = createHash('sha256').update(`${session.baseUrl}\n${me.id}`).digest('hex')
      assetScope.set({ backend: session.baseUrl, accountId: me.id, institutionId: selected.id, institutionName: selected.name, namespace, generation: context })
      this.storage = new WorkflowPackageStorage(join(this.options.root(), namespace, String(selected.id)))
      const installed = this.storage.list()
      const syncErrors = new Map<number, string>()
      for (let offset = 0; offset < installed.length; offset += 500) {
        const batch = installed.slice(offset, offset + 500)
        const checked = await this.api('/workflow/check-updates', { institution_id: selected.id, installed: batch.map(row => ({ id: row.id, revision: row.revision })) }, context) as { list: Array<{ id: number; status: string; workflow: unknown }> }
        if (!Array.isArray(checked.list) || checked.list.length !== batch.length || new Set(checked.list.map(row => row.id)).size !== batch.length || checked.list.some(row => !batch.some(item => item.id === row.id))) throw new Error('Invalid workflow update response.')
        for (const result of checked.list) {
          this.assertCurrent(context)
          if (result.status === 'removed') this.storage.remove(result.id)
          else if (result.status === 'updated' || result.status === 'up_to_date') {
            const row = cloudWorkflow(result.workflow, selected.id)
            if (row.id !== result.id) throw new Error('Invalid workflow update identity.')
            if (result.status === 'updated') {
              try { await this.install(row, context) }
              catch (error) { this.assertCurrent(context); if (error instanceof LibraryHttpError && [401,403].includes(error.status)) throw error; syncErrors.set(row.id, error instanceof Error ? error.message : 'Workflow update failed.') }
            }
          } else throw new Error('Invalid workflow update status.')
        }
      }
      const items: CloudWorkflow[] = []
      for (let page = 1; page <= 100; page++) {
        const response = await this.api('/workflow/list', { institution_id: selected.id, page, page_size: 100 }, context) as { list: unknown[]; total: number }
        if (!Array.isArray(response.list) || !Number.isSafeInteger(response.total) || response.total < 0) throw new Error('Invalid workflow list response.')
        items.push(...response.list.map(row => cloudWorkflow(row, selected.id)))
        if (items.length >= response.total || !response.list.length) break
        if (page === 100) throw new Error('Workflow library is too large. Contact your institution administrator.')
      }
      this.assertCurrent(context)
      const local = new Map(this.storage.list().map(row => [row.id, row]))
      this.state = { ...this.state, status: 'ready', items: items.map(row => ({ ...this.institutionItem(row), installedRevision: local.get(row.id)?.revision, syncError: syncErrors.get(row.id) })), error: null, lastChecked: new Date().toISOString() }
      this.emit()
      return this.state
    } catch (error) { this.recordError(error, context); if (context !== this.state.context) return this.state; return this.state }
  }

  private async install(row: CloudWorkflow, context: string) {
    this.assertCurrent(context)
    const storage = this.storage!
    const existing = storage.read(row.id)
    if (existing?.revision === row.revision && existing.hash === row.hash) return existing
    const result = await this.api('/workflow/download-url', { institution_id: row.institution_id, id: row.id, revision: row.revision }, context) as { id: number; revision: number; size: number; hash: string; download_url: string }
    if (result.id !== row.id || result.revision !== row.revision || result.size !== row.size || result.hash !== row.hash) throw new Error('Workflow changed while downloading. Refresh and try again.')
    const url = new URL(result.download_url)
    if (url.protocol !== 'https:' || !url.hostname.endsWith('.aliyuncs.com') || url.username || url.password) throw new Error('Unsupported workflow archive host.')
    const response = await (this.options.fetch ?? fetch)(url, { credentials: 'omit', redirect: 'error', signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(60_000)]) })
    if (!response.ok) throw new Error('Workflow archive download failed. Refresh and try again.')
    const bytes = await this.readBounded(response, Math.min(row.size, WORKFLOW_LIMITS.compressed))
    this.assertCurrent(context)
    return storage.install(row, bytes, () => !this.disposed && context === this.state.context && !!this.options.session())
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
    if (!response.ok) throw new LibraryHttpError(response.status)
    return JSON.parse((await this.readBounded(response, 4 * 1024 * 1024)).toString('utf8'))
  }

  private async readBounded(response: Response, max: number): Promise<Buffer> {
    if (Number(response.headers.get('content-length')) > max) { await response.body?.cancel(); throw new Error('Workflow response exceeds the size limit.') }
    if (!response.body) throw new Error('Workflow response is empty.')
    const reader = response.body.getReader()
    const chunks: Buffer[] = []
    let size = 0
    try {
      for (;;) {
        const next = await reader.read()
        if (next.done) break
        size += next.value.length
        if (size > max) throw new Error('Workflow response exceeds the size limit.')
        chunks.push(Buffer.from(next.value))
      }
      return Buffer.concat(chunks)
    } finally { await reader.cancel().catch(() => undefined); reader.releaseLock() }
  }

  private recordError(error: unknown, context: string, id?: number): void {
    if (context !== this.state.context) return
    if (error instanceof LibraryHttpError && [401,403].includes(error.status)) {
      this.reset()
      this.state.status = error.status === 401 ? 'unauthenticated' : 'no-institution'
      this.state.error = error.message
    } else {
      const message = error instanceof Error ? error.message : 'Workflow request failed.'
      if (id) this.state.items = this.state.items.map(row => row.scope === 'institution' && row.id === id ? { ...row, syncError: message } : row)
      else this.state = { ...this.state, status: 'error', error: message }
    }
    this.emit()
  }

  private emit(): void { this.state = { ...this.state, items: this.libraryItems() }; this.options.changed?.(this.state) }
}
