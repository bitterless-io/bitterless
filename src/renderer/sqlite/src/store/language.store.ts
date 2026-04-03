import { reactive } from 'vue';
import { createXpcRendererEmitter } from 'electron-xpc/renderer';
import type { LanguageHandler } from '@renderer/sqlite/src/xpc/language.handler';

const languageEmitter = createXpcRendererEmitter<LanguageHandler>('LanguageHandler');

class LanguageStore {
  currentLanguage: 'en' | 'zh' = 'en';

  async init(): Promise<void> {
    const lang = await languageEmitter.getLanguage();
    this.currentLanguage = lang as 'en' | 'zh';
  }

  async setLanguage(lang: 'en' | 'zh'): Promise<void> {
    await languageEmitter.setLanguage({ lang });
    this.currentLanguage = lang;
  }
}

export const languageStore = reactive(new LanguageStore());
