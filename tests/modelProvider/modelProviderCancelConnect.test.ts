import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import {
  CodexCredentialError,
  type CodexCredentialStatus,
} from '../../src/main/codex/codexCredential.service';
import {
  ModelProviderService,
  type ModelProviderServiceDependencies,
} from '../../src/main/modelProvider/modelProvider.service';
import {
  MODEL_PROVIDER_CODEX_ID,
  MODEL_PROVIDER_CODEX_MODEL,
  type ModelProviderActionResult,
  type ModelProviderSnapshot,
} from '../../src/shared/modelProvider/modelProvider.contract';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const status = (connected = false): CodexCredentialStatus => ({
  provider: MODEL_PROVIDER_CODEX_ID,
  connected,
  loginInProgress: false,
  lastVerifiedAt: 1,
});

const createSettings = (): ModelProviderServiceDependencies['settings'] => {
  let stored: unknown | null = null;
  return {
    get: async () => stored,
    upsert: async ({ value }) => {
      stored = structuredClone(value);
      return MODEL_PROVIDER_CODEX_ID;
    },
  };
};

const createService = (options: {
  credentials: ModelProviderServiceDependencies['credentials'];
  broadcastSnapshot?: (snapshot: ModelProviderSnapshot) => void;
  settings?: ModelProviderServiceDependencies['settings'];
  cancelStageTimeoutMs?: number;
}): ModelProviderService => {
  let observedAt = 1_000;
  return new ModelProviderService({
    settings: options.settings ?? createSettings(),
    credentials: options.credentials,
    broadcastSnapshot: options.broadcastSnapshot ?? (() => undefined),
    broadcastDeviceCode: () => undefined,
    now: () => {
      observedAt += 1;
      return observedAt;
    },
    cancelStageTimeoutMs: options.cancelStageTimeoutMs,
  });
};

const authState = (result: ModelProviderActionResult): string =>
  result.snapshot.providers[0].authState;

test('keeps the shared Model Provider target fixed at GPT-5.5 low', async () => {
  const service = createService({
    credentials: {
      getStatus: async () => status(true),
      connect: async () => status(true),
      cancelConnect: async () => undefined,
      disconnect: async () => status(),
      subscribeTransitions: () => () => undefined,
    },
  });

  const snapshot = await service.getSnapshot();
  assert.equal(MODEL_PROVIDER_CODEX_MODEL, 'gpt-5.5');
  assert.deepEqual(snapshot.availableTargets, [
    {
      provider: MODEL_PROVIDER_CODEX_ID,
      model: 'gpt-5.5',
      effort: 'low',
    },
  ]);
  assert.deepEqual(snapshot.providers[0].configuredModels, ['gpt-5.5']);
});

test('cancel bypasses the mutation queue after authenticating commits but before credential connect', async () => {
  let connectCount = 0;
  let cancelCount = 0;
  let cancelResult: Promise<ModelProviderActionResult> | null = null;
  const cancelStarted = deferred<void>();
  const credentials: ModelProviderServiceDependencies['credentials'] = {
    getStatus: async () => status(),
    connect: async () => {
      connectCount += 1;
      return status(true);
    },
    cancelConnect: async () => {
      cancelCount += 1;
    },
    disconnect: async () => status(),
    subscribeTransitions: () => () => undefined,
  };
  const service = createService({
    credentials,
    broadcastSnapshot: (snapshot) => {
      if (snapshot.providers[0].authState !== 'authenticating' || cancelResult) return;
      cancelResult = service.cancelConnect({ provider: MODEL_PROVIDER_CODEX_ID });
      cancelStarted.resolve();
    },
  });
  await service.getSnapshot();

  const connectResult = service.connect({
    provider: MODEL_PROVIDER_CODEX_ID,
    method: 'browser',
  });
  await cancelStarted.promise;
  const [connected, cancelled] = await Promise.all([connectResult, cancelResult!]);

  assert.equal(connected.ok, false);
  if (connected.ok) assert.fail('The cancelled connect must fail with a cancelled result.');
  assert.equal(connected.error.code, 'cancelled');
  assert.equal(authState(connected), 'login_required');
  assert.equal(cancelled.ok, true);
  assert.equal((await service.getSnapshot()).providers[0].authState, 'login_required');
  assert.equal(cancelCount, 1);
  assert.equal(connectCount, 0);
});

