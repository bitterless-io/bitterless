import { xpcRenderer } from 'electron-xpc/renderer';
import { updateStore } from '../store/update.store';

interface UpdateInfo {
  version: string;
  versionCode: string;
  releaseNotes: string;
  downloadUrl: string;
}

export const initUpdateSubscriber = () => {
  xpcRenderer.subscribe('app/updated', (updateInfo: UpdateInfo) => {
    console.log('[UpdateSubscriber] Received update notification:', updateInfo);
    updateStore.setUpdateInfo(updateInfo);
  });
};
