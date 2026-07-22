import type {
  ModelProviderActionError,
  ModelProviderActionErrorCode,
  ModelProviderActionResult,
  ModelProviderConnectInput,
  ModelProviderDeviceCodeNotice,
  ModelProviderInvalidationReason,
  ModelProviderRecord,
  ModelProviderSnapshot
} from '@shared/modelProvider/modelProvider.contract';
import {
  MODEL_PROVIDER_CODEX_EFFORT,
  MODEL_PROVIDER_CODEX_ID,
  MODEL_PROVIDER_CODEX_MODEL,
  MODEL_PROVIDER_RECORD_SCHEMA_VERSION,
  MODEL_PROVIDER_SETTING_KEY,
  MODEL_PROVIDER_SNAPSHOT_SCHEMA
} from '@shared/modelProvider/modelProvider.contract';
import {
  parseModelProviderConnectInput,
  parseModelProviderDisconnectInput,
  parseModelProviderRecord,
  parseModelProviderSnapshot
} from '@shared/modelProvider/modelProvider.schema';
import {
  CodexCredentialError,
  type CodexConnectObserver,
  type CodexCredentialService,
  type CodexCredentialStatus,
  type CodexCredentialTransition
} from '@main/codex/codexCredential.service';

export interface ModelProviderSettingStore {
  get(params: { key: string; sub_key?: string }): Promise<unknown | null>;
  upsert(params: { key: string; sub_key?: string; value: unknown }): Promise<string>;
}

export interface ModelProviderServiceDependencies {
  settings: ModelProviderSettingStore;
  credentials: Pick<
    CodexCredentialService,
    'getStatus' | 'connect' | 'disconnect' | 'subscribeTransitions'
  >;
  broadcastSnapshot(snapshot: ModelProviderSnapshot): void;
  broadcastDeviceCode(notice: ModelProviderDeviceCodeNotice | null): void;
  watchCredentialChanges?(listener: () => void): () => void;
  now?: () => number;
}

export class ModelProviderServiceError extends Error {
  constructor(readonly code: 'persistence-unavailable' | 'status-unavailable') {
    super(code);
    this.name = 'ModelProviderServiceError';
  }
}

const fixedTarget = () => ({
  provider: MODEL_PROVIDER_CODEX_ID,
  model: MODEL_PROVIDER_CODEX_MODEL,
  effort: MODEL_PROVIDER_CODEX_EFFORT
});

const createRecord = (
  authState: ModelProviderRecord['authState'],
  observedAt: number,
  options: {
    invalidationReason?: ModelProviderInvalidationReason | null;
    lastSuccessfulRuntimeAt?: number | null;
  } = {}
): ModelProviderRecord =>
  parseModelProviderRecord({
    schemaVersion: MODEL_PROVIDER_RECORD_SCHEMA_VERSION,
    provider: MODEL_PROVIDER_CODEX_ID,
    configuredModels: [MODEL_PROVIDER_CODEX_MODEL],
    defaultTarget: fixedTarget(),
    authState,
    invalidationReason: options.invalidationReason ?? null,
    lastObservedAt: observedAt,
    lastSuccessfulRuntimeAt: options.lastSuccessfulRuntimeAt ?? null
  });

const actionError = (code: ModelProviderActionErrorCode): ModelProviderActionError => ({
  code,
  retryable: !['invalid-input', 'login-in-progress'].includes(code)
});

const mapCredentialError = (
  error: unknown,
  fallback: 'login-failed' | 'logout-failed'
): ModelProviderActionErrorCode => {
  if (!(error instanceof CodexCredentialError)) return fallback;
  const supported: ModelProviderActionErrorCode[] = [
    'login-failed',
    'login-in-progress',
    'logout-failed',
    'status-unavailable',
    'timeout'
  ];
  return supported.includes(error.code) ? error.code : fallback;
};