test('cancel is immediate before provider initialization and a retry can replace it', async () => {
  const initializationStarted = deferred<void>();
  const releaseInitialization = deferred<void>();
  let stored: unknown | null = null;
  let connectCount = 0;
  let cancelCount = 0;
  const credentials: ModelProviderServiceDependencies['credentials'] = {
    getStatus: async () => status(),
    connect: async () => {
      connectCount += 1;
      return status(true);
    },
    cancelConnect: async () => {
      cancelCount += 1;
    },
    disconnect: async () => status(),
    subscribeTransitions: () => () => undefined,
  };
  const service = createService({
    credentials,
    settings: {
      get: async () => {
        initializationStarted.resolve();
        await releaseInitialization.promise;
        return stored;
      },
      upsert: async ({ value }) => {
        stored = structuredClone(value);
        return MODEL_PROVIDER_CODEX_ID;
      },
    },
  });

  const firstConnect = service.connect({
    provider: MODEL_PROVIDER_CODEX_ID,
    method: 'browser',
  });
  await initializationStarted.promise;
  const cancelResult = await service.cancelConnect({ provider: MODEL_PROVIDER_CODEX_ID });
  assert.equal(cancelResult.ok, true);

  const retry = service.connect({
    provider: MODEL_PROVIDER_CODEX_ID,
    method: 'browser',
  });
  releaseInitialization.resolve();
  const [firstResult, retryResult] = await Promise.all([firstConnect, retry]);

  assert.equal(firstResult.ok, false);
  if (firstResult.ok) assert.fail('The pre-initialization connect must remain cancelled.');
  assert.equal(firstResult.error.code, 'cancelled');
  assert.equal(retryResult.ok, true);
  assert.equal(authState(retryResult), 'ready');
  assert.equal(cancelCount, 1);
  assert.equal(connectCount, 1);
});

test('cancel waits for the active mutation and a second login succeeds immediately', async () => {
  const firstCredential = deferred<CodexCredentialStatus>();
  const firstCredentialStarted = deferred<void>();
  let connectCount = 0;
  let connected = false;
  const credentials: ModelProviderServiceDependencies['credentials'] = {
    getStatus: async () => status(connected),
    connect: async () => {
      connectCount += 1;
      if (connectCount === 1) {
        firstCredentialStarted.resolve();
        return await firstCredential.promise;
      }
      connected = true;
      return status(true);
    },
    cancelConnect: async () => {
      firstCredential.reject(
        new CodexCredentialError('cancelled', 'Codex sign-in was cancelled.'),
      );
    },
    disconnect: async () => {
      connected = false;
      return status();
    },
    subscribeTransitions: () => () => undefined,
  };
  const service = createService({ credentials });
  await service.getSnapshot();

  const firstConnect = service.connect({
    provider: MODEL_PROVIDER_CODEX_ID,
    method: 'browser',
  });
  await firstCredentialStarted.promise;
  const cancellation = service.cancelConnect({ provider: MODEL_PROVIDER_CODEX_ID });
  const [firstResult, cancelResult] = await Promise.all([firstConnect, cancellation]);

  assert.equal(firstResult.ok, false);
  if (firstResult.ok) assert.fail('The first connect must report cancellation.');
  assert.equal(firstResult.error.code, 'cancelled');
  assert.equal(authState(cancelResult), 'login_required');

  const secondResult = await service.connect({
    provider: MODEL_PROVIDER_CODEX_ID,
    method: 'browser',
  });
  assert.equal(secondResult.ok, true);
  assert.equal(authState(secondResult), 'ready');
  assert.equal(connectCount, 2);
});

