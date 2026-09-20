/**
 * What a workflow package declares about itself.
 *
 * These live in the script's own `export const meta`, read statically by
 * `main/agent/workflowEngine/dynamic/dynamicLoader.ts`. There is no separate manifest file: the
 * Kimchi packaging kept one beside the entry and the two drifted constantly — a hand-authored node
 * graph that was never executed and produced no runtime symptom when it disagreed with the code.
 * One file, one source, no drift to guard against.
 */
export interface DynamicPhase {
  title: string
  detail?: string
}
export interface DynamicWorkflowMeta {
  name: string
  description: string
  /** When this package is the right route. Optional — a package written without it still works. */
  whenToUse: string
  /** `false` keeps it out of the prompt catalog and `workflow_list`; it stays runnable when named. */
  modelInvocation: boolean
  phases: DynamicPhase[]
}

export interface WorkflowLibraryItem {
  /** `local:<directory name>` — what `workflow_run` accepts and what the renderer selects by. */
  ref: string
  /** Directory name; the package's identity, and what the owner sees in Finder. */
  dir: string
  /** Absolute package directory. */
  path: string
  name: string
  description: string
  /** Package-relative entry script name, empty when the script could not be read. */
  entry: string
  /** Absolute entry path, empty when unavailable. */
  entryPath: string
  /** Entry size in bytes, 0 when unavailable. */
  bytes: number
  /** Package directory mtime, ISO. */
  modifiedAt: string
  /** Phase titles from the script's `meta.phases`, in order. Replaces the retired node graph. */
  phases: string[]
  /** When this package is the right route; empty when the script does not say. */
  whenToUse: string
  /** `false` keeps it out of the prompt catalog and `workflow_list`; it stays runnable by name. */
  modelInvocation: boolean
  error: string | null
}
export interface WorkflowLibrarySnapshot {
  /** Absolute workflows root for this environment — shown in the empty state, opened by `openRoot`. */
  root: string
  scannedAt: string
  items: WorkflowLibraryItem[]
  /** Packages beyond the scan cap. Reported rather than silently dropped. */
  dropped: number
  error: string | null
}
/** Fetched per selection, not carried in the snapshot: 200 scripts' metas would be. */
export interface WorkflowLibraryDetail { item: WorkflowLibraryItem; meta: DynamicWorkflowMeta }
export interface WorkflowSource { path: string; name: string; text: string; bytes: number; truncated: boolean }
export const MAX_SOURCE_BYTES = 256 * 1024
/** At most this many package directories are scanned; the remainder is reported as `dropped`. */
export const MAX_WORKFLOW_PACKAGES = 200
export type WorkflowLibraryReply<T> = { ok: true; value: T } | { ok: false; error: string }
export interface WorkflowLibraryApi {
  snapshot(): Promise<WorkflowLibraryReply<WorkflowLibrarySnapshot>>
  detail(params: { ref: string }): Promise<WorkflowLibraryReply<WorkflowLibraryDetail>>
  source(params: { ref: string }): Promise<WorkflowLibraryReply<WorkflowSource>>
  /** Open the workflows root in the OS file manager. Returns the path that was opened. */
  openRoot(): Promise<WorkflowLibraryReply<string>>
  /** Reveal one package directory in the OS file manager. */
  reveal(params: { ref: string }): Promise<WorkflowLibraryReply<string>>
  /** Pick a ZIP and expand it into the workflows root. Null when the dialog was cancelled. */
  importPackage(): Promise<WorkflowLibraryReply<WorkflowLibraryItem | null>>
}
export const WORKFLOW_LIBRARY_HANDLER = 'WorkflowLibraryHandler'
export const WORKFLOW_LIBRARY_CHANGED = 'workflow-library/changed'