const statusAuthState = (status: CodexCredentialStatus): ModelProviderRecord['authState'] => {
  if (status.errorCode) return 'unavailable';
  if (status.loginInProgress) return 'authenticating';
  return status.connected ? 'ready' : 'login_required';
};

export class ModelProviderService {
  private readonly now: () => number;
  private record: ModelProviderRecord | null = null;
  private initializePromise: Promise<void> | null = null;
  private mutationTail: Promise<void> = Promise.resolve();
  private stopCredentialWatcher: (() => void) | null = null;
  private credentialOperation: 'connect' | 'disconnect' | null = null;
  private suppressCredentialWatchUntil = 0;

  constructor(private readonly dependencies: ModelProviderServiceDependencies) {
    this.now = dependencies.now ?? Date.now;
    dependencies.credentials.subscribeTransitions((transition) => {
      this.suppressCredentialWatchUntil = this.now() + 2_000;
      if (this.credentialOperation) return;
      void this.handleCredentialTransition(transition).catch(() => undefined);
    });
  }

  async getSnapshot(): Promise<ModelProviderSnapshot> {
    await this.ensureInitialized();
    return this.snapshot();
  }

  async connect(value: unknown): Promise<ModelProviderActionResult> {
    let input: ModelProviderConnectInput;
    try {
      input = parseModelProviderConnectInput(value);
    } catch {
      await this.ensureInitialized();
      return { ok: false, snapshot: this.snapshot(), error: actionError('invalid-input') };
    }

    await this.ensureInitialized();
    return await this.mutate(async () => {
      const previous = this.requiredRecord();
      if (previous.authState === 'ready') {
        return { ok: true, snapshot: this.snapshot() };
      }

      try {
        await this.commit(
          createRecord('authenticating', this.now(), {
            lastSuccessfulRuntimeAt: previous.lastSuccessfulRuntimeAt
          })
        );
      } catch {
        return {
          ok: false,
          snapshot: this.snapshot(),
          error: actionError('persistence-unavailable')
        };
      }

      const observer: CodexConnectObserver = {
        onDeviceCode: (notice) => {
          this.dependencies.broadcastDeviceCode({
            provider: input.provider,
            userCode: notice.userCode,
            verificationHost: notice.verificationHost,
            expiresAt: notice.expiresAt
          });
        }
      };

      try {
        this.credentialOperation = 'connect';
        const status = await this.dependencies.credentials.connect({
          method: input.method,
          ...observer
        });
        if (!status.connected) {
          throw new CodexCredentialError('login-failed', 'Codex sign-in did not complete.');
        }
        await this.commit(
          createRecord('ready', this.now(), {
            lastSuccessfulRuntimeAt: previous.lastSuccessfulRuntimeAt
          })
        );
        return { ok: true, snapshot: this.snapshot() };
      } catch (error) {
        const errorCode = mapCredentialError(error, 'login-failed');
        const next = previous.invalidationReason
          ? createRecord('invalidated', this.now(), {
              invalidationReason: previous.invalidationReason,
              lastSuccessfulRuntimeAt: previous.lastSuccessfulRuntimeAt
            })
          : createRecord('login_required', this.now(), {
              lastSuccessfulRuntimeAt: previous.lastSuccessfulRuntimeAt
            });
        try {
          await this.commit(next);
        } catch {
          return {
            ok: false,
            snapshot: this.snapshot(),
            error: actionError('persistence-unavailable')
          };
        }
        return { ok: false, snapshot: this.snapshot(), error: actionError(errorCode) };
      } finally {
        this.credentialOperation = null;
        this.dependencies.broadcastDeviceCode(null);
      }
    });
  }

