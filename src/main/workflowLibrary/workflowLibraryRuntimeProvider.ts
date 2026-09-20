import type { WorkflowLibraryService } from './workflowLibrary.service'
import type { LibraryRuntimeProvider } from './workflowLibraryRuntime'
import { renderWorkflowCatalog } from './workflowCatalogPrompt'

/**
 * What the chat host sees of the library. Every call re-reads the directory: the snapshot the
 * Workbench is showing may predate the owner's last save, and a run must use what is on disk now
 * (docs/features/local-workflow-directory.md).
 */
export const createWorkflowLibraryRuntime = (service: WorkflowLibraryService): LibraryRuntimeProvider => ({
  // `modelInvocation:false` is withheld from the model everywhere it could pick a workflow, not just
  // from the prompt — listing it while keeping it out of the catalog would be a distinction without
  // a difference.
  async list() {
    return service.snapshot().items.filter(row => !row.error && row.modelInvocation).map(row => ({
      name: row.ref, displayName: row.name, description: row.description, scope: 'local' as const, reference: row.ref,
      entry: { kind: 'library' as const, ref: row.ref }
    }))
  },
  catalogPrompt() { return renderWorkflowCatalog(service.items(), item => item.ref) },
  async resolve(ref) {
    const { item } = service.detail(ref)
    return { kind: 'file', path: item.entryPath }
  },
  async assertPath(path) { service.assertPath(path) }
})
