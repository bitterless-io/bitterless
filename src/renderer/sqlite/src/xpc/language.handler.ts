import { XpcRendererHandler } from 'electron-xpc/renderer';
import { languageDao } from './language.dao';

export class LanguageHandler extends XpcRendererHandler {
  async getLanguage(): Promise<string> {
    return languageDao.getLanguage();
  }

  async setLanguage(params: { lang: string }): Promise<void> {
    languageDao.setLanguage(params.lang);
  }
}

export const languageHandler = new LanguageHandler();
