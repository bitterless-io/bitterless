import { XpcMainHandler } from 'electron-xpc/main'
import { maestroWindowHelper } from '@maestro-main/windows/main/maestroWindow.controller'
import type { WorkflowIpcApi, WorkflowStartReply, WorkflowStartRequest } from '@shared/agentWorkflow.api'

class WorkflowHandler extends XpcMainHandler implements WorkflowIpcApi {
  private _host() { return maestroWindowHelper.agentService.getWorkflowHost() }
  async listRuns(params?: { sessionId?: string }) { return this._host().listRuns(params) }
  async listWorkflows() { return this._host().listWorkflows() }
  async startWorkflow(params: WorkflowStartRequest): Promise<WorkflowStartReply> {
    try {
      const run = await this._host().startWorkflow({ ...params, origin: 'shortcut' })
      return { ok: true, run }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }
  async retryWorkflow(params: { sessionId: string; runId: string }): Promise<WorkflowStartReply> {
    try { return { ok: true, run: await this._host().retryWorkflow(params) } }
    catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) } }
  }
  async stopAgent(params: { sessionId: string; runId: string; agentId: string }) { return this._host().stopAgent(params) }
  async stopWorkflow(params: { sessionId: string; runId: string }) { return this._host().stopWorkflow(params) }
  async stopSession(params: { sessionId: string }) { return this._host().stopSession(params) }
}

export const workflowHandler = new WorkflowHandler()
