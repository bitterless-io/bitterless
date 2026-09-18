export type WorkflowNodeKind = 'function' | 'agent' | 'parallel' | 'branch' | 'foreach' | 'loop' | 'workflow'
export interface WorkflowGraphNode { id: string; label: string; kind: WorkflowNodeKind; description?: string }
export interface WorkflowGraphEdge { from: string; to: string; label?: string }
export interface WorkflowManifest {
  format: 'kimchi-workflow-package'
  version: 1
  engine: 'kimchi-0.0.9'
  entry: string
  name: string
  description: string
  graph: { nodes: WorkflowGraphNode[]; edges: WorkflowGraphEdge[] }
}
export interface CloudWorkflow {
  id: number; institution_id: number; revision: number; name: string; description: string
  file_name: string; size: number; hash: string; created_at: string; updated_at: string
}
export interface InstalledWorkflow { id: number; revision: number; hash: string; size: number; entry: string; directory: string; installedAt: string; manifest: WorkflowManifest }
export interface WorkflowInstitution { id: number; name: string; role: string }
export interface WorkflowLibraryItem extends CloudWorkflow { scope: 'shared' | 'institution'; ref: string; installedRevision?: number; syncError?: string }
export interface WorkflowLibrarySnapshot {
  context: string
  status: 'ready' | 'unauthenticated' | 'no-institution' | 'error'
  institutions: WorkflowInstitution[]
  institutionId: number | null
  items: WorkflowLibraryItem[]
  lastChecked: string | null
  error: string | null
}
export interface WorkflowLibraryDetail { workflow: WorkflowLibraryItem; manifest: WorkflowManifest; entry: string; installedRevision: number }
export interface WorkflowSource { path: string; name: string; text: string; bytes: number; truncated: boolean }
export const MAX_SOURCE_BYTES = 256 * 1024
export type WorkflowLibraryReply<T> = { ok: true; value: T } | { ok: false; error: string }
export interface WorkflowLibraryApi {
  snapshot(params?: { institutionId?: number }): Promise<WorkflowLibraryReply<WorkflowLibrarySnapshot>>
  preview(params: { id: number; context: string; scope?: 'shared' | 'institution' }): Promise<WorkflowLibraryReply<WorkflowLibraryDetail>>
  source(params: { ref: string }): Promise<WorkflowLibraryReply<WorkflowSource>>
  importShared(): Promise<WorkflowLibraryReply<WorkflowLibraryDetail | null>>
}
export const WORKFLOW_LIBRARY_HANDLER = 'WorkflowLibraryHandler'
export const WORKFLOW_LIBRARY_CHANGED = 'workflow-library/changed'
