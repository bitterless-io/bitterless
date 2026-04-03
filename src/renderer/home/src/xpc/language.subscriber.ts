import { xpcRenderer } from 'electron-xpc/renderer';
import { switchLanguage } from '@renderer/common/i18n/i18n.helper';
import { languageSettingStore } from '@/views/setting/components/LanguageSetting/languageSetting.store';

xpcRenderer.subscribe('language/changed', (payload) => {
  const lang = payload.params.lang as 'en' | 'zh';
  languageSettingStore.currentLanguage = lang;
  switchLanguage(lang);
  console.log('[home language.subscriber] Language changed to:', lang);
});
