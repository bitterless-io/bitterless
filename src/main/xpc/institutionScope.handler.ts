import { app } from 'electron'
import { XpcMainHandler, xpcMain } from 'electron-xpc/main'
import { customerSessionService } from '@main/auth/customerSession.service'
import { assetScope } from '@main/institution/assetScope.service'
import { InstitutionScopeService } from '@main/institution/institutionScope.service'
import { INSTITUTION_SCOPE_CHANGED, type InstitutionScopeApi, type InstitutionScopeReply } from '@shared/institutionScope.type'

const service = new InstitutionScopeService({
  session: () => customerSessionService.current,
  changed: snapshot => xpcMain.broadcast(INSTITUTION_SCOPE_CHANGED, snapshot)
})
assetScope.bindRevalidation(async () => {
  const snapshot = await service.snapshot()
  if (snapshot.status === 'error') throw new Error(snapshot.error || 'Institution authorization is unavailable.')
})
const unsubscribe = customerSessionService.subscribe(() => { service.reset(); if (customerSessionService.current) void service.snapshot() })
if (customerSessionService.current) void service.snapshot()
app.once('before-quit', () => { unsubscribe(); service.dispose() })

class InstitutionScopeHandler extends XpcMainHandler implements InstitutionScopeApi {
  async snapshot(params?: { institutionId?: number }): Promise<InstitutionScopeReply<Awaited<ReturnType<typeof service.snapshot>>>> {
    try { return { ok: true, value: await service.snapshot(params) } }
    catch (error) { return { ok: false, error: error instanceof Error ? error.message : 'Institution request failed.' } }
  }
}
export const institutionScopeHandler = new InstitutionScopeHandler()
