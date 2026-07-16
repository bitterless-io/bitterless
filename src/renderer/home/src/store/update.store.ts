import { reactive } from 'vue';
import { xpcRenderer } from 'electron-xpc/renderer';

interface UpdateInfo {
  version: string;
  versionCode: string;
  releaseNotes: string;
  downloadUrl: string;
}

class UpdateState {
  updateAvailable = false;
  updateInfo: UpdateInfo | null = null;

  setUpdateInfo(info: UpdateInfo): void {
    this.updateAvailable = true;
    this.updateInfo = info;
    console.log('[UpdateStore] Update available:', info);
  }

  async restartAndUpdate(): Promise<void> {
    console.log('[UpdateStore] Restarting to apply update...');
    await xpcRenderer.send('UpdateHandler/quitAndInstall');
  }

  async checkForUpdates(): Promise<void> {
    console.log('[UpdateStore] Manually checking for updates...');
    await xpcRenderer.send('UpdateHandler/checkForUpdates');
  }
}

export const updateStore = reactive<UpdateState>(new UpdateState());
