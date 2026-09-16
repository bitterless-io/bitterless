import type { WorkflowDescriptor, WorkflowEntry } from '../../shared/agentWorkflow.api'

export interface LibraryRuntimeProvider {
  list(): Promise<WorkflowDescriptor[]>
  resolve(ref: string): Promise<WorkflowEntry>
  assertPath(path: string): Promise<void>
}
let provider: LibraryRuntimeProvider | undefined
export const workflowLibraryRuntime = {
  register(value: LibraryRuntimeProvider): void { provider = value },
  async list(): Promise<WorkflowDescriptor[]> { return provider ? provider.list() : [] },
  async resolve(ref: string): Promise<WorkflowEntry> { if (!provider) throw new Error('Workflow library is unavailable.'); return provider.resolve(ref) },
  async assertPath(path: string): Promise<void> { await provider?.assertPath(path) }
}
