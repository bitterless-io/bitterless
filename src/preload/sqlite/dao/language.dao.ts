export class LanguageDao {
  getLanguage(): string {
    const lang = localStorage.getItem('lang');
    if (lang) {
      return lang;
    }
    
    const systemLang = navigator.language || 'en';
    const detectedLang = systemLang.startsWith('zh') ? 'zh' : 'en';
    localStorage.setItem('lang', detectedLang);
    return detectedLang;
  }

  setLanguage(lang: string): void {
    localStorage.setItem('lang', lang);
  }
}

export const languageDao = new LanguageDao();
