import { app, dialog } from 'electron'
import { join } from 'node:path'
import { readFile, stat } from 'node:fs/promises'
import { XpcMainHandler, xpcMain } from 'electron-xpc/main'
import { customerSessionService } from '@main/auth/customerSession.service'
import { WorkflowLibraryService } from '@main/workflowLibrary/workflowLibrary.service'
import { assetScope } from '@main/workflowLibrary/assetScope.service'
import { createWorkflowLibraryRuntime } from '@main/workflowLibrary/workflowLibraryRuntimeProvider'
import { workflowLibraryRuntime } from '@main/workflowLibrary/workflowLibraryRuntime'
import { WORKFLOW_LIMITS } from '@shared/workflowPackage'
import { maestroDataRoot } from '@maestro-main/data/maestroDataRoot'
import { WORKFLOW_LIBRARY_CHANGED, type WorkflowLibraryApi, type WorkflowLibraryReply } from '@shared/workflowLibrary.type'

const service = new WorkflowLibraryService({
  session: () => customerSessionService.current,
  root: () => join(maestroDataRoot(), 'institution-workflows'),
  changed: snapshot => xpcMain.broadcast(WORKFLOW_LIBRARY_CHANGED, snapshot)
})
service.start()
assetScope.bindRevalidation(async () => { const snapshot = await service.snapshot(); if (snapshot.status === 'error') throw new Error(snapshot.error || 'Institution authorization is unavailable.') })
workflowLibraryRuntime.register(createWorkflowLibraryRuntime(service, () => join(maestroDataRoot(), 'institution-workflows')))
const unsubscribe = customerSessionService.subscribe(() => { service.reset(); if (customerSessionService.current) void service.snapshot() })
app.once('before-quit', () => { unsubscribe(); service.dispose() })
const reply = async <T>(operation: () => Promise<T>): Promise<WorkflowLibraryReply<T>> => {
  try { return { ok: true, value: await operation() } }
  catch (error) { return { ok: false, error: error instanceof Error ? error.message : 'Workflow request failed.' } }
}
class WorkflowLibraryHandler extends XpcMainHandler implements WorkflowLibraryApi {
  snapshot(params?: { institutionId?: number }) { return reply(() => service.snapshot(params)) }
  preview(params: { id: number; context: string; scope?: 'shared' | 'institution' }) { return reply(() => service.preview(params)) }
  importShared() {
    return reply(async () => {
      const selected = await dialog.showOpenDialog({ title: 'Import shared workflow package', filters: [{ name: 'Workflow ZIP', extensions: ['zip'] }], properties: ['openFile'] })
      if (selected.canceled || !selected.filePaths[0]) return null
      const path = selected.filePaths[0]
      const info = await stat(path)
      if (!info.isFile() || info.size > WORKFLOW_LIMITS.compressed) throw new Error('Choose a workflow ZIP smaller than 20 MiB.')
      return service.importShared(await readFile(path))
    })
  }
}
export const workflowLibraryHandler = new WorkflowLibraryHandler()
