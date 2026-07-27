import { xpcRenderer, type XpcPayload } from 'electron-xpc/renderer';
import { updateStore } from '../store/update.store';

interface UpdateInfo {
  version: string;
  versionCode: string;
  releaseNotes: string;
  downloadUrl: string;
}

export const initUpdateSubscriber = (): void => {
  xpcRenderer.subscribe('app/updated', (payload: XpcPayload) => {
    const updateInfo = payload.params as UpdateInfo;
    console.log('[UpdateSubscriber] Received update notification:', updateInfo);
    updateStore.setUpdateInfo(updateInfo);
  });
};
