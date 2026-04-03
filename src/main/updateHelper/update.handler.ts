import { XpcMainHandler } from 'electron-xpc/main';
import { updateService } from './update.service';

class UpdateHandler extends XpcMainHandler {
  async checkForUpdates(): Promise<void> {
    await updateService.manualCheck();
  }

  async quitAndInstall(): Promise<void> {
    updateService.quitAndInstall();
  }
}

export const updateHandler = new UpdateHandler();
