import type { WorkflowDescriptor, WorkflowEntry } from '../../shared/agentWorkflow.api'

export interface LibraryRuntimeProvider {
  list(): Promise<WorkflowDescriptor[]>
  /**
   * The catalog block for the system prompt, from the last published scan.
   *
   * Synchronous on purpose: the turn prompt is assembled synchronously (`steerActiveTurn` builds one
   * inline), and it is rebuilt every turn — an async rescan here would put a 200-manifest directory
   * walk on the latency path of typing.
   */
  catalogPrompt(): string
  resolve(ref: string): Promise<WorkflowEntry>
  assertPath(path: string): Promise<void>
}
let provider: LibraryRuntimeProvider | undefined
export const workflowLibraryRuntime = {
  register(value: LibraryRuntimeProvider): void { provider = value },
  async list(): Promise<WorkflowDescriptor[]> { return provider ? provider.list() : [] },
  catalogPrompt(): string { return provider ? provider.catalogPrompt() : '' },
  async resolve(ref: string): Promise<WorkflowEntry> { if (!provider) throw new Error('Workflow library is unavailable.'); return provider.resolve(ref) },
  async assertPath(path: string): Promise<void> { await provider?.assertPath(path) }
}
