import { Type, type TSchema } from 'typebox'
import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import type { WorkerCommand, WorkerEvent, WorkflowHostToolRequest, WorkflowToolDescriptor } from './protocol'

function parameters(tool: WorkflowToolDescriptor): TSchema {
  const properties: Record<string, TSchema> = {}
  for (const param of tool.params) {
    let schema: TSchema = param.type === 'number' ? Type.Number() : param.type === 'boolean' ? Type.Boolean() : param.type === 'object' ? Type.Record(Type.String(), Type.Unknown()) : param.type === 'array' ? Type.Array(Type.Unknown()) : Type.String()
    if (param.description) schema = { ...schema, description: param.description }
    properties[param.name] = param.required ? schema : Type.Optional(schema)
  }
  return Type.Object(properties)
}

interface PendingCall {
  resolve(value: string): void
  reject(error: Error): void
  unlink(): void
  cancelled: boolean
}

/** Cancellation is a request; only the host's tool.result confirms that work settled. */
export class AgentHostTools {
  private calls = new Map<string, PendingCall>()
  private waiters = new Set<() => void>()
  private sequence = 0
  private stopped = false

  constructor(
    private owner: Pick<WorkflowHostToolRequest, 'sessionId' | 'runId' | 'agentId'>,
    private attemptId: string,
    private send: (event: WorkerEvent) => void
  ) {}

  tools(descriptors: WorkflowToolDescriptor[]): ToolDefinition[] {
    return descriptors.map(tool => ({
      name: tool.name, label: tool.name, description: tool.description, parameters: parameters(tool),
      execute: async (_id, args, signal) => ({
        content: [{ type: 'text', text: await this.call(tool.name, args as Record<string, unknown>, signal) }], details: {}
      })
    }))
  }

  private call(toolName: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
    if (this.stopped || signal?.aborted) return Promise.reject(new Error('Agent tool cancelled'))
    const callId = `${this.attemptId}:${++this.sequence}`
    return new Promise((resolve, reject) => {
      const cancel = () => this.cancel(callId)
      this.calls.set(callId, { resolve, reject, cancelled: false, unlink: () => signal?.removeEventListener('abort', cancel) })
      signal?.addEventListener('abort', cancel, { once: true })
      try { this.send({ type: 'tool.request', request: { ...this.owner, callId, toolName, args } }) }
      catch (error) { this.accept({ type: 'tool.result', callId, error: String(error) }) }
    })
  }

  private cancel(callId: string): void {
    const call = this.calls.get(callId)
    if (!call || call.cancelled) return
    call.cancelled = true
    this.send({ type: 'tool.cancel', callId })
  }

  cancelAll(): void {
    this.stopped = true
    for (const callId of this.calls.keys()) this.cancel(callId)
  }

  accept(message: Extract<WorkerCommand, { type: 'tool.result' }>): void {
    const call = this.calls.get(message.callId)
    if (!call) return
    this.calls.delete(message.callId); call.unlink()
    if (call.cancelled || message.error) call.reject(new Error(message.error || 'Agent tool cancelled'))
    else call.resolve(message.result ?? '')
    if (this.calls.size === 0) { for (const resolve of this.waiters) resolve(); this.waiters.clear() }
  }

  settled(): Promise<void> {
    return this.calls.size === 0 ? Promise.resolve() : new Promise(resolve => this.waiters.add(resolve))
  }
}