  async disconnect(value: unknown): Promise<ModelProviderActionResult> {
    try {
      parseModelProviderDisconnectInput(value);
    } catch {
      await this.ensureInitialized();
      return { ok: false, snapshot: this.snapshot(), error: actionError('invalid-input') };
    }

    await this.ensureInitialized();
    return await this.mutate(async () => {
      const previous = this.requiredRecord();
      try {
        this.credentialOperation = 'disconnect';
        const status = await this.dependencies.credentials.disconnect();
        if (status.connected) {
          throw new CodexCredentialError('logout-failed', 'Codex remained connected.');
        }
        const next = previous.invalidationReason
          ? createRecord('invalidated', this.now(), {
              invalidationReason: previous.invalidationReason,
              lastSuccessfulRuntimeAt: previous.lastSuccessfulRuntimeAt
            })
          : createRecord('login_required', this.now(), {
              lastSuccessfulRuntimeAt: previous.lastSuccessfulRuntimeAt
            });
        await this.commit(next);
        return { ok: true, snapshot: this.snapshot() };
      } catch (error) {
        const code =
          error instanceof ModelProviderServiceError
            ? error.code
            : mapCredentialError(error, 'logout-failed');
        return { ok: false, snapshot: this.snapshot(), error: actionError(code) };
      } finally {
        this.credentialOperation = null;
      }
    });
  }

  async noteRuntimeAuthRequired(
    reason: ModelProviderInvalidationReason
  ): Promise<ModelProviderSnapshot> {
    await this.ensureInitialized();
    return await this.mutate(async () => {
      const previous = this.requiredRecord();
      await this.commit(
        createRecord('invalidated', this.now(), {
          invalidationReason: reason,
          lastSuccessfulRuntimeAt: previous.lastSuccessfulRuntimeAt
        })
      );
      return this.snapshot();
    });
  }

  async noteRuntimeSuccess(): Promise<ModelProviderSnapshot> {
    await this.ensureInitialized();
    return await this.mutate(async () => {
      const observedAt = this.now();
      await this.commit(
        createRecord('ready', observedAt, {
          lastSuccessfulRuntimeAt: observedAt
        })
      );
      return this.snapshot();
    });
  }

