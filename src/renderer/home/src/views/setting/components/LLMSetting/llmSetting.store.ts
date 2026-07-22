import { reactive } from 'vue';
import { createXpcRendererEmitter, xpcRenderer } from 'electron-xpc/renderer';
import {
  MODEL_PROVIDER_CODEX_ID,
  MODEL_PROVIDER_SNAPSHOT_CHANGED_EVENT,
  type ModelProviderApi,
  type ModelProviderAuthState,
  type ModelProviderRecord,
  type ModelProviderSnapshot
} from '@shared/modelProvider/modelProvider.contract';
import { parseModelProviderSnapshot } from '@shared/modelProvider/modelProvider.schema';

const modelProviderEmitter = createXpcRendererEmitter<ModelProviderApi>(
  'ModelProviderHandler'
) as ModelProviderApi;

export type LlmSettingError = 'load' | 'login' | 'logout';

class LlmSettingState {
  snapshot: ModelProviderSnapshot | null = null;
  loading = true;
  action: 'login' | 'logout' | null = null;
  error: LlmSettingError | null = null;
  private subscribed = false;
  private initializationPromise: Promise<void> | null = null;

  get provider(): ModelProviderRecord | null {
    return (
      this.snapshot?.providers.find((provider) => provider.provider === MODEL_PROVIDER_CODEX_ID) ??
      null
    );
  }

  get authState(): ModelProviderAuthState | null {
    return this.provider?.authState ?? null;
  }

  initialize(): Promise<void> {
    if (this.initializationPromise) return this.initializationPromise;
    this.initializationPromise = this.loadSnapshot().finally(() => {
      this.initializationPromise = null;
    });
    return this.initializationPromise;
  }

  async login(): Promise<void> {
    if (this.action || this.authState === 'authenticating') return;
    this.action = 'login';
    this.error = null;
    try {
      const result = await modelProviderEmitter.connect({
        provider: MODEL_PROVIDER_CODEX_ID,
        method: 'browser'
      });
      this.applySnapshot(parseModelProviderSnapshot(result.snapshot));
      if (!result.ok) this.error = 'login';
    } catch (error) {
      console.error('[model config] Codex login failed:', error);
      this.error = 'login';
    } finally {
      this.action = null;
    }
  }

  async logout(): Promise<void> {
    if (this.action) return;
    this.action = 'logout';
    this.error = null;
    try {
      const result = await modelProviderEmitter.disconnect({
        provider: MODEL_PROVIDER_CODEX_ID
      });
      this.applySnapshot(parseModelProviderSnapshot(result.snapshot));
      if (!result.ok) this.error = 'logout';
    } catch (error) {
      console.error('[model config] Codex logout failed:', error);
      this.error = 'logout';
    } finally {
      this.action = null;
    }
  }

  private async loadSnapshot(): Promise<void> {
    if (!this.subscribed) {
      this.subscribed = true;
      xpcRenderer.subscribe(MODEL_PROVIDER_SNAPSHOT_CHANGED_EVENT, (payload) => {
        this.applySnapshot(parseModelProviderSnapshot(payload.params));
      });
    }

    this.loading = true;
    this.error = null;
    try {
      this.applySnapshot(parseModelProviderSnapshot(await modelProviderEmitter.getSnapshot()));
    } catch (error) {
      console.error('[model config] provider snapshot failed:', error);
      this.error = 'load';
    } finally {
      this.loading = false;
    }
  }

  private applySnapshot(snapshot: ModelProviderSnapshot): void {
    if (this.snapshot && snapshot.observedAt < this.snapshot.observedAt) return;
    this.snapshot = snapshot;
    this.loading = false;
  }
}

export const llmSettingStore = reactive<LlmSettingState>(new LlmSettingState());
