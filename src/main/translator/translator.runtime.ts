import { codexRuntimeService } from '@main/codex/codexRuntime.runtime';
import { modelProviderService } from '@main/modelProvider/modelProvider.runtime';
import { TranslatorService } from './translator.service';

export const translatorService = new TranslatorService({
  runtime: codexRuntimeService,
  providers: modelProviderService
});
