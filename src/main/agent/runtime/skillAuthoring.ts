import { app } from 'electron'
import { join } from 'node:path'

/** Use the same staged Bun runtime in development and packaged desktop builds. */
export const skillAuthoringRuntime = (globalRoot: string): { globalRoot: string; bunPath: string } => ({
  globalRoot,
  bunPath: join(app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'build'), 'maestro-tools', process.platform === 'win32' ? 'bun.exe' : 'bun')
})
