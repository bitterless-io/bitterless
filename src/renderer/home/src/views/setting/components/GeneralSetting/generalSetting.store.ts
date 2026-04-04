import { reactive } from 'vue';
import { switchLanguage } from '@renderer/common/i18n/i18n.helper';
import { createXpcRendererEmitter } from 'electron-xpc/renderer';
import type { LanguageHandler } from '@renderer/sqlite/src/xpc/language.handler';
import { xpcRenderer } from 'electron-xpc/renderer';
import { createXpcPreloadEmitter } from 'electron-xpc/renderer';
import type { SettingHandler } from '@renderer/sqlite/src/xpc/setting.handler';

const languageEmitter = createXpcRendererEmitter<LanguageHandler>('LanguageHandler');
const settingEmitter = createXpcPreloadEmitter<SettingHandler>('SettingHandler');

type SearchEngine = 'baidu' | 'duckduckgo';

class GeneralSettingState {
  currentLanguage: 'en' | 'zh' = 'en';
  currentSearchEngine: SearchEngine = 'baidu';
  loading = false;
  saveStatus: 'idle' | 'success' | 'failed' = 'idle';

  async loadSettings(): Promise<void> {
    const lang = await languageEmitter.getLanguage();
    this.currentLanguage = lang as 'en' | 'zh';
    switchLanguage(this.currentLanguage);

    const searchEngine = await settingEmitter.get({ key: 'general', sub_key: 'searchEngine' });
    this.currentSearchEngine = (searchEngine as SearchEngine) || 'baidu';
  }

  changeLanguage(lang: 'en' | 'zh'): void {
    this.currentLanguage = lang;
    switchLanguage(lang);
    this.persistLanguage(lang);
  }

  changeSearchEngine(engine: SearchEngine): void {
    this.currentSearchEngine = engine;
  }

  async saveSettings(): Promise<void> {
    this.loading = true;
    this.saveStatus = 'idle';
    try {
      await this.persistLanguage(this.currentLanguage);
      await settingEmitter.upsert({ key: 'general', sub_key: 'searchEngine', value: this.currentSearchEngine });
      this.saveStatus = 'success';
      setTimeout(() => {
        this.saveStatus = 'idle';
      }, 3000);
    } catch (err) {
      console.error('[GeneralSettingState] Failed to save settings:', err);
      this.saveStatus = 'failed';
      setTimeout(() => {
        this.saveStatus = 'idle';
      }, 3000);
    } finally {
      this.loading = false;
    }
  }

  private async persistLanguage(lang: 'en' | 'zh'): Promise<void> {
    try {
      await languageEmitter.setLanguage({ lang });
      xpcRenderer.broadcast('language/changed', { lang });
    } catch (err) {
      console.error('[GeneralSettingState] Failed to save language:', err);
      throw err;
    }
  }
}

export const generalSettingStore = reactive(new GeneralSettingState());

export const loadGeneralSetting = async (): Promise<void> => {
  await generalSettingStore.loadSettings();
};
