import { Menu, type BaseWindow } from 'electron';
import { i18nHelper } from '@main/i18n/i18n.helper';

export const showOnlyPreviewFileMenu = (window: BaseWindow): Promise<'open' | 'reveal' | 'copy-path' | null> => {
  if (window.isDestroyed()) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const finish = (action: 'open' | 'reveal' | 'copy-path' | null): void => {
      window.removeListener('closed', onClosed);
      resolve(action);
    };
    const onClosed = (): void => finish(null);
    const labels = i18nHelper.getMessages().app.onlyPreviewFileMenu;
    const menu = Menu.buildFromTemplate([
      { label: labels.openExternally, click: () => finish('open') },
      { label: labels.revealInFolder, click: () => finish('reveal') },
      { label: labels.copyPath, click: () => finish('copy-path') }
    ]);
    window.once('closed', onClosed);
    try {
      menu.popup({ window, callback: () => finish(null) });
    } catch (error) {
      window.removeListener('closed', onClosed);
      reject(error);
    }
  });
};
