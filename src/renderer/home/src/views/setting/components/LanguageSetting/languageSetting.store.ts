import { reactive } from 'vue';
import {
  getCurrentRendererLanguage,
  onRendererLanguageApplied,
  requestApplicationLanguageChange,
} from '@renderer/common/i18n/rendererLanguage';
import type { AppLanguage } from '@shared/i18n/applicationLanguage';

class LanguageSettingState {
  currentLanguage: AppLanguage = 'en';
  loading = false;

  async loadLanguage(): Promise<void> {
    this.currentLanguage = getCurrentRendererLanguage();
  }

  async changeLanguage(language: AppLanguage): Promise<void> {
    const previousLanguage = getCurrentRendererLanguage();
    this.loading = true;
    try {
      await requestApplicationLanguageChange(language);
    } catch (err) {
      this.currentLanguage = previousLanguage;
      console.error('[LanguageSettingState] Failed to save language:', err);
    } finally {
      this.loading = false;
    }
  }
}

export const languageSettingStore = reactive(new LanguageSettingState());

onRendererLanguageApplied((language) => {
  languageSettingStore.currentLanguage = language;
});

export const loadLanguageSetting = async (): Promise<void> => {
  await languageSettingStore.loadLanguage();
};
