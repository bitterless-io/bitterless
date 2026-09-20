import { reactive } from 'vue'
import { createXpcRendererEmitter, xpcRenderer } from 'electron-xpc/renderer'
import { WORKFLOW_LIBRARY_CHANGED, WORKFLOW_LIBRARY_HANDLER, type WorkflowLibraryApi, type WorkflowLibrarySnapshot, type WorkflowLibraryDetail, type WorkflowSource } from '@shared/workflowLibrary.type'

export type WorkflowLibraryTab = 'flow' | 'details' | 'source'

const api = createXpcRendererEmitter<WorkflowLibraryApi>(WORKFLOW_LIBRARY_HANDLER)
const message = (error: unknown): string => error instanceof Error ? error.message : String(error)

export class WorkflowLibraryState {
  snapshot: WorkflowLibrarySnapshot | null = null
  detail: WorkflowLibraryDetail | null = null
  selectedRef: string | null = null
  search = ''
  loading = false
  loadingDetail = false
  error = ''
  detailError = ''
  activeTab: WorkflowLibraryTab = 'flow'
  source: WorkflowSource | null = null
  loadingSource = false
  sourceError = ''
  sourceCopied = false
  private active = false
  private subscribed = false
  private request = 0
  private detailRequest = 0
  private sourceRequest = 0
  constructor(private readonly client: WorkflowLibraryApi = api) {}

  get items() {
    const term = this.search.trim().toLocaleLowerCase()
    return (this.snapshot?.items ?? []).filter(row => `${row.name} ${row.dir} ${row.description}`.toLocaleLowerCase().includes(term))
  }
  get selected() { return this.snapshot?.items.find(row => row.ref === this.selectedRef) ?? null }
  get root() { return this.snapshot?.root ?? '' }

  async init(): Promise<void> {
    this.active = true
    if (!this.subscribed) {
      this.subscribed = true
      // The directory watcher publishes; the view does not poll.
      xpcRenderer.subscribe(WORKFLOW_LIBRARY_CHANGED, payload => {
        if (!this.active) return
        this.request++
        this.apply(payload.params as WorkflowLibrarySnapshot)
      })
    }
    await this.refresh()
  }
  destroy(): void { this.active = false; this.request++; this.detailRequest++; this.loading = false; this.loadingDetail = false; this.clearSource() }

  apply(snapshot: WorkflowLibrarySnapshot): void {
    const removed = this.selectedRef !== null && !snapshot.items.some(row => row.ref === this.selectedRef)
    this.snapshot = snapshot
    this.error = snapshot.error ?? ''
    if (removed) {
      this.detailRequest++
      this.detail = null
      this.detailError = ''
      this.selectedRef = null
      this.loadingDetail = false
      this.clearSource()
      return
    }
    // The package changed on disk while it was open — re-read rather than show a stale graph.
    if (this.selectedRef && !this.loadingDetail) void this.select(this.selectedRef)
  }

  async refresh(): Promise<void> {
    const request = ++this.request
    this.loading = true
    this.error = ''
    try {
      const reply = await this.client.snapshot()
      if (request !== this.request) return
      if (!reply?.ok) throw new Error(reply?.error || 'Workflow request was not acknowledged.')
      this.apply(reply.value)
    } catch (error) { if (request === this.request) this.error = message(error) }
    finally { this.loading = false }
  }

  async select(ref: string): Promise<void> {
    const item = this.snapshot?.items.find(row => row.ref === ref)
    if (!item) return
    const request = ++this.detailRequest
    if (this.selectedRef !== ref) { this.detail = null; this.clearSource() }
    this.selectedRef = ref
    this.loadingDetail = true
    this.detailError = ''
    try {
      const reply = await this.client.detail({ ref })
      if (request !== this.detailRequest) return
      if (!reply?.ok) throw new Error(reply?.error || 'Workflow preview was not acknowledged.')
      this.detail = reply.value
      if (this.activeTab === 'source') void this.loadSource()
    } catch (error) { if (request === this.detailRequest) { this.detail = null; this.detailError = message(error) } }
    finally { if (request === this.detailRequest) this.loadingDetail = false }
  }

  setTab(tab: WorkflowLibraryTab): void {
    this.activeTab = tab
    if (tab === 'source' && !this.source && !this.loadingSource && !this.sourceError) void this.loadSource()
  }

  async loadSource(): Promise<void> {
    const ref = this.selectedRef
    if (!ref) return
    const request = ++this.sourceRequest
    this.source = null
    this.loadingSource = true
    this.sourceError = ''
    this.sourceCopied = false
    try {
      const reply = await this.client.source({ ref })
      if (request !== this.sourceRequest) return
      if (!reply?.ok) throw new Error(reply?.error || 'Workflow source was not acknowledged.')
      this.source = reply.value
    } catch (error) { if (request === this.sourceRequest) this.sourceError = message(error) }
    finally { if (request === this.sourceRequest) this.loadingSource = false }
  }

  async copySource(): Promise<void> {
    if (!this.source) return
    try { await navigator.clipboard.writeText(this.source.text); this.sourceCopied = true }
    catch (error) { this.sourceCopied = false; this.sourceError = message(error) }
  }

  private clearSource(): void {
    this.sourceRequest++
    this.source = null
    this.sourceError = ''
    this.loadingSource = false
    this.sourceCopied = false
  }

  async openRoot(): Promise<void> {
    try {
      const reply = await this.client.openRoot()
      if (!reply?.ok) throw new Error(reply?.error || 'The workflows folder could not be opened.')
    } catch (error) { this.error = message(error) }
  }

  /**
   * Show a package's folder.
   *
   * Takes an optional ref so a LIST ROW can reveal without first selecting: reaching a folder should
   * not require changing what the detail pane is showing. Falls back to the selection for the
   * detail header's own button.
   */
  async reveal(ref?: string): Promise<void> {
    const target = ref || this.selectedRef
    if (!target) return
    try {
      const reply = await this.client.reveal({ ref: target })
      if (!reply?.ok) throw new Error(reply?.error || 'The workflow folder could not be revealed.')
    } catch (error) { this.error = message(error) }
  }

  async importPackage(): Promise<void> {
    try {
      const reply = await this.client.importPackage()
      if (!reply?.ok) throw new Error(reply?.error || 'Workflow import was not acknowledged.')
      if (!reply.value) return
      await this.refresh()
      await this.select(reply.value.ref)
    } catch (error) { this.error = message(error) }
  }

  async copyEntry(): Promise<void> {
    if (!this.selectedRef) return
    try { await navigator.clipboard.writeText(`/workflow ${this.selectedRef}`) }
    catch (error) { this.detailError = message(error) }
  }
}
export const workflowLibraryStore = reactive(new WorkflowLibraryState())
