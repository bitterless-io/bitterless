import type { ModelProviderTarget } from '@shared/modelProvider/modelProvider.contract';
import {
  MODEL_PROVIDER_CODEX_EFFORT,
  MODEL_PROVIDER_CODEX_ID,
  MODEL_PROVIDER_CODEX_MODEL
} from '@shared/modelProvider/modelProvider.contract';

export const TRANSLATOR_PROVIDER = MODEL_PROVIDER_CODEX_ID;
export const TRANSLATOR_MODEL = MODEL_PROVIDER_CODEX_MODEL;
export const TRANSLATOR_EFFORT = MODEL_PROVIDER_CODEX_EFFORT;
export const TRANSLATOR_MAX_SOURCE_LENGTH = 12_000;
export const TRANSLATOR_MAX_TRANSLATION_LENGTH = 24_000;

export const TRANSLATOR_TARGET: ModelProviderTarget = {
  provider: TRANSLATOR_PROVIDER,
  model: TRANSLATOR_MODEL,
  effort: TRANSLATOR_EFFORT
};

export type TranslatorTargetLanguage = 'en' | 'zh-CN';

export interface TranslatorTranslateInput {
  clientId: string;
  requestId: string;
  sourceText: string;
}

export interface TranslatorCancelInput {
  clientId: string;
  requestId: string;
}

export type TranslatorErrorCode =
  | 'authenticating'
  | 'invalid-input'
  | 'invalid-output'
  | 'login-required'
  | 'output-too-large'
  | 'provider-error'
  | 'provider-unavailable'
  | 'runtime-unavailable'
  | 'target-mismatch'
  | 'timeout'
  | 'tool-violation';

export interface TranslatorError {
  code: TranslatorErrorCode;
  retryable: boolean;
}

export type TranslatorTranslateResult =
  | {
      status: 'completed';
      clientId: string;
      requestId: string;
      targetLanguage: TranslatorTargetLanguage;
      translation: string;
    }
  | {
      status: 'cancelled';
      clientId: string;
      requestId: string;
    }
  | {
      status: 'error';
      clientId: string;
      requestId: string;
      error: TranslatorError;
    };

export interface TranslatorCancelReceipt {
  clientId: string;
  requestId: string;
  cancelled: boolean;
}

export interface TranslatorApi {
  translate(params: TranslatorTranslateInput): Promise<TranslatorTranslateResult>;
  cancel(params: TranslatorCancelInput): Promise<TranslatorCancelReceipt>;
}
