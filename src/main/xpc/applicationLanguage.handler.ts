import { XpcMainHandler } from 'electron-xpc/main';
import {
  type ApplicationLanguageApi,
  type ApplicationLanguageSnapshot,
  type SetApplicationLanguageParams,
} from '@shared/i18n/applicationLanguage';
import { applicationLanguageService } from '../i18n/applicationLanguage.service';

export class ApplicationLanguageHandler extends XpcMainHandler implements ApplicationLanguageApi {
  async getCurrentLanguage(): Promise<ApplicationLanguageSnapshot> {
    return applicationLanguageService.getCurrentLanguage();
  }

  async setLanguage(
    params: SetApplicationLanguageParams,
  ): Promise<ApplicationLanguageSnapshot> {
    return await applicationLanguageService.setLanguage(params?.language);
  }
}

export const applicationLanguageHandler = new ApplicationLanguageHandler();