  async refreshCredentialState(): Promise<ModelProviderSnapshot> {
    await this.ensureInitialized();
    return await this.mutate(async () => {
      await this.reconcileCredentialStatus();
      return this.snapshot();
    });
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initializePromise) {
      this.initializePromise = this.initialize().catch((error) => {
        this.initializePromise = null;
        throw error;
      });
    }
    await this.initializePromise;
  }

  private async initialize(): Promise<void> {
    const observedAt = this.now();
    let stored: unknown | null;
    try {
      stored = await this.dependencies.settings.get({
        key: MODEL_PROVIDER_SETTING_KEY,
        sub_key: MODEL_PROVIDER_CODEX_ID
      });
    } catch {
      this.record = createRecord('unavailable', observedAt);
      this.dependencies.broadcastSnapshot(this.snapshot());
      this.startCredentialWatcher();
      return;
    }

    let persisted: ModelProviderRecord | null = null;
    if (stored !== null) {
      try {
        persisted = parseModelProviderRecord(stored);
      } catch {
        persisted = null;
      }
    }

    let status: CodexCredentialStatus;
    try {
      status = await this.dependencies.credentials.getStatus();
    } catch {
      status = {
        provider: MODEL_PROVIDER_CODEX_ID,
        connected: false,
        loginInProgress: false,
        lastVerifiedAt: observedAt,
        errorCode: 'status-unavailable'
      };
    }

    let next: ModelProviderRecord;
    if (persisted?.authState === 'invalidated') {
      next = createRecord('invalidated', observedAt, {
        invalidationReason: persisted.invalidationReason,
        lastSuccessfulRuntimeAt: persisted.lastSuccessfulRuntimeAt
      });
    } else if (persisted?.authState === 'authenticating') {
      next = createRecord('login_required', observedAt, {
        lastSuccessfulRuntimeAt: persisted.lastSuccessfulRuntimeAt
      });
    } else {
      next = createRecord(statusAuthState(status), observedAt, {
        lastSuccessfulRuntimeAt: persisted?.lastSuccessfulRuntimeAt ?? null
      });
    }
    this.record = next;
    try {
      await this.persist(next);
    } catch {
      this.record =
        persisted?.authState === 'invalidated'
          ? next
          : createRecord('unavailable', observedAt, {
              lastSuccessfulRuntimeAt: persisted?.lastSuccessfulRuntimeAt ?? null
            });
    }
    this.dependencies.broadcastSnapshot(this.snapshot());
    this.startCredentialWatcher();
  }

  private startCredentialWatcher(): void {
    if (this.stopCredentialWatcher || !this.dependencies.watchCredentialChanges) return;
    this.stopCredentialWatcher = this.dependencies.watchCredentialChanges(() => {
      if (this.now() < this.suppressCredentialWatchUntil) return;
      void this.refreshCredentialState().catch(() => undefined);
    });
  }

  private async reconcileCredentialStatus(): Promise<void> {
    const previous = this.requiredRecord();

    let status: CodexCredentialStatus;
    try {
      status = await this.dependencies.credentials.getStatus();
    } catch {
      status = {
        provider: MODEL_PROVIDER_CODEX_ID,
        connected: false,
        loginInProgress: false,
        lastVerifiedAt: this.now(),
        errorCode: 'status-unavailable'
      };
    }

    const observedAt = this.now();
    const next =
      previous.authState === 'invalidated'
        ? createRecord('invalidated', observedAt, {
            invalidationReason: previous.invalidationReason,
            lastSuccessfulRuntimeAt: previous.lastSuccessfulRuntimeAt
          })
        : createRecord(statusAuthState(status), observedAt, {
            lastSuccessfulRuntimeAt: previous.lastSuccessfulRuntimeAt
          });
    await this.commit(next);
  }

  private async handleCredentialTransition(
    transition: CodexCredentialTransition
  ): Promise<ModelProviderSnapshot> {
    await this.ensureInitialized();
    return await this.mutate(async () => {
      const previous = this.requiredRecord();
      const next =
        transition.kind === 'login-succeeded'
          ? createRecord('ready', transition.observedAt, {
              lastSuccessfulRuntimeAt: previous.lastSuccessfulRuntimeAt
            })
          : previous.invalidationReason
            ? createRecord('invalidated', transition.observedAt, {
                invalidationReason: previous.invalidationReason,
                lastSuccessfulRuntimeAt: previous.lastSuccessfulRuntimeAt
              })
            : createRecord('login_required', transition.observedAt, {
                lastSuccessfulRuntimeAt: previous.lastSuccessfulRuntimeAt
              });
      await this.commit(next);
      return this.snapshot();
    });
  }

  private async commit(record: ModelProviderRecord): Promise<void> {
    const next = parseModelProviderRecord(record);
    this.record = next;
    try {
      await this.persist(next);
    } catch {
      this.dependencies.broadcastSnapshot(this.snapshot());
      throw new ModelProviderServiceError('persistence-unavailable');
    }
    this.dependencies.broadcastSnapshot(this.snapshot());
  }

  private async persist(record: ModelProviderRecord): Promise<void> {
    await this.dependencies.settings.upsert({
      key: MODEL_PROVIDER_SETTING_KEY,
      sub_key: MODEL_PROVIDER_CODEX_ID,
      value: record
    });
  }

  private snapshot(): ModelProviderSnapshot {
    const record = this.requiredRecord();
    return parseModelProviderSnapshot({
      schema: MODEL_PROVIDER_SNAPSHOT_SCHEMA,
      observedAt: this.now(),
      providers: [{ ...record, configuredModels: [...record.configuredModels] }],
      availableTargets: record.authState === 'ready' ? [fixedTarget()] : []
    });
  }

  private requiredRecord(): ModelProviderRecord {
    if (!this.record) {
      this.record = createRecord('unavailable', this.now());
    }
    return this.record;
  }

  private async mutate<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationTail.then(operation, operation);
    this.mutationTail = result.then(
      () => undefined,
      () => undefined
    );
    return await result;
  }
}