test('cancel disconnects a credential that resolves before ready can be committed', async () => {
  const credentialStarted = deferred<void>();
  const credentialResult = deferred<CodexCredentialStatus>();
  let connected = false;
  let disconnectCount = 0;
  const credentials: ModelProviderServiceDependencies['credentials'] = {
    getStatus: async () => status(connected),
    connect: async () => {
      credentialStarted.resolve();
      return await credentialResult.promise;
    },
    cancelConnect: async () => undefined,
    disconnect: async () => {
      disconnectCount += 1;
      connected = false;
      return status();
    },
    subscribeTransitions: () => () => undefined,
  };
  const service = createService({ credentials });
  await service.getSnapshot();

  const connection = service.connect({
    provider: MODEL_PROVIDER_CODEX_ID,
    method: 'browser',
  });
  await credentialStarted.promise;
  connected = true;
  credentialResult.resolve(status(true));
  const cancellation = service.cancelConnect({ provider: MODEL_PROVIDER_CODEX_ID });
  const [connectResult, cancelResult] = await Promise.all([connection, cancellation]);

  assert.equal(connectResult.ok, false);
  if (connectResult.ok) assert.fail('The tail-race connect must report cancellation.');
  assert.equal(connectResult.error.code, 'cancelled');
  assert.equal(cancelResult.ok, true);
  assert.equal(authState(cancelResult), 'login_required');
  assert.equal(disconnectCount, 1);
  assert.equal(connected, false);
});

test('a replacement renderer waits for cancelled credential cleanup without stale state overwrite', async () => {
  const firstCredential = deferred<CodexCredentialStatus>();
  const firstCredentialStarted = deferred<void>();
  const authStates: string[] = [];
  let connectCount = 0;
  let connected = false;
  let disconnectCount = 0;
  const credentials: ModelProviderServiceDependencies['credentials'] = {
    getStatus: async () => status(connected),
    connect: async () => {
      connectCount += 1;
      if (connectCount === 1) {
        firstCredentialStarted.resolve();
        return await firstCredential.promise;
      }
      connected = true;
      return status(true);
    },
    cancelConnect: async () => undefined,
    disconnect: async () => {
      disconnectCount += 1;
      connected = false;
      return status();
    },
    subscribeTransitions: () => () => undefined,
  };
  const service = createService({
    credentials,
    broadcastSnapshot: (snapshot) => {
      authStates.push(snapshot.providers[0].authState);
    },
  });
  await service.getSnapshot();

  const firstConnect = service.connect({
    provider: MODEL_PROVIDER_CODEX_ID,
    method: 'browser',
  });
  await firstCredentialStarted.promise;
  const cancellation = service.cancelConnect({ provider: MODEL_PROVIDER_CODEX_ID });
  const replacement = service.connect({
    provider: MODEL_PROVIDER_CODEX_ID,
    method: 'browser',
  });
  connected = true;
  firstCredential.resolve(status(true));

  const [firstResult, cancelResult, replacementResult] = await Promise.all([
    firstConnect,
    cancellation,
    replacement,
  ]);

  assert.equal(firstResult.ok, false);
  if (firstResult.ok) assert.fail('The replaced connect must remain cancelled.');
  assert.equal(firstResult.error.code, 'cancelled');
  assert.equal(cancelResult.ok, true);
  assert.equal(replacementResult.ok, true);
  assert.equal(authState(replacementResult), 'ready');
  assert.equal(disconnectCount, 1);
  assert.equal(connectCount, 2);
  const firstAuthenticating = authStates.indexOf('authenticating');
  assert.equal(authStates.slice(firstAuthenticating).includes('login_required'), false);
});

