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

export interface ModelProviderRuntimeContext {
  snapshot: ModelProviderSnapshot;
  epoch: number;
}

export interface ModelProviderRuntimeObservation {
  applied: boolean;
  snapshot: ModelProviderSnapshot;
  epoch: number;
}

const PERSISTENCE_RETRY_DELAY_MS = 50;
const DIRTY_RETRY_DELAYS_MS = [250, 1_000, 5_000, 15_000, 60_000] as const;
type CredentialStateLock = 'persistence-unavailable' | 'record-invalid';

const waitForPersistenceRetry = async (): Promise<void> =>
  await new Promise((resolve) => setTimeout(resolve, PERSISTENCE_RETRY_DELAY_MS));

const unrefTimer = (timer: ReturnType<typeof setTimeout>): void => {
  const candidate = timer as ReturnType<typeof setTimeout> & { unref?: () => void };
  candidate.unref?.();
};

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
  private epoch = 0;
  private lastSnapshotObservedAt = -1;
  private initializePromise: Promise<void> | null = null;
  private mutationTail: Promise<void> = Promise.resolve();
  private stopCredentialWatcher: (() => void) | null = null;
  private credentialOperation: 'connect' | 'disconnect' | null = null;
  private credentialStateLock: CredentialStateLock | null = null;
  private suppressCredentialWatchUntil = 0;
  private suppressedCredentialReconcileTimer: ReturnType<typeof setTimeout> | null = null;
  private initializationRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private dirtyRecord: ModelProviderRecord | null = null;
  private dirtyRetryAttempt = 0;
  private dirtyRetryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly dependencies: ModelProviderServiceDependencies) {
    this.now = dependencies.now ?? Date.now;
    dependencies.credentials.subscribeTransitions((transition) => {
      this.suppressCredentialWatchUntil = this.now() + 2_000;
      this.scheduleSuppressedCredentialReconcile();
      if (this.credentialOperation) return;
      void this.handleCredentialTransition(transition).catch(() => undefined);
    });
  }

  async getSnapshot(): Promise<ModelProviderSnapshot> {
    await this.ensureInitialized();
    return this.snapshot();
  }

  async getRuntimeContext(): Promise<ModelProviderRuntimeContext> {
    await this.ensureInitialized();
    return { snapshot: this.snapshot(), epoch: this.epoch };
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

      if (this.credentialStateLock === 'persistence-unavailable') {
        return {
          ok: false,
          snapshot: this.snapshot(),
          error: actionError('persistence-unavailable')
        };
      }

      if (this.credentialStateLock !== 'record-invalid') {
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

      let credentialConnected = false;
      try {
        this.credentialOperation = 'connect';
        const status = await this.dependencies.credentials.connect({
          method: input.method,
          ...observer
        });
        if (!status.connected) {
          throw new CodexCredentialError('login-failed', 'Codex sign-in did not complete.');
        }
        credentialConnected = true;
        this.credentialStateLock = null;
        await this.commit(
          createRecord('ready', this.now(), {
            lastSuccessfulRuntimeAt: previous.lastSuccessfulRuntimeAt
          })
        );
        return { ok: true, snapshot: this.snapshot() };
      } catch (error) {
        if (credentialConnected && error instanceof ModelProviderServiceError) {
          return {
            ok: false,
            snapshot: this.snapshot(),
            error: actionError('persistence-unavailable')
          };
        }
        const errorCode = mapCredentialError(error, 'login-failed');
        if (this.credentialStateLock) {
          return { ok: false, snapshot: this.snapshot(), error: actionError(errorCode) };
        }
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
      if (this.credentialStateLock === 'persistence-unavailable') {
        return {
          ok: false,
          snapshot: this.snapshot(),
          error: actionError('persistence-unavailable')
        };
      }
      try {
        this.credentialOperation = 'disconnect';
        const status = await this.dependencies.credentials.disconnect();
        if (status.connected) {
          throw new CodexCredentialError('logout-failed', 'Codex remained connected.');
        }
        this.credentialStateLock = null;
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
    reason: ModelProviderInvalidationReason,
    expectedEpoch: number
  ): Promise<ModelProviderRuntimeObservation> {
    await this.ensureInitialized();
    return await this.mutate(async () => {
      if (expectedEpoch !== this.epoch) return this.runtimeObservation(false);
      const previous = this.requiredRecord();
      this.credentialStateLock = null;
      await this.commit(
        createRecord('invalidated', this.now(), {
          invalidationReason: reason,
          lastSuccessfulRuntimeAt: previous.lastSuccessfulRuntimeAt
        })
      );
      return this.runtimeObservation(true);
    });
  }

  async noteRuntimeSuccess(expectedEpoch: number): Promise<ModelProviderRuntimeObservation> {
    await this.ensureInitialized();
    return await this.mutate(async () => {
      if (expectedEpoch !== this.epoch) return this.runtimeObservation(false);
      const previous = this.requiredRecord();
      const observedAt = this.now();
      this.credentialStateLock = null;
      await this.commit(
        createRecord('ready', observedAt, {
          lastSuccessfulRuntimeAt: Math.max(previous.lastSuccessfulRuntimeAt ?? 0, observedAt)
        }),
        { advanceEpoch: previous.authState !== 'ready' }
      );
      return this.runtimeObservation(true);
    });
  }

  async refreshCredentialState(forceCredentialEpoch = true): Promise<ModelProviderSnapshot> {
    await this.ensureInitialized();
    return await this.mutate(async () => {
      await this.reconcileCredentialStatus(forceCredentialEpoch);
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
      this.credentialStateLock = 'persistence-unavailable';
      this.applyInMemory(createRecord('unavailable', observedAt), true);
      this.dependencies.broadcastSnapshot(this.snapshot());
      this.startCredentialWatcher();
      this.scheduleInitializationRetry();
      return;
    }

    let persisted: ModelProviderRecord | null = null;
    let persistedRecordInvalid = false;
    if (stored !== null) {
      try {
        persisted = parseModelProviderRecord(stored);
      } catch {
        persistedRecordInvalid = true;
      }
    }

    if (persistedRecordInvalid) {
      this.credentialStateLock = 'record-invalid';
      this.applyInMemory(createRecord('unavailable', observedAt), true);
      this.dependencies.broadcastSnapshot(this.snapshot());
      this.startCredentialWatcher();
      return;
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
      this.credentialStateLock = null;
      next = createRecord('invalidated', observedAt, {
        invalidationReason: persisted.invalidationReason,
        lastSuccessfulRuntimeAt: persisted.lastSuccessfulRuntimeAt
      });
    } else if (persisted?.authState === 'authenticating') {
      this.credentialStateLock = null;
      next = createRecord('login_required', observedAt, {
        lastSuccessfulRuntimeAt: persisted.lastSuccessfulRuntimeAt
      });
    } else {
      this.credentialStateLock = null;
      next = createRecord(statusAuthState(status), observedAt, {
        lastSuccessfulRuntimeAt: persisted?.lastSuccessfulRuntimeAt ?? null
      });
    }
    try {
      await this.commit(next);
    } catch {
      // commit already installed and broadcast its fail-closed fallback.
      this.scheduleSuppressedCredentialReconcile();
    }
    this.startCredentialWatcher();
  }

  private startCredentialWatcher(): void {
    if (this.stopCredentialWatcher || !this.dependencies.watchCredentialChanges) return;
    this.stopCredentialWatcher = this.dependencies.watchCredentialChanges(() => {
      if (this.now() < this.suppressCredentialWatchUntil) {
        this.scheduleSuppressedCredentialReconcile();
        return;
      }
      void this.refreshCredentialState(false).catch(() => undefined);
    });
  }

  private async reconcileCredentialStatus(forceCredentialEpoch: boolean): Promise<void> {
    const previous = this.requiredRecord();
    if (this.credentialStateLock) return;

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
    const authStateChanged =
      next.authState !== previous.authState ||
      next.invalidationReason !== previous.invalidationReason;
    if (!forceCredentialEpoch && !authStateChanged) return;
    await this.commit(next, { advanceEpoch: forceCredentialEpoch || authStateChanged });
  }

  private scheduleSuppressedCredentialReconcile(): void {
    if (this.suppressedCredentialReconcileTimer) {
      clearTimeout(this.suppressedCredentialReconcileTimer);
    }
    const delay = Math.max(0, this.suppressCredentialWatchUntil - this.now()) + 25;
    this.suppressedCredentialReconcileTimer = setTimeout(() => {
      this.suppressedCredentialReconcileTimer = null;
      void this.refreshCredentialState(false).catch(() => undefined);
    }, delay);
    unrefTimer(this.suppressedCredentialReconcileTimer);
  }

  private async handleCredentialTransition(
    transition: CodexCredentialTransition
  ): Promise<ModelProviderSnapshot> {
    await this.ensureInitialized();
    return await this.mutate(async () => {
      const previous = this.requiredRecord();
      this.credentialStateLock = null;
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

  private async commit(
    record: ModelProviderRecord,
    options: { advanceEpoch?: boolean } = {}
  ): Promise<void> {
    const next = parseModelProviderRecord(record);
    try {
      await this.persist(next);
    } catch {
      const fallback =
        next.authState === 'invalidated' || next.authState === 'unavailable'
          ? next
          : createRecord('unavailable', this.now(), {
              lastSuccessfulRuntimeAt: next.lastSuccessfulRuntimeAt
            });
      this.applyInMemory(fallback, true);
      this.dependencies.broadcastSnapshot(this.snapshot());

      let fallbackPersisted = false;
      try {
        await waitForPersistenceRetry();
        await this.persist(fallback);
        fallbackPersisted = true;
        this.clearDirtyPersistence();
      } catch {
        this.markDirtyPersistence(fallback);
      }

      const requestedStateApplied =
        fallback.authState === next.authState &&
        fallback.invalidationReason === next.invalidationReason;
      if (fallbackPersisted && fallback.authState === 'unavailable' && !this.credentialStateLock) {
        this.scheduleSuppressedCredentialReconcile();
      }
      if (fallbackPersisted && requestedStateApplied) return;
      throw new ModelProviderServiceError('persistence-unavailable');
    }
    this.applyInMemory(next, options.advanceEpoch ?? true);
    this.clearDirtyPersistence();
    this.dependencies.broadcastSnapshot(this.snapshot());
  }

  private async persist(record: ModelProviderRecord): Promise<void> {
    await this.dependencies.settings.upsert({
      key: MODEL_PROVIDER_SETTING_KEY,
      sub_key: MODEL_PROVIDER_CODEX_ID,
      value: record
    });
  }

  private applyInMemory(record: ModelProviderRecord, advanceEpoch: boolean): void {
    this.record = record;
    if (advanceEpoch) this.epoch += 1;
  }

  private markDirtyPersistence(record: ModelProviderRecord): void {
    this.dirtyRecord = record;
    this.dirtyRetryAttempt = 0;
    this.scheduleDirtyPersistenceRetry();
  }

  private clearDirtyPersistence(): void {
    this.dirtyRecord = null;
    this.dirtyRetryAttempt = 0;
    if (this.dirtyRetryTimer) clearTimeout(this.dirtyRetryTimer);
    this.dirtyRetryTimer = null;
  }

  private scheduleDirtyPersistenceRetry(): void {
    if (!this.dirtyRecord || this.dirtyRetryTimer) return;
    const delay =
      DIRTY_RETRY_DELAYS_MS[Math.min(this.dirtyRetryAttempt, DIRTY_RETRY_DELAYS_MS.length - 1)];
    this.dirtyRetryAttempt += 1;
    this.dirtyRetryTimer = setTimeout(() => {
      this.dirtyRetryTimer = null;
      void this.retryDirtyPersistence().catch(() => undefined);
    }, delay);
    unrefTimer(this.dirtyRetryTimer);
  }

  private async retryDirtyPersistence(): Promise<void> {
    await this.ensureInitialized();
    await this.mutate(async () => {
      const dirty = this.dirtyRecord;
      if (!dirty) return;
      try {
        await this.persist(dirty);
      } catch {
        this.scheduleDirtyPersistenceRetry();
        return;
      }
      if (this.dirtyRecord === dirty) {
        this.clearDirtyPersistence();
        if (dirty.authState === 'unavailable' && !this.credentialStateLock) {
          this.scheduleSuppressedCredentialReconcile();
        }
      }
    });
  }

  private scheduleInitializationRetry(): void {
    if (this.initializationRetryTimer) return;
    this.initializationRetryTimer = setTimeout(() => {
      this.initializationRetryTimer = null;
      void this.mutate(async () => {
        this.initializePromise = null;
        await this.ensureInitialized();
      }).catch(() => undefined);
    }, 1_000);
    unrefTimer(this.initializationRetryTimer);
  }

  private runtimeObservation(applied: boolean): ModelProviderRuntimeObservation {
    return { applied, snapshot: this.snapshot(), epoch: this.epoch };
  }

  private snapshot(): ModelProviderSnapshot {
    const record = this.requiredRecord();
    const observedAt = Math.max(this.now(), this.lastSnapshotObservedAt + 1);
    this.lastSnapshotObservedAt = observedAt;
    return parseModelProviderSnapshot({
      schema: MODEL_PROVIDER_SNAPSHOT_SCHEMA,
      observedAt,
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
