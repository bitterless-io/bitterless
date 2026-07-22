import { XpcMainHandler } from 'electron-xpc/main';
import type {
  TranslatorApi,
  TranslatorCancelInput,
  TranslatorCancelReceipt,
  TranslatorTranslateInput,
  TranslatorTranslateResult
} from '@shared/translator/translator.contract';
import { translatorService } from '@main/translator/translator.runtime';

export class TranslatorHandler extends XpcMainHandler implements TranslatorApi {
  async translate(params: TranslatorTranslateInput): Promise<TranslatorTranslateResult> {
    return await translatorService.translate(params);
  }

  async cancel(params: TranslatorCancelInput): Promise<TranslatorCancelReceipt> {
    return await translatorService.cancel(params);
  }
}

export const translatorHandler = new TranslatorHandler();
