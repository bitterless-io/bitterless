import { app, dialog, shell } from 'electron'
import { readFile, stat } from 'node:fs/promises'
import { XpcMainHandler, xpcMain } from 'electron-xpc/main'
import { WorkflowLibraryService, workflowRefOf } from '@main/workflowLibrary/workflowLibrary.service'
import { importWorkflowPackage } from '@main/workflowLibrary/workflowPackageImport'
import { workflowsRoot } from '@main/workflowLibrary/workflowsRoot'
import { createWorkflowLibraryRuntime } from '@main/workflowLibrary/workflowLibraryRuntimeProvider'
import { workflowLibraryRuntime } from '@main/workflowLibrary/workflowLibraryRuntime'
import { WORKFLOW_LIMITS } from '@shared/workflowPackage'
import { WORKFLOW_LIBRARY_CHANGED, type WorkflowLibraryApi, type WorkflowLibraryReply } from '@shared/workflowLibrary.type'
import { loadWorkflowParser } from '@main/agent/workflowEngine/dynamic/dynamicLoader';

const service = new WorkflowLibraryService({
  root: workflowsRoot,
  changed: snapshot => xpcMain.broadcast(WORKFLOW_LIBRARY_CHANGED, snapshot)
})
workflowLibraryRuntime.register(createWorkflowLibraryRuntime(service))
app.once('before-quit', () => service.dispose())

/**
 * Scan once at boot rather than on first use (docs/features/workflow-catalog-in-prompt.md ①).
 *
 * Two things depend on it: the directory watcher is installed by the first scan, and the
 * system-prompt catalog reads the last published snapshot — so before this, a chat started without
 * ever opening the Workbench was told there are no workflows, which is indistinguishable from an
 * empty folder.
 *
 * Called from `app.main`, not on import: it has to run AFTER `ensureWorkflowsRoot()` seeds the demo
 * package and after the E2E home redirect, and an import-time scan is ordered by whoever imports
 * first. Cowork calls its equivalent at the same moment.
 */
let started = false
export const startWorkflowLibrary = async (): Promise<void> => {
  if (started) return
  started = true
  // Before the first scan, never during it: the parser is an ESM-only module the CJS main bundle can
  // only reach through a dynamic import, and the scanner itself is synchronous. Awaiting it here is
  // what lets every parse below stay a plain function call (dynamicLoader.ts).
  await loadWorkflowParser()
  service.snapshot()
}
const reply = async <T>(operation: () => T | Promise<T>): Promise<WorkflowLibraryReply<T>> => {
  try { return { ok: true, value: await operation() } }
  catch (error) { return { ok: false, error: error instanceof Error ? error.message : 'Workflow request failed.' } }
}
class WorkflowLibraryHandler extends XpcMainHandler implements WorkflowLibraryApi {
  snapshot() { return reply(() => service.snapshot()) }
  detail(params: { ref: string }) { return reply(() => service.detail(params.ref)) }
  source(params: { ref: string }) { return reply(() => service.source(params.ref)) }
  openRoot() {
    return reply(async () => {
      const root = service.snapshot().root
      const failure = await shell.openPath(root)
      if (failure) throw new Error(failure)
      return root
    })
  }
  reveal(params: { ref: string }) {
    return reply(() => {
      const path = service.directory(params.ref)
      shell.showItemInFolder(path)
      return path
    })
  }
  importPackage() {
    return reply(async () => {
      const selected = await dialog.showOpenDialog({ title: 'Import workflow package', filters: [{ name: 'Workflow ZIP', extensions: ['zip'] }], properties: ['openFile'] })
      if (selected.canceled || !selected.filePaths[0]) return null
      const path = selected.filePaths[0]
      const info = await stat(path)
      if (!info.isFile() || info.size > WORKFLOW_LIMITS.compressed) throw new Error('Choose a workflow ZIP smaller than 20 MiB.')
      const directory = importWorkflowPackage(service.snapshot().root, await readFile(path))
      const item = service.snapshot().items.find(row => row.ref === workflowRefOf(directory))
      if (!item) throw new Error('The imported package could not be read back from the workflows folder.')
      return item
    })
  }
}
export const workflowLibraryHandler = new WorkflowLibraryHandler()
