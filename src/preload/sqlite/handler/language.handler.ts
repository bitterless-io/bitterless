import { XpcPreloadHandler } from 'electron-xpc/preload';
import { languageDao } from '../dao/language.dao';

export class LanguageHandler extends XpcPreloadHandler {
  async getLanguage(): Promise<string> {
    return languageDao.getLanguage();
  }

  async setLanguage(params: { lang: string }): Promise<void> {
    languageDao.setLanguage(params.lang);
  }
}

export const languageHandler = new LanguageHandler();
