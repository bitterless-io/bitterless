import { reactive } from 'vue';
import { switchLanguage } from '@renderer/common/i18n/i18n.helper';
import { createXpcRendererEmitter } from 'electron-xpc/renderer';
import type { LanguageHandler } from '@preload/sqlite/handler/language.handler';
import type { SearchEngineHandler } from '@preload/sqlite/handler/searchEngine.handler';
import { xpcRenderer } from 'electron-xpc/renderer';

const languageEmitter = createXpcRendererEmitter<LanguageHandler>('LanguageHandler');
const searchEngineEmitter = createXpcRendererEmitter<SearchEngineHandler>('SearchEngineHandler');

type SearchEngine = 'baidu' | 'duckduckgo';

class GeneralSettingState {
  currentLanguage: 'en' | 'zh' = 'en';
  currentSearchEngine: SearchEngine = 'baidu';
  loading = false;

  async loadSettings(): Promise<void> {
    const lang = await languageEmitter.getLanguage();
    this.currentLanguage = lang as 'en' | 'zh';
    switchLanguage(this.currentLanguage);

    const searchEngine = await searchEngineEmitter.getSearchEngine();
    this.currentSearchEngine = (searchEngine as SearchEngine) || 'baidu';
  }

  changeLanguage(lang: 'en' | 'zh'): void {
    this.currentLanguage = lang;
    switchLanguage(lang);
    this.persistLanguage(lang);
  }

  changeSearchEngine(engine: SearchEngine): void {
    this.currentSearchEngine = engine;
    this.persistSearchEngine(engine);
  }

  private async persistSearchEngine(engine: SearchEngine): Promise<void> {
    this.loading = true;
    try {
      await searchEngineEmitter.setSearchEngine({ engine });
    } catch (err) {
      console.error('[GeneralSettingState] Failed to save search engine:', err);
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
