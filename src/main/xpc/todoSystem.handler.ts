import { shell } from 'electron';
import { XpcMainHandler } from 'electron-xpc/main';
import type { TodoSystemApi } from '@shared/todoistSync/todoistSyncCapability.type';

export class TodoSystemHandler extends XpcMainHandler implements TodoSystemApi {
  async openDateTimeSettings(): Promise<void> {
    if (process.platform === 'darwin') {
      await shell.openExternal('x-apple.systempreferences:com.apple.Date-Time-Settings.extension');
      return;
    }
    if (process.platform === 'win32') {
      await shell.openExternal('ms-settings:dateandtime');
      return;
    }
    throw new Error('Date & Time settings are supported only on macOS and Windows');
  }
}

export const todoSystemHandler = new TodoSystemHandler();
