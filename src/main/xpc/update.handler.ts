import { xpcMain } from 'electron-xpc/main';
import { updateService } from '../updateHelper/update.service';

export const initUpdateHandler = (): void => {
  xpcMain.handle('UpdateHandler/startPolling', async () => {
    updateService.startPolling();
  });

  xpcMain.handle('UpdateHandler/checkForUpdates', async () => {
    return await updateService.manualCheck();
  });

  xpcMain.handle('UpdateHandler/getReadyUpdate', async () => {
    return updateService.getReadyUpdate();
  });

  xpcMain.handle('UpdateHandler/quitAndInstall', async () => {
    updateService.quitAndInstall();
  });
};
