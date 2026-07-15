import { createXpcMainEmitter, xpcMain } from 'electron-xpc/main';
import {
  APPLICATION_LANGUAGE_CHANGED_EVENT,
  ApplicationLanguageCoordinator,
  type AppLanguage,
  type ApplicationLanguageSnapshot,
  type DurableLanguageApi,
} from '@shared/i18n/applicationLanguage';
import { trayHelper } from '../tray/tray.helper';
import { i18nHelper } from './i18n.helper';
import { coinWindowManager } from '../coin/coinWindow.manager';

const durableLanguage = createXpcMainEmitter<DurableLanguageApi>('LanguageHandler');

class ApplicationLanguageService {
  private readonly coordinator = new ApplicationLanguageCoordinator(
    {
      read: async () => await durableLanguage.getLanguage(),
      write: async (language) => await durableLanguage.setLanguage({ lang: language }),
    },
    {
      apply: (language) => {
        i18nHelper.setLanguage(language);
        trayHelper.updateMenu();
      },
      broadcast: (snapshot) => {
        xpcMain.broadcast(APPLICATION_LANGUAGE_CHANGED_EVENT, snapshot);
        coinWindowManager.sendLanguageSnapshot(snapshot);
      },
    },
  );

  async initialize(): Promise<ApplicationLanguageSnapshot> {
    return await this.coordinator.initialize();
  }

  getCurrentLanguage(): ApplicationLanguageSnapshot {
    return this.coordinator.getSnapshot();
  }

  async setLanguage(language: AppLanguage): Promise<ApplicationLanguageSnapshot> {
    return await this.coordinator.setLanguage(language);
  }
}

export const applicationLanguageService = new ApplicationLanguageService();
