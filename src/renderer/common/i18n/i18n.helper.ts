import { createI18n } from 'vue-i18n';
import { reactive } from 'vue';
import { en } from './en';
import { zh } from './zh';
import {
  ApplicationLanguageContractError,
  parseAppLanguage,
  type AppLanguage,
} from '@shared/i18n/applicationLanguage';

type MessageSchema = typeof en;

const localeMap: Record<AppLanguage, MessageSchema> = { en, zh };
let appliedLanguage: AppLanguage | null = null;

// Vue i18n requires a construction locale. No renderer mounts with this placeholder: every
// first-party entry awaits initializeRendererLanguage(), which applies main's snapshot first.
export const i18nMessages: MessageSchema = reactive({ ...en }) as MessageSchema;

export const i18nHelper: MessageSchema = i18nMessages;

export const i18n = createI18n<[MessageSchema], AppLanguage>({
  legacy: false,
  locale: 'en',
  fallbackLocale: false,
  messages: {
    en,
    zh,
  },
});

export const applyRendererLanguage = (value: unknown): AppLanguage => {
  const language = parseAppLanguage(value);
  (i18n.global.locale as unknown as { value: AppLanguage }).value = language;

  const newMessages = localeMap[language];
  for (const key of Object.keys(newMessages)) {
    (i18nMessages as any)[key] = (newMessages as any)[key];
  }
  document.documentElement.lang = language;
  appliedLanguage = language;
  return language;
};

export const getAppliedRendererLanguage = (): AppLanguage => {
  if (!appliedLanguage) {
    throw new ApplicationLanguageContractError(
      'APP_LANGUAGE_NOT_INITIALIZED',
      'Renderer language was accessed before initialization.',
    );
  }
  return appliedLanguage;
};
