import { relative, resolve, sep } from 'node:path'
import { realpath } from 'node:fs/promises'
import type { WorkflowLibraryService } from './workflowLibrary.service'
import type { LibraryRuntimeProvider } from './workflowLibraryRuntime'

export const createWorkflowLibraryRuntime = (service: WorkflowLibraryService, libraryRoot: () => string): LibraryRuntimeProvider => ({
  async list() {
    const snapshot = await service.snapshot()
    return snapshot.items.map(row => ({ name: row.ref, displayName: row.name, description: row.description, scope: row.scope, institution_id: row.scope === 'institution' ? row.institution_id : undefined, ref: row.ref, entry: { kind: 'library' as const, ref: row.ref } }))
  },
  async resolve(ref) {
    const snapshot = await service.snapshot()
    const row = snapshot.items.find(item => item.ref === ref)
    if (!row) throw new Error('Workflow reference is not available in this account and institution.')
    const detail = await service.preview({ id: row.id, scope: row.scope, context: snapshot.context })
    return { kind: 'file', path: detail.entry }
  },
  async assertPath(path) {
    const root = await realpath(libraryRoot()).catch(() => resolve(libraryRoot()))
    const actual = await realpath(path).catch(() => resolve(path))
    const child = relative(root, actual)
    if (child === '..' || child.startsWith(`..${sep}`) || resolve(actual) === root || !actual.startsWith(root + sep)) return
    if (child === 'shared' || child.startsWith(`shared${sep}`)) return
    const snapshot = await service.snapshot()
    if (snapshot.status !== 'ready') throw new Error('Institution workflow access is unavailable. Refresh your institution.')
    const entries = await Promise.all(service.currentInstalled().map(async row => ({ row, path: await realpath(row.entry).catch(() => resolve(row.entry)) })))
    const installed = entries.find(item => item.path === actual)?.row
    if (installed) {
      const detail = await service.preview({ id: installed.id, context: snapshot.context, scope: 'institution' })
      if (await realpath(detail.entry).catch(() => resolve(detail.entry)) === actual) return
    }
    throw new Error('This workflow file does not belong to the current authorized institution.')
  }
})
