import { en } from '../../renderer/common/i18n/en';
import { zh } from '../../renderer/common/i18n/zh';
import {
  ApplicationLanguageContractError,
  parseAppLanguage,
  type AppLanguage,
} from '@shared/i18n/applicationLanguage';

type MessageSchema = typeof en;

class I18nHelper {
  private currentLanguage: AppLanguage | null = null;
  private messages: Record<AppLanguage, MessageSchema> = { en, zh };

  setLanguage(value: unknown): void {
    const language = parseAppLanguage(value);
    this.currentLanguage = language;
    console.log('[I18nHelper] Language set to:', language);
  }

  getLanguage(): AppLanguage {
    if (!this.currentLanguage) {
      throw new ApplicationLanguageContractError(
        'APP_LANGUAGE_NOT_INITIALIZED',
        'Main-process i18n was accessed before application language initialization.',
      );
    }
    return this.currentLanguage;
  }

  getMessages(): MessageSchema {
    return this.messages[this.getLanguage()];
  }

  get app() {
    return this.getMessages().app;
  }
}

export const i18nHelper = new I18nHelper();
