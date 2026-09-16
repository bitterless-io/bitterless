import { reactive } from 'vue'
import { createXpcRendererEmitter, xpcRenderer } from 'electron-xpc/renderer'
import type { WorkflowIpcApi, WorkflowDescriptor, WorkflowRunSnapshot, WorkflowSnapshot, WorkflowStartRequest } from '@shared/agentWorkflow.api'
const api = createXpcRendererEmitter<WorkflowIpcApi>('WorkflowHandler')
class WorkflowStore {
  runs: WorkflowRunSnapshot[] = []
  revision = -1
  loading = false
  loadFailed = false
  initialized = false
  private subscribed = false
  async listWorkflows(): Promise<WorkflowDescriptor[]> {
    const entries = await api.listWorkflows()
    if (!Array.isArray(entries)) throw new Error('Workflow catalog unavailable')
    return entries
  }
  async start(request: WorkflowStartRequest): Promise<WorkflowRunSnapshot> {
    await this.init()
    const reply = await api.startWorkflow(request)
    if (reply?.ok === false) throw new Error(reply.error)
    const run = reply?.ok === true ? reply.run : undefined
    if (!run?.id || run.sessionId !== request.sessionId) throw new Error('Workflow start was not acknowledged')
    await this.refresh()
    return run
  }
  async retry(sessionId: string, runId: string): Promise<WorkflowRunSnapshot> {
    const reply = await api.retryWorkflow({ sessionId, runId })
    if (reply?.ok === false) throw new Error(reply.error)
    const run = reply?.ok === true ? reply.run : undefined
    if (!run?.id || run.id === runId || run.sessionId !== sessionId) throw new Error('Workflow retry was not acknowledged')
    await this.refresh()
    return run
  }
  private apply(snapshot: WorkflowSnapshot): void {
    if (!snapshot || !Array.isArray(snapshot.runs) || !Number.isFinite(snapshot.revision) || snapshot.revision < this.revision) return
    this.runs = snapshot.runs
    this.revision = snapshot.revision
    this.loadFailed = false
  }
  async init(): Promise<void> {
    if (!this.subscribed) {
      this.subscribed = true
      xpcRenderer.subscribe('agent/workflows', payload => this.apply(payload.params as WorkflowSnapshot))
    }
    if (this.initialized) return
    this.initialized = true
    await this.refresh()
  }
  async refresh(): Promise<void> {
    if (this.loading) return
    this.loading = true
    const revision = this.revision
    try {
      const snapshot = await api.listRuns({})
      if (!snapshot || !Array.isArray(snapshot.runs) || !Number.isFinite(snapshot.revision)) throw new Error('Workflow snapshot unavailable')
      this.apply(snapshot)
    }
    catch { if (this.revision === revision) this.loadFailed = true }
    finally { this.loading = false }
  }
  async pauseAgent(sessionId: string, runId: string, agentId: string): Promise<void> {
    const reply = await api.pauseWorkflowAgent({ sessionId, runId, agentId })
    if (reply?.ok !== true) throw new Error('Workflow pause was not acknowledged')
  }
  async resumeAgent(sessionId: string, runId: string, agentId: string): Promise<void> {
    const reply = await api.resumeWorkflowAgent({ sessionId, runId, agentId })
    if (reply?.ok !== true) throw new Error('Workflow resume was not acknowledged')
  }
  async stopAgent(sessionId: string, runId: string, agentId: string): Promise<void> {
    const reply = await api.stopAgent({ sessionId, runId, agentId })
    if (reply?.ok !== true) throw new Error('Workflow stop was not acknowledged')
  }
  async stopSession(sessionId: string): Promise<void> {
    const reply = await api.stopSession({ sessionId })
    if (reply?.ok !== true) throw new Error('Workflow stop was not acknowledged')
  }
}
export const workflowStore = reactive(new WorkflowStore())