test('credential cleanup failure stays unavailable until an explicit replacement login succeeds', async () => {
  const firstCredential = deferred<CodexCredentialStatus>();
  const firstCredentialStarted = deferred<void>();
  let connectCount = 0;
  let connected = false;
  const credentials: ModelProviderServiceDependencies['credentials'] = {
    getStatus: async () => status(connected),
    connect: async () => {
      connectCount += 1;
      if (connectCount === 1) {
        firstCredentialStarted.resolve();
        return await firstCredential.promise;
      }
      if (connectCount === 2) return status(false);
      connected = true;
      return status(true);
    },
    cancelConnect: async () => undefined,
    disconnect: async () => {
      throw new Error('credential cleanup failed');
    },
    subscribeTransitions: () => () => undefined,
  };
  const service = createService({ credentials });
  await service.getSnapshot();

  const firstConnect = service.connect({
    provider: MODEL_PROVIDER_CODEX_ID,
    method: 'browser',
  });
  await firstCredentialStarted.promise;
  const cancellation = service.cancelConnect({ provider: MODEL_PROVIDER_CODEX_ID });
  connected = true;
  firstCredential.resolve(status(true));
  const [firstResult, cancelResult] = await Promise.all([firstConnect, cancellation]);

  assert.equal(firstResult.ok, false);
  if (firstResult.ok) assert.fail('Cleanup failure must be observable.');
  assert.equal(firstResult.error.code, 'status-unavailable');
  assert.equal(cancelResult.ok, false);
  if (cancelResult.ok) assert.fail('Cancel must not report success after cleanup failure.');
  assert.equal(cancelResult.error.code, 'status-unavailable');
  assert.equal(authState(cancelResult), 'unavailable');
  assert.equal(
    (await service.refreshCredentialState()).providers[0].authState,
    'unavailable',
  );

  const failedReplacement = await service.connect({
    provider: MODEL_PROVIDER_CODEX_ID,
    method: 'browser',
  });
  assert.equal(failedReplacement.ok, false);
  assert.equal(authState(failedReplacement), 'unavailable');
  assert.equal((await service.getSnapshot()).providers[0].authState, 'unavailable');

  const replacementResult = await service.connect({
    provider: MODEL_PROVIDER_CODEX_ID,
    method: 'browser',
  });
  assert.equal(replacementResult.ok, true);
  assert.equal(authState(replacementResult), 'ready');
});

test('cancel settles when credential status never resolves and stays fail-closed', async () => {
  const connectEntered = deferred<void>();
  const releaseConnect = deferred<CodexCredentialStatus>();
  releaseConnect.promise.catch(() => undefined);
  let statusCalls = 0;
  const service = createService({
    cancelStageTimeoutMs: 25,
    credentials: {
      getStatus: async () => {
        statusCalls += 1;
        // Production `getStatus()` loads the Pi module and creates a model runtime with no abort
        // signal. The first call is provider initialization; the cancel cleanup reads it again and
        // that read must not be able to hold the cancel open.
        if (statusCalls === 1) return status();
        return await new Promise<CodexCredentialStatus>(() => undefined);
      },
      connect: async () => {
        connectEntered.resolve();
        return await releaseConnect.promise;
      },
      cancelConnect: async () => {
        releaseConnect.reject(new CodexCredentialError('cancelled', 'Cancelled.'));
      },
      disconnect: async () => status(),
      subscribeTransitions: () => () => undefined,
    },
  });
  await service.getSnapshot();

  void service
    .connect({ provider: MODEL_PROVIDER_CODEX_ID, method: 'browser' })
    .catch(() => undefined);
  await connectEntered.promise;
  const cancelled = await service.cancelConnect({ provider: MODEL_PROVIDER_CODEX_ID });

  assert.equal(cancelled.ok, false);
  if (cancelled.ok) assert.fail('An unverifiable credential state must not report a clean cancel.');
  assert.equal(cancelled.error.code, 'status-unavailable');
  assert.equal(authState(cancelled), 'unavailable');
  assert.equal((await service.getSnapshot()).providers[0].authState, 'unavailable');
});

