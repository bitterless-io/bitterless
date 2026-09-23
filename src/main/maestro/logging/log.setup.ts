import { homeDataRoot } from '@shared/pathHelper/main/homeData';
import { workflowsRoot } from '@main/workflowLibrary/workflowsRoot';
import { app } from 'electron'
import { join } from 'path'

// Embedded Maestro never replaces Bitterless's process logger or console methods.
export const initLogging = (): void => undefined

export interface LogPaths {
  dir: string
  file: string
  env: 'dev' | 'prod'
  /** 见 `LogInfo.home` —— 这个 build 实际在用的 `~/.bitterless…`。 */
  home: string
  /** `<home>/workflows`。 */
  workflows: string
}

export const getLogPaths = (): LogPaths => {
  const dir = app.getPath('logs')
  return {
    dir,
    file: join(dir, 'main.log'),
    env: app.isPackaged ? 'prod' : 'dev',
    // 路径从 path 权威拿,不要手拼 —— `homeDataRoot()` 是这条推导的唯一所有者。
    home: homeDataRoot(),
    workflows: workflowsRoot()
  }
}
