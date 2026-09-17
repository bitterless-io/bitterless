import { reactive } from 'vue'
import { createXpcRendererEmitter, xpcRenderer } from 'electron-xpc/renderer'
import type { WorkflowActivitySummary, WorkflowWaitState, WorkflowIpcApi, WorkflowDescriptor, WorkflowRunSnapshot, WorkflowSnapshot, WorkflowStartRequest } from '@shared/agentWorkflow.api'
const api = createXpcRendererEmitter<WorkflowIpcApi>('WorkflowHandler')
class WorkflowStore {
  runs: WorkflowRunSnapshot[] = []
  /** Model-written status sentences; absent entries leave the renderer's own line in place. */
  activity: WorkflowActivitySummary[] = []
  /** Pending waits, straight from the host registry — the status bar renders these, not model prose. */
  waiting: WorkflowWaitState[] = []
  revision = -1
  loading = false
  loadFailed = false
  initialized = false
  private subscribed = false
  private authGeneration = 0
  private authActive = true

  resume(): void { this.authActive = true }

  reset(): void {
    this.authActive = false
    this.authGeneration += 1
    this.runs = []
    this.activity = []
    this.waiting = []
    this.revision = -1
    this.loading = false
    this.loadFailed = false
    this.initialized = false
  }
  async listWorkflows(): Promise<WorkflowDescriptor[]> {
    const entries = await api.listWorkflows()
    if (!Array.isArray(entries)) throw new Error('Workflow catalog unavailable')
    return entries
  }
  async start(request: WorkflowStartRequest): Promise<WorkflowRunSnapshot> {
    const generation = this.authGeneration
    await this.init()
    if (!this.authActive || generation !== this.authGeneration) throw new Error('Signed out')
    const reply = await api.startWorkflow(request)
    if (generation !== this.authGeneration) throw new Error('Signed out')
    if (reply?.ok === false) throw new Error(reply.error)
    const run = reply?.ok === true ? reply.run : undefined
    if (!run?.id || run.sessionId !== request.sessionId) throw new Error('Workflow start was not acknowledged')
    await this.refresh()
    return run
  }
  async retry(sessionId: string, runId: string): Promise<WorkflowRunSnapshot> {
    const generation = this.authGeneration
    const reply = await api.retryWorkflow({ sessionId, runId })
    if (generation !== this.authGeneration) throw new Error('Signed out')
    if (reply?.ok === false) throw new Error(reply.error)
    const run = reply?.ok === true ? reply.run : undefined
    if (!run?.id || run.id === runId || run.sessionId !== sessionId) throw new Error('Workflow retry was not acknowledged')
    await this.refresh()
    return run
  }
  private apply(snapshot: WorkflowSnapshot): void {
    if (!snapshot || !Array.isArray(snapshot.runs) || !Number.isFinite(snapshot.revision) || snapshot.revision < this.revision) return
    this.runs = snapshot.runs
    this.activity = Array.isArray(snapshot.activity) ? snapshot.activity : []
    this.waiting = Array.isArray(snapshot.waiting) ? snapshot.waiting : []
    this.revision = snapshot.revision
    this.loadFailed = false
  }

  waitFor(sessionId: string): WorkflowWaitState | undefined {
    return this.waiting.find(entry => entry.sessionId === sessionId)
  }
  activityFor(sessionId: string): WorkflowActivitySummary | undefined {
    return this.activity.find(entry => entry.sessionId === sessionId)
  }
  async init(): Promise<void> {
    if (!this.authActive || this.initialized) return
    if (!this.subscribed) {
      this.subscribed = true
      xpcRenderer.subscribe('agent/workflows', payload => {
        if (this.initialized) this.apply(payload.params as WorkflowSnapshot)
      })
    }
    this.initialized = true
    await this.refresh()
  }
  async refresh(): Promise<void> {
    if (!this.authActive || this.loading) return
    const generation = this.authGeneration
    this.loading = true
    const revision = this.revision
    try {
      const snapshot = await api.listRuns({})
      if (generation !== this.authGeneration) return
      if (!snapshot || !Array.isArray(snapshot.runs) || !Number.isFinite(snapshot.revision)) throw new Error('Workflow snapshot unavailable')
      this.apply(snapshot)
    }
    catch { if (generation === this.authGeneration && this.revision === revision) this.loadFailed = true }
    finally { if (generation === this.authGeneration) this.loading = false }
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
  /** Stops one whole workflow, leaving other runs in this chat and the main chat untouched. */
  async stopWorkflow(sessionId: string, runId: string): Promise<void> {
    const reply = await api.stopWorkflow({ sessionId, runId })
    if (reply?.ok !== true) throw new Error('Workflow stop was not acknowledged')
  }
  async stopSession(sessionId: string): Promise<void> {
    const reply = await api.stopSession({ sessionId })
    if (reply?.ok !== true) throw new Error('Workflow stop was not acknowledged')
  }
}
export const workflowStore = reactive(new WorkflowStore())
