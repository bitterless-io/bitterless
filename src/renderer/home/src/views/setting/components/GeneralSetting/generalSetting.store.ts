import { reactive } from 'vue';
import { createXpcRendererEmitter } from 'electron-xpc/renderer';
import router from '@/router';
import { authStore } from '@/stores/auth/auth.store';
import type { SearchEngineHandler } from '@preload/sqlite/handler/searchEngine.handler';
import {
  getCurrentRendererLanguage,
  onRendererLanguageApplied,
  requestApplicationLanguageChange,
} from '@renderer/common/i18n/rendererLanguage';
import type { AppLanguage } from '@shared/i18n/applicationLanguage';

const searchEngineEmitter = createXpcRendererEmitter<SearchEngineHandler>('SearchEngineHandler');

type SearchEngine = 'baidu' | 'duckduckgo';

class GeneralSettingState {
  currentLanguage: AppLanguage = 'en';
  currentSearchEngine: SearchEngine = 'baidu';
  loading = false;
  loggingOut = false;

  get accountEmail(): string {
    return authStore.current?.email || '';
  }

  async loadSettings(): Promise<void> {
    this.currentLanguage = getCurrentRendererLanguage();

    const searchEngine = await searchEngineEmitter.getSearchEngine();
    this.currentSearchEngine = (searchEngine as SearchEngine) || 'baidu';
  }

  async changeLanguage(language: AppLanguage): Promise<void> {
    const previousLanguage = getCurrentRendererLanguage();
    this.loading = true;
    try {
      await requestApplicationLanguageChange(language);
    } catch (err) {
      this.currentLanguage = previousLanguage;
      console.error('[GeneralSettingState] Failed to save language:', err);
    } finally {
      this.loading = false;
    }
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

  async logout(): Promise<void> {
    if (this.loggingOut) return;

    this.loggingOut = true;
    const cleanupPromise = authStore.logout();
    try {
      await router.replace({ name: 'login' });
    } catch (err) {
      console.error('[GeneralSettingState] Failed to navigate after logout:', err);
    }
    try {
      await cleanupPromise;
    } catch (err) {
      console.error('[GeneralSettingState] Failed to clean up after logout:', err);
    } finally {
      this.loggingOut = false;
    }
  }

}

export const generalSettingStore = reactive(new GeneralSettingState());

onRendererLanguageApplied((language) => {
  generalSettingStore.currentLanguage = language;
});

export const loadGeneralSetting = async (): Promise<void> => {
  await generalSettingStore.loadSettings();
};
