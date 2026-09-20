import { reactive } from 'vue'
import { createXpcRendererEmitter, xpcRenderer } from 'electron-xpc/renderer'
import { INSTITUTION_SCOPE_CHANGED, INSTITUTION_SCOPE_HANDLER, type InstitutionScopeApi, type InstitutionScopeSnapshot } from '@shared/institutionScope.type'

/**
 * Which institution this account acts as. The picker used to live in the Workflows view, because
 * the workflow library was what resolved it; the library is now a local folder with no account at
 * all (docs/features/local-workflow-directory.md), so the control moves to Skills — the one feature
 * that still scopes by institution. Without it there would be no way to switch at all.
 */
const api = createXpcRendererEmitter<InstitutionScopeApi>(INSTITUTION_SCOPE_HANDLER)

export class InstitutionScopeState {
  snapshot: InstitutionScopeSnapshot | null = null
  loading = false
  error = ''
  private subscribed = false
  private request = 0
  constructor(private readonly client: InstitutionScopeApi = api) {}

  get institutions() { return this.snapshot?.institutions ?? [] }
  get institutionId() { return this.snapshot?.institutionId ?? undefined }

  async init(): Promise<void> {
    if (!this.subscribed) {
      this.subscribed = true
      xpcRenderer.subscribe(INSTITUTION_SCOPE_CHANGED, payload => { this.request++; this.snapshot = payload.params as InstitutionScopeSnapshot })
    }
    await this.refresh()
  }

  async refresh(institutionId?: number): Promise<void> {
    const request = ++this.request
    this.loading = true
    this.error = ''
    try {
      const reply = await this.client.snapshot(institutionId === undefined ? undefined : { institutionId })
      if (request !== this.request) return
      if (!reply?.ok) throw new Error(reply?.error || 'Institution request was not acknowledged.')
      this.snapshot = reply.value
      this.error = reply.value.error ?? ''
    } catch (error) { if (request === this.request) this.error = error instanceof Error ? error.message : String(error) }
    finally { this.loading = false }
  }
}
export const institutionScopeStore = reactive(new InstitutionScopeState())
