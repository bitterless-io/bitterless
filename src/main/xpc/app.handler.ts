import { XpcMainHandler } from 'electron-xpc/main';
import { app } from 'electron';
import { dialogHelper } from '../dialog/dialog.helper';

class AppHandler extends XpcMainHandler {
  async requestQuit(): Promise<void> {
    const shouldQuit = await dialogHelper.showQuitConfirmDialog();
    if (shouldQuit) {
      app.quit();
    }
  }
}

export const appHandler = new AppHandler();
