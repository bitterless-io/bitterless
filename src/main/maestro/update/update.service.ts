import { updateService as bitterlessUpdateService } from '@main/updateHelper/update.service'
import type { UpdateCheckResult, UpdateInfo } from '@maestro-shared/coach.api'

class MaestroUpdateAdapter {
  async checkForUpdates(): Promise<UpdateCheckResult> {
    const result = await bitterlessUpdateService.manualCheck()
    return {
      status: result.status,
      currentVersionCode: result.currentVersionCode,
      info: result.info
        ? { version: result.info.version, versionCode: result.info.versionCode }
        : undefined,
      error: result.error
    }
  }

  getReadyUpdate(): UpdateInfo | null {
    const info = bitterlessUpdateService.getReadyUpdate()
    return info ? { version: info.version, versionCode: info.versionCode } : null
  }

  quitAndInstall(): void {
    bitterlessUpdateService.quitAndInstall()
  }
}

export const updateService = new MaestroUpdateAdapter()
