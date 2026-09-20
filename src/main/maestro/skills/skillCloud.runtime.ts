import { app } from 'electron'
import { xpcMain } from 'electron-xpc/main'
import { join } from 'node:path'
import { customerSessionService } from '@main/auth/customerSession.service'
import { assetScope } from '@main/institution/assetScope.service'
import { maestroDataRoot } from '@maestro-main/data/maestroDataRoot'
import { skillScopeContext } from './skillScope.context'
import { SkillCloudService } from './skillCloud.service'

export const skillCloud = new SkillCloudService({ root: () => join(maestroDataRoot(), 'skill-library'), session: () => customerSessionService.current,
  institution: () => skillScopeContext.current(), authorize: () => skillScopeContext.authorize(),
  changed: () => xpcMain.broadcast('coach/skills-changed', { ts: Date.now() }) })
skillCloud.resetAuthorization = () => assetScope.set(null)
skillCloud.start()
const unsubscribe = customerSessionService.subscribe(() => { skillCloud.reset(); if (customerSessionService.current) void skillCloud.refresh() })
const unsubscribeScope = assetScope.subscribe(() => { skillCloud.reset(); if (customerSessionService.current) void skillCloud.refresh() })
app.on('browser-window-focus', () => { if (customerSessionService.current) void skillCloud.refresh() })
app.once('before-quit', () => { unsubscribe(); unsubscribeScope(); skillCloud.dispose() })
