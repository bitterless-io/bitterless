import { xpcMain } from 'electron-xpc/main';

export const initTestSubscriber = (): void => {
  xpcMain.subscribe('hi_everyone', (payload) => {
    console.log('[test.subscriber] hi_everyone received:', payload);
  });
};
