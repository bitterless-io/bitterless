import { Menu, type BaseWindow } from 'electron';
import type { AccountMenuAction, AccountMenuParams } from '@shared/accountMenu';
import { i18nHelper } from '@main/i18n/i18n.helper';

export const showAccountMenu = (window: BaseWindow, params: AccountMenuParams): Promise<AccountMenuAction | null> => {
  if (window.isDestroyed()) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const finish = (action: AccountMenuAction | null): void => {
      window.removeListener('closed', onClosed);
      resolve(action);
    };
    const onClosed = (): void => finish(null);
    const labels = i18nHelper.getMessages().setting.account;
    const menu = Menu.buildFromTemplate([
      { label: params.signedIn ? params.email || labels.unavailable : labels.signedOut, enabled: false },
      { label: labels.changePassword, enabled: params.signedIn, click: () => finish('password') },
      { label: labels.logout, enabled: params.signedIn, click: () => finish('logout') }
    ]);
    window.once('closed', onClosed);
    try {
      menu.popup({ window, x: Math.round(params.x), y: Math.round(params.y), callback: () => finish(null) });
    } catch (error) {
      window.removeListener('closed', onClosed);
      reject(error);
    }
  });
};
