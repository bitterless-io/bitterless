import { reactive } from 'vue';
import { switchLanguage } from '@renderer/common/i18n/i18n.helper';
import { createXpcRendererEmitter } from 'electron-xpc/renderer';
import type { LanguageHandler } from '@renderer/sqlite/src/xpc/language.handler';
import { xpcRenderer } from 'electron-xpc/renderer';

const languageEmitter = createXpcRendererEmitter<LanguageHandler>('LanguageHandler');

class LanguageSettingState {
  currentLanguage: 'en' | 'zh' = 'en';
  loading = false;

  async loadLanguage(): Promise<void> {
    const lang = await languageEmitter.getLanguage();
    this.currentLanguage = lang as 'en' | 'zh';
    switchLanguage(this.currentLanguage);
  }

  changeLanguage(lang: 'en' | 'zh'): void {
    this.currentLanguage = lang;
    switchLanguage(lang);
    this.persistLanguage(lang);
  }

  private async persistLanguage(lang: 'en' | 'zh'): Promise<void> {
    this.loading = true;
    try {
      await languageEmitter.setLanguage({ lang });
      xpcRenderer.broadcast('language/changed', { lang });
    } catch (err) {
      console.error('[LanguageSettingState] Failed to save language:', err);
    } finally {
      this.loading = false;
    }
  }
}

export const languageSettingStore = reactive(new LanguageSettingState());

export const loadLanguageSetting = async (): Promise<void> => {
  await languageSettingStore.loadLanguage();
};
