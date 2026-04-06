import { xpcMain } from 'electron-xpc/main';
import { updateService } from '../updateHelper/update.service';

export const initUpdateHandler = (): void => {
  xpcMain.handle('UpdateHandler/startPolling', async () => {
    updateService.startPolling();
  });

  xpcMain.handle('UpdateHandler/checkForUpdates', async () => {
    await updateService.manualCheck();
  });

  xpcMain.handle('UpdateHandler/quitAndInstall', async () => {
    updateService.quitAndInstall();
  });
};
