import { reactive } from 'vue';
import { useThrottleFn } from '@vueuse/core';
import {
  MODEL_PROVIDER_CODEX_ID,
  type ModelProviderAuthState,
  type ModelProviderSnapshot
} from '@shared/modelProvider/modelProvider.contract';
import { parseModelProviderSnapshot } from '@shared/modelProvider/modelProvider.schema';
import {
  TRANSLATOR_MAX_SOURCE_LENGTH,
  TRANSLATOR_TARGET,
  type TranslatorErrorCode,
  type TranslatorTargetLanguage
} from '@shared/translator/translator.contract';
import { resolveTranslatorTargetLanguage } from '@shared/translator/translatorLanguage.service';
import {
  modelProviderEmitter,
  subscribeModelProviderSnapshots,
  translatorEmitter
} from '../emitter/translator.emitter';

export type TranslatorUiError = TranslatorErrorCode | 'load-provider' | 'login';

const RETRYABLE_TRANSLATION_ERRORS = new Set<TranslatorUiError>([
  'provider-error',
  'runtime-unavailable',
  'timeout',
  'invalid-output',
  'output-too-large'
]);

const isRetryableTranslationError = (error: TranslatorUiError | null): boolean =>
  Boolean(error && RETRYABLE_TRANSLATION_ERRORS.has(error));

class TranslatorState {
  readonly clientId = globalThis.crypto.randomUUID();
  readonly maxSourceLength = TRANSLATOR_MAX_SOURCE_LENGTH;
  sourceText = '';
  translation = '';
  providerSnapshot: ModelProviderSnapshot | null = null;
  providerLoading = true;
  providerAction = false;
  translating = false;
  error: TranslatorUiError | null = null;
  private activeRequestId: string | null = null;
  private lastSubmittedSource: string | null = null;
  private revision = 0;
  private requestSequence = 0;
  private subscribed = false;
  private scheduleTranslation: (() => void) | null = null;

  get authState(): ModelProviderAuthState | null {
    return (
      this.providerSnapshot?.providers.find(
        (provider) => provider.provider === MODEL_PROVIDER_CODEX_ID
      )?.authState ?? null
    );
  }

  get ready(): boolean {
    return (
      this.authState === 'ready' &&
      Boolean(
        this.providerSnapshot?.availableTargets.some(
          (target) =>
            target.provider === TRANSLATOR_TARGET.provider &&
            target.model === TRANSLATOR_TARGET.model &&
            target.effort === TRANSLATOR_TARGET.effort
        )
      )
    );
  }

  get targetLanguage(): TranslatorTargetLanguage {
    return resolveTranslatorTargetLanguage(this.sourceText);
  }

  get canRetryTranslation(): boolean {
    return (
      this.ready &&
      Boolean(this.sourceText.trim()) &&
      !this.translating &&
      isRetryableTranslationError(this.error)
    );
  }

  configureScheduler(scheduleTranslation: () => void): void {
    this.scheduleTranslation = scheduleTranslation;
  }

  async initialize(): Promise<void> {
    if (!this.subscribed) {
      this.subscribed = true;
      subscribeModelProviderSnapshots((snapshot) => {
        this.applyProviderSnapshot(snapshot);
      });
    }

    this.providerLoading = true;
    try {
      this.applyProviderSnapshot(
        parseModelProviderSnapshot(await modelProviderEmitter.getSnapshot())
      );
    } catch (error) {
      console.error('[translator] provider snapshot failed:', error);
      this.error = 'load-provider';
    } finally {
      this.providerLoading = false;
    }
  }

  setSourceText(value: string): void {
    const boundedValue = Array.from(value).slice(0, this.maxSourceLength).join('');
    if (boundedValue === this.sourceText) return;
    this.sourceText = boundedValue;
    this.revision += 1;
    this.error = null;

    if (!boundedValue.trim()) {
      this.translation = '';
      this.lastSubmittedSource = null;
      void this.cancelActiveRequest();
      return;
    }

    if (this.ready) this.scheduleTranslation?.();
  }

  async login(): Promise<void> {
    if (this.providerAction || this.authState === 'authenticating') return;
    this.providerAction = true;
    this.error = null;
    try {
      const result = await modelProviderEmitter.connect({
        provider: MODEL_PROVIDER_CODEX_ID,
        method: 'browser'
      });
      this.applyProviderSnapshot(parseModelProviderSnapshot(result.snapshot));
      if (!result.ok) this.error = 'login';
    } catch (error) {
      console.error('[translator] Codex login failed:', error);
      this.error = 'login';
    } finally {
      this.providerAction = false;
    }
  }

  async translateLatest(options: { force?: boolean } = {}): Promise<void> {
    const sourceText = this.sourceText;
    const sourceRevision = this.revision;
    if (!this.ready || !sourceText.trim()) return;
    if (!options.force && sourceText === this.lastSubmittedSource) return;

    const previousRequestId = this.activeRequestId;
    if (previousRequestId) {
      await translatorEmitter
        .cancel({
          clientId: this.clientId,
          requestId: previousRequestId
        })
        .catch(() => undefined);
      if (sourceRevision !== this.revision || sourceText !== this.sourceText) return;
    }

    const requestId = `${this.clientId}:${++this.requestSequence}`;
    this.activeRequestId = requestId;
    this.lastSubmittedSource = sourceText;
    this.translating = true;
    this.error = null;

    try {
      const result = await translatorEmitter.translate({
        clientId: this.clientId,
        requestId,
        sourceText
      });
      if (this.activeRequestId !== requestId || this.revision !== sourceRevision) return;
      if (result.status === 'completed') {
        this.translation = result.translation;
      } else if (result.status === 'error') {
        this.error = result.error.code;
      }
    } catch (error) {
      if (this.activeRequestId !== requestId || this.revision !== sourceRevision) return;
      console.error('[translator] translation request failed:', error);
      this.error = 'runtime-unavailable';
    } finally {
      if (this.activeRequestId === requestId) {
        this.activeRequestId = null;
        this.translating = false;
      }
    }
  }

  async retryTranslation(): Promise<void> {
    if (!this.canRetryTranslation) return;
    await this.translateLatest({ force: true });
  }

  private applyProviderSnapshot(snapshot: ModelProviderSnapshot): void {
    if (this.providerSnapshot && snapshot.observedAt < this.providerSnapshot.observedAt) return;

    const wasReady = this.ready;
    this.providerSnapshot = snapshot;
    this.providerLoading = false;

    if (wasReady && !this.ready) {
      void this.cancelActiveRequest();
    }
    if (!wasReady && this.ready && this.sourceText.trim()) {
      this.lastSubmittedSource = null;
      void this.translateLatest({ force: true });
    }
  }

  private async cancelActiveRequest(): Promise<void> {
    const requestId = this.activeRequestId;
    this.activeRequestId = null;
    this.translating = false;
    if (!requestId) return;
    await translatorEmitter
      .cancel({
        clientId: this.clientId,
        requestId
      })
      .catch(() => undefined);
  }
}

export const translatorStore = reactive<TranslatorState>(new TranslatorState());

translatorStore.configureScheduler(
  useThrottleFn(
    () => {
      void translatorStore.translateLatest();
    },
    1_000,
    // VueUse 14 uses positional booleans: trailing first, then leading.
    true,
    true
  )
);