test('cancel settles when the connect attempt never unwinds', async () => {
  const connectEntered = deferred<void>();
  const service = createService({
    cancelStageTimeoutMs: 25,
    credentials: {
      getStatus: async () => status(),
      // An uncooperative login that ignores its abort keeps `attempt.settled` pending forever, and
      // the wedged connect still owns the mutation queue.
      connect: async () => {
        connectEntered.resolve();
        return await new Promise<CodexCredentialStatus>(() => undefined);
      },
      cancelConnect: async () => undefined,
      disconnect: async () => status(),
      subscribeTransitions: () => () => undefined,
    },
  });
  await service.getSnapshot();

  void service
    .connect({ provider: MODEL_PROVIDER_CODEX_ID, method: 'browser' })
    .catch(() => undefined);
  await connectEntered.promise;
  const started = Date.now();
  const cancelled = await service.cancelConnect({ provider: MODEL_PROVIDER_CODEX_ID });

  assert.ok(Date.now() - started < 2_000, 'cancel must not wait on the wedged connect');
  assert.equal(cancelled.ok, false);
  if (cancelled.ok) assert.fail('A wedged connect must not report a clean cancel.');
  assert.equal(cancelled.error.code, 'status-unavailable');
  assert.equal(authState(cancelled), 'unavailable');

  // The provider stays non-ready, so Setting offers Login again instead of a stuck spinner.
  assert.equal((await service.getSnapshot()).providers[0].authState, 'unavailable');
});

test('the cancel path is instrumented at every stage that can stall', () => {
  const source = readFileSync(resolve('src/main/modelProvider/modelProvider.service.ts'), 'utf8');
  const credentialSource = readFileSync(
    resolve('src/main/codex/codexCredential.service.ts'),
    'utf8',
  );

  for (const stage of [
    'requested',
    'credential-aborted',
    'attempt-settle-timeout',
    'attempt-settled',
    'credential-status-started',
    'credential-status-resolved',
    'credential-disconnect-started',
    'credential-cleanup-failed',
    'completed',
  ]) {
    assert.match(
      source,
      new RegExp(`logCancelStage\\(\\s*'${stage}'`),
      `Missing cancel stage log: ${stage}`,
    );
  }
  assert.match(source, /const CANCEL_STAGE_TIMEOUT_MS = 5_000;/);
  assert.match(source, /cancelStageTimeoutMs \?\? CANCEL_STAGE_TIMEOUT_MS/);

  for (const stage of [
    'cancel-capture-closing',
    'cancel-capture-closed',
    'cancel-promotion-reverting',
    'cleanup-capture-closing',
    'cleanup-authorization-awaiting',
    'cleanup-authorization-settled',
    'cleanup-promotion-reverting',
  ]) {
    assert.ok(credentialSource.includes(stage), `Missing credential cleanup log: ${stage}`);
  }
});

test('Settings renders localized Cancel and ignores superseded connect results', () => {
  const read = (path: string): string => readFileSync(resolve(path), 'utf8');
  const store = read(
    'src/renderer/home/src/views/setting/components/LLMSetting/llmSetting.store.ts',
  );
  const view = read(
    'src/renderer/home/src/views/setting/components/LLMSetting/LLMSetting.vue',
  );
  const english = read('src/renderer/common/i18n/en.ts');
  const chinese = read('src/renderer/common/i18n/zh.ts');
  const styles = read(
    'src/renderer/home/src/views/setting/components/LLMSetting/LLMSetting.less',
  );

  assert.match(store, /modelProviderEmitter\.cancelConnect\(/);
  assert.match(store, /this\.action === 'login'[\s\S]*?this\.action === 'reconnect'/);
  assert.match(store, /if \(actionVersion !== this\.actionVersion\) return;/);
  assert.match(store, /result\.error\.code !== 'cancelled'/);
  assert.match(
    view,
    /authState === 'authenticating'[\s\S]*?action === 'login'[\s\S]*?action === 'reconnect'[\s\S]*?action === 'cancel'[\s\S]*?IconX[\s\S]*?setting\.llm\.cancel/,
  );
  assert.match(styles, /\.model-config__auth-actions[\s\S]*?display: flex;[\s\S]*?gap:/);
  assert.match(english, /cancel: 'Cancel'/);
  assert.match(chinese, /cancel: '取消'/);
});
