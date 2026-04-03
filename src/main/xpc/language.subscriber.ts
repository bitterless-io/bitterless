import { xpcMain } from 'electron-xpc/main';
import { i18nHelper } from '../i18n/i18n.helper';
import { trayHelper } from '../tray/tray.helper';

export const initLanguageSubscriber = (): void => {
  xpcMain.subscribe('language/changed', (payload) => {
    const lang = (payload.params.lang === 'en' || payload.params.lang === 'zh') ? payload.params.lang : 'en';
    i18nHelper.setLanguage(lang);
    trayHelper.updateMenu();
    console.log('[main language.subscriber] Language changed to:', lang);
  });
};
