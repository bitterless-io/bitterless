import { getRuntimeProfile } from '@main/environment/runtimeProfile.runtime';
import { TranslatorLogService } from '@main/logging/translatorLog.service';
import { codexRuntimeService } from '@main/codex/codexRuntime.runtime';
import { modelProviderService } from '@main/modelProvider/modelProvider.runtime';
import { TranslatorService } from './translator.service';

const translatorLogger = new TranslatorLogService({
  getProfile: getRuntimeProfile
});

export const translatorService = new TranslatorService({
  runtime: codexRuntimeService,
  providers: modelProviderService,
  logger: translatorLogger
});
