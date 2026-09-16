import { reactive } from 'vue'
import { createXpcRendererEmitter, xpcRenderer } from 'electron-xpc/renderer'
import { WORKFLOW_LIBRARY_CHANGED, WORKFLOW_LIBRARY_HANDLER, type WorkflowLibraryApi, type WorkflowLibrarySnapshot, type WorkflowLibraryDetail } from '@shared/workflowLibrary.type'

const api = createXpcRendererEmitter<WorkflowLibraryApi>(WORKFLOW_LIBRARY_HANDLER)
export class WorkflowLibraryState {
  snapshot: WorkflowLibrarySnapshot | null = null
  detail: WorkflowLibraryDetail | null = null
  selectedRef: string | null = null
  scope: 'all' | 'shared' | 'institution' = 'all'
  selectedNodeId = ''
  search = ''
  loading = false
  loadingDetail = false
  error = ''
  detailError = ''
  activeTab: 'flow' | 'details' = 'flow'
  private active = false
  private subscribed = false
  private request = 0
  private detailRequest = 0
  constructor(private readonly client: WorkflowLibraryApi = api) {}

  get items() {
    const term = this.search.trim().toLocaleLowerCase()
    return (this.snapshot?.items ?? []).filter(row => (this.scope === 'all' || row.scope === this.scope) && `${row.name} ${row.description}`.toLocaleLowerCase().includes(term))
  }
  get selected() { return this.snapshot?.items.find(row => row.ref === this.selectedRef) ?? null }
  get selectedNode() { return this.detail?.manifest.graph.nodes.find(row => row.id === this.selectedNodeId) ?? null }

  async init(): Promise<void> {
    this.active = true
    if (!this.subscribed) {
      this.subscribed = true
      xpcRenderer.subscribe(WORKFLOW_LIBRARY_CHANGED, payload => {
        if (!this.active) return
        this.request++
        this.apply(payload.params as WorkflowLibrarySnapshot)
      })
    }
    await this.refresh()
  }
  destroy(): void { this.active = false; this.request++; this.detailRequest++; this.loading = false; this.loadingDetail = false }

  apply(snapshot: WorkflowLibrarySnapshot): void {
    const contextChanged = snapshot.context !== this.snapshot?.context
    const removed = this.selectedRef !== null && !snapshot.items.some(row => row.ref === this.selectedRef)
    if ((contextChanged && this.selected?.scope !== 'shared') || removed) {
      this.detailRequest++
      this.detail = null
      this.detailError = ''
      this.selectedRef = null
      this.selectedNodeId = ''
      this.loadingDetail = false
    }
    this.snapshot = snapshot
    this.error = snapshot.error ?? ''
    if (this.detail && this.selected && this.selected.installedRevision !== this.detail.installedRevision && !this.selected.syncError && !this.loadingDetail) void this.select(this.selected.ref)
  }

  async refresh(institutionId?: number): Promise<void> {
    const request = ++this.request
    this.loading = true
    this.error = ''
    if (institutionId !== undefined) {
      this.detailRequest++
      this.detail = null
      this.selectedRef = null
      this.snapshot = null
    }
    try {
      const reply = await this.client.snapshot(institutionId === undefined ? undefined : { institutionId })
      if (request !== this.request) return
      if (!reply?.ok) throw new Error(reply?.error || 'Workflow request was not acknowledged.')
      this.apply(reply.value)
    } catch (error) { if (request === this.request) this.error = error instanceof Error ? error.message : String(error) }
    finally { this.loading = false }
  }

  async select(ref: string): Promise<void> {
    const context = this.snapshot?.context
    const item = this.snapshot?.items.find(row => row.ref === ref)
    if (!context || !item) return
    const request = ++this.detailRequest
    if (this.selectedRef !== ref) { this.detail = null; this.selectedNodeId = '' }
    this.selectedRef = ref
    this.loadingDetail = true
    this.detailError = ''
    try {
      const reply = await this.client.preview({ id: item.id, scope: item.scope, context })
      if (request !== this.detailRequest || (item.scope !== 'shared' && context !== this.snapshot?.context)) return
      if (!reply?.ok) throw new Error(reply?.error || 'Workflow preview was not acknowledged.')
      this.detail = reply.value
      this.selectedNodeId = reply.value.manifest.graph.nodes[0]?.id ?? ''
    } catch (error) { if (request === this.detailRequest) this.detailError = error instanceof Error ? error.message : String(error) }
    finally { if (request === this.detailRequest) this.loadingDetail = false }
  }

  async importShared(): Promise<void> {
    try {
      const reply = await this.client.importShared()
      if (!reply?.ok) throw new Error(reply?.error || 'Workflow import was not acknowledged.')
      if (!reply.value) return
      await this.refresh()
      this.scope = 'shared'
      await this.select(reply.value.workflow.ref)
    } catch (error) { this.error = error instanceof Error ? error.message : String(error) }
  }

  async copyEntry(): Promise<void> {
    if (!this.detail) return
    try { await navigator.clipboard.writeText(`/workflow ${this.detail.workflow.ref}`) }
    catch (error) { this.detailError = error instanceof Error ? error.message : String(error) }
  }
}
export const workflowLibraryStore = reactive(new WorkflowLibraryState())
