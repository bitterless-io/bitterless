import { xpcRenderer, type XpcPayload } from 'electron-xpc/renderer';
import { parseUpdateInfo, updateStore } from '../store/update.store';

export const initUpdateSubscriber = (): void => {
  let liveReadyReceived = false;

  xpcRenderer.subscribe('app/updated', (payload: XpcPayload) => {
    const updateInfo = parseUpdateInfo(payload.params);
    if (!updateInfo) {
      console.error(
        '[UpdateSubscriber] Ignoring malformed live update-ready payload:',
        payload.params
      );
      return;
    }

    liveReadyReceived = true;
    console.log('[UpdateSubscriber] Received update notification:', updateInfo);
    updateStore.setUpdateInfo(updateInfo);
  });

  try {
    const readyUpdateRequest = xpcRenderer.send('UpdateHandler/getReadyUpdate');
    void readyUpdateRequest
      .then((snapshot: unknown) => {
        if (snapshot === null) return;

        const updateInfo = parseUpdateInfo(snapshot);
        if (!updateInfo) {
          console.error('[UpdateSubscriber] Ignoring malformed update-ready snapshot:', snapshot);
          return;
        }
        if (liveReadyReceived) return;

        updateStore.setUpdateInfo(updateInfo);
      })
      .catch((error: unknown) => {
        console.error('[UpdateSubscriber] Failed to replay update-ready snapshot:', error);
      });
  } catch (error) {
    console.error('[UpdateSubscriber] Failed to request update-ready snapshot:', error);
  }
};
