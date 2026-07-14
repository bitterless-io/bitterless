import { app } from 'electron'
import { join } from 'path'

// Embedded Cowork never replaces Bitterless's process logger or console methods.
export const initLogging = (): void => undefined

export interface LogPaths {
  dir: string
  file: string
  env: 'dev' | 'prod'
}

export const getLogPaths = (): LogPaths => {
  const dir = app.getPath('logs')
  return {
    dir,
    file: join(dir, 'main.log'),
    env: app.isPackaged ? 'prod' : 'dev'
  }
}
