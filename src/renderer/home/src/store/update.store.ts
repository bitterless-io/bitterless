import { reactive } from 'vue';
import { createXpcRendererEmitter } from 'electron-xpc/renderer';
import type { UpdateHandler } from '@main/updateHelper/update.handler';

interface UpdateInfo {
  version: string;
  versionCode: number;
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
    const updateEmitter = createXpcRendererEmitter<UpdateHandler>('UpdateHandler');
    await updateEmitter.quitAndInstall();
  }

  async checkForUpdates(): Promise<void> {
    console.log('[UpdateStore] Manually checking for updates...');
    const updateEmitter = createXpcRendererEmitter<UpdateHandler>('UpdateHandler');
    await updateEmitter.checkForUpdates();
  }
}

export const updateStore = reactive<UpdateState>(new UpdateState());
