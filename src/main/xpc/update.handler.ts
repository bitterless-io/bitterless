import { xpcMain } from 'electron-xpc/main';
import { updateService } from '../updateHelper/update.service';

let pollingStarted = false;

export const initUpdateHandler = (): void => {
  xpcMain.handle('update/startPolling', async () => {
    if (pollingStarted) {
      return;
    }
    pollingStarted = true;
    updateService.startPolling();
  });

  xpcMain.handle('update/quitAndInstall', async () => {
    updateService.quitAndInstall();
  });
};
