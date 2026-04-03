import { webContents } from 'electron';
import { xpcMain } from 'electron-xpc/main';

export const initTestHandler = (): void => {
  xpcMain.handle('testInvalid', async (payload) => {
    console.log('[testInvalid] received in main process:', payload);

    const target = webContents.fromId(1);
    if (!target) {
      console.log('[testInvalid] webContents id=1 not found');
      return null;
    }

    console.log('[testInvalid] sending to webContents id=1, isDestroyed:', target.isDestroyed(), 'isCrashed:', target.isCrashed());
    target.send('testInvalid', { message: 'hello from main' });

    return 'done';
  });
};
