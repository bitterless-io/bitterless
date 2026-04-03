import { en } from '../../renderer/common/i18n/en';
import { zh } from '../../renderer/common/i18n/zh';

type MessageSchema = typeof en;

class I18nHelper {
  private currentLanguage: 'en' | 'zh' = 'en';
  private messages: Record<'en' | 'zh', MessageSchema> = { en, zh };

  setLanguage(lang: 'en' | 'zh'): void {
    this.currentLanguage = lang;
    console.log('[I18nHelper] Language set to:', lang);
  }

  getLanguage(): 'en' | 'zh' {
    return this.currentLanguage;
  }

  getMessages(): MessageSchema {
    return this.messages[this.currentLanguage];
  }

  get app() {
    return this.getMessages().app;
  }
}

export const i18nHelper = new I18nHelper();
