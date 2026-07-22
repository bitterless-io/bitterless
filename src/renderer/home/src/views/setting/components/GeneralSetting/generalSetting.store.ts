import { reactive } from 'vue';
import { Message } from '@arco-design/web-vue';
import { createXpcRendererEmitter } from 'electron-xpc/renderer';
import router from '@/router';
import { settingEmitter } from '@/emitter/setting.emitter';
import { authStore } from '@/stores/auth/auth.store';
import type { SearchEngineHandler } from '@preload/sqlite/handler/searchEngine.handler';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';
import {
  getCurrentRendererLanguage,
  onRendererLanguageApplied,
  requestApplicationLanguageChange,
} from '@renderer/common/i18n/rendererLanguage';
import type { AppLanguage } from '@shared/i18n/applicationLanguage';

const searchEngineEmitter = createXpcRendererEmitter<SearchEngineHandler>('SearchEngineHandler');

type SearchEngine = 'baidu' | 'duckduckgo';

const GENERAL_SETTING_KEY = 'general';
const SHOW_CHAT_MENU_SUB_KEY = 'showChatMenu';
const DEFAULT_SHOW_CHAT_MENU = import.meta.env.VITE_ENV === 'dev';

class GeneralSettingState {
  currentLanguage: AppLanguage = 'en';
  currentSearchEngine: SearchEngine = 'baidu';
  showChatMenu = DEFAULT_SHOW_CHAT_MENU;
  chatMenuLoading = false;
  chatMenuSaving = false;
  loading = false;
  loggingOut = false;
  private chatMenuLoaded = false;
  private chatMenuLoadPromise: Promise<void> | null = null;

  get accountEmail(): string {
    return authStore.current?.email || '';
  }

  async loadSettings(): Promise<void> {
    this.currentLanguage = getCurrentRendererLanguage();

    const [searchEngine] = await Promise.all([
      searchEngineEmitter.getSearchEngine(),
      this.loadChatMenuVisibility(),
    ]);
    this.currentSearchEngine = (searchEngine as SearchEngine) || 'baidu';
  }

  async loadChatMenuVisibility(): Promise<void> {
    if (this.chatMenuLoaded) return;
    if (this.chatMenuLoadPromise) return this.chatMenuLoadPromise;

    this.chatMenuLoading = true;
    this.chatMenuLoadPromise = (async () => {
      try {
        const value = await settingEmitter.get<unknown>({
          key: GENERAL_SETTING_KEY,
          sub_key: SHOW_CHAT_MENU_SUB_KEY,
        });
        if (typeof value === 'boolean') this.showChatMenu = value;
      } catch (err) {
        console.error('[GeneralSettingState] Failed to load Chat menu visibility:', err);
      } finally {
        this.chatMenuLoaded = true;
        this.chatMenuLoading = false;
        this.chatMenuLoadPromise = null;
      }
    })();

    return this.chatMenuLoadPromise;
  }

  async changeChatMenuVisibility(showChatMenu: boolean): Promise<void> {
    if (this.chatMenuSaving || showChatMenu === this.showChatMenu) return;

    const previousValue = this.showChatMenu;
    this.showChatMenu = showChatMenu;
    this.chatMenuSaving = true;
    try {
      await settingEmitter.upsert({
        key: GENERAL_SETTING_KEY,
        sub_key: SHOW_CHAT_MENU_SUB_KEY,
        value: showChatMenu,
      });
    } catch (err) {
      this.showChatMenu = previousValue;
      Message.error(i18nHelper.setting.general.experimental.showChatMenuSaveFailed);
      console.error('[GeneralSettingState] Failed to save Chat menu visibility:', err);
    } finally {
      this.chatMenuSaving = false;
    }
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

export const loadChatMenuVisibility = async (): Promise<void> => {
  await generalSettingStore.loadChatMenuVisibility();
};
