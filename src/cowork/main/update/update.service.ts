import { updateService as bitterlessUpdateService } from '@main/updateHelper/update.service'
import type { UpdateCheckResult } from '@cowork-shared/coach.api'

class CoworkUpdateAdapter {
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

  quitAndInstall(): void {
    bitterlessUpdateService.quitAndInstall()
  }
}

export const updateService = new CoworkUpdateAdapter()
