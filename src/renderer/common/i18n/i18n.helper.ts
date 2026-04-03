import { createI18n } from 'vue-i18n';
import { reactive } from 'vue';
import { en } from './en';
import { zh } from './zh';

type MessageSchema = typeof en;

const detectLocale = (): 'en' | 'zh' => {
  const stored = localStorage.getItem('lang');
  if (stored === 'en' || stored === 'zh') {
    return stored;
  }
  
  const lang = navigator.language ?? 'en';
  const detected = lang.startsWith('zh') ? 'zh' : 'en';
  localStorage.setItem('lang', detected);
  return detected;
};

const localeMap: Record<string, MessageSchema> = { en, zh };

export const i18nMessages: MessageSchema = reactive({ ...(localeMap[detectLocale()] ?? en) }) as MessageSchema;

export const i18nHelper: MessageSchema = i18nMessages;

export const i18n = createI18n<[MessageSchema], 'en' | 'zh'>({
  legacy: false,
  locale: detectLocale(),
  fallbackLocale: 'en',
  messages: {
    en,
    zh,
  },
});

export const switchLanguage = (lang: 'en' | 'zh'): void => {
  localStorage.setItem('lang', lang);
  i18n.global.locale.value = lang;
  
  const newMessages = localeMap[lang];
  for (const key of Object.keys(newMessages)) {
    (i18nMessages as any)[key] = (newMessages as any)[key];
  }
};
