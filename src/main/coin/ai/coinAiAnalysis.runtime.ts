import { codexCredentialService } from '@main/codex/codexCredential.runtime';
import { codexRuntimeService } from '@main/codex/codexRuntime.runtime';
import { coinStateService } from '../data/coinData.runtime';
import { CoinAiAnalysisService } from './coinAiAnalysis.service';

export const coinAiAnalysisService = new CoinAiAnalysisService({
  runtime: codexRuntimeService,
  credentials: codexCredentialService,
  state: coinStateService,
});
