import { xpcRenderer } from 'electron-xpc/renderer';
import { switchLanguage } from '@renderer/common/i18n/i18n.helper';

xpcRenderer.subscribe('language/changed', (payload) => {
  const lang = payload.params.lang as 'en' | 'zh';
  switchLanguage(lang);
  console.log('[todo language.subscriber] Language changed to:', lang);
});
