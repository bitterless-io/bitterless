import assert from 'node:assert/strict';
import { SUB2API_CLIENT_EFFORTS } from '../../src/shared/claudeSubscription/claudeSubscription.contract';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  CLAUDE_SUBSCRIPTION_DEFAULT_PORT,
  buildClaudeSubscriptionCodexProfile,
  parseClaudeSubscriptionSnapshot,
  type ClaudeSubscriptionActionResult,
  type ClaudeSubscriptionCopyResult,
  type ClaudeSubscriptionSnapshot
} from '../../src/shared/claudeSubscription';
import {
  ClaudeAccountRepository,
  type ClaudeAccountExecutionContext,
  type ClaudeAccountIdentity
} from '../../src/main/claudeSubscription/claudeAccount.repository';
import { ClaudeAccountRouter } from '../../src/main/claudeSubscription/claudeAccount.router';
import type {
  ClaudeAuthBrowserFactory,
  ClaudeAuthBrowserSession
} from '../../src/main/claudeSubscription/claudeAuth.browser';
import {
  ClaudeLogoutError,
  type ClaudeAccountAuthCli
} from '../../src/main/claudeSubscription/claudeAuth.command';
import { ClaudeAuthorizationCoordinator } from '../../src/main/claudeSubscription/claudeAuth.coordinator';
import type {
  ClaudeExecutionRequest,
  ClaudeExecutionResult,
  ClaudeExecutor
} from '../../src/main/claudeSubscription/claudeCli.executor';
import type {
  ClaudeAuthLoginPty,
  ClaudeAuthLoginPtyExit,
  ClaudeAuthLoginPtyFactory,
  ClaudeAuthLoginPtySpawnOptions
} from '../../src/main/claudeSubscription/claudeAuthLogin.pty';
import {
  ClaudeAuthenticationError,
  ClaudeNoEligibleAccountError,
  ClaudeRequestAbortedError
} from '../../src/main/claudeSubscription/claudeSubscription.errors';
import {
  ClaudeSubscriptionService,
  type ClaudeSubscriptionServerLifecycle
} from '../../src/main/claudeSubscription/claudeSubscription.service';

const ACCOUNT_ID = '00000000-0000-4000-8000-000000000061';
const SECOND_ACCOUNT_ID = '00000000-0000-4000-8000-000000000062';
const NEW_ACCOUNT_ID = '00000000-0000-4000-8000-000000000063';
const FLOW_ID = '00000000-0000-4000-8000-000000000071';

interface Deferred {
  promise: Promise<void>;
  resolve(): void;
}

const createDeferred = (): Deferred => {
  let resolve!: () => void;
  return {
    promise: new Promise<void>((resolvePromise) => {
      resolve = resolvePromise;
    }),
    resolve: () => resolve()
  };
};

const nextTurn = async (): Promise<void> => {
  await new Promise<void>((resolve) => setImmediate(resolve));
};

const waitUntil = async (predicate: () => boolean, message: string): Promise<void> => {
  const deadline = Date.now() + 2_000;
  while (!predicate() && Date.now() < deadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(predicate(), true, message);
};

const assertRuntimeUnavailable = (
  result: ClaudeSubscriptionActionResult | ClaudeSubscriptionCopyResult
): void => {
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, 'runtime_unavailable');
};

class ServiceFakePty implements ClaudeAuthLoginPty {
  readonly #dataListeners = new Set<(data: Buffer) => void>();
  readonly #exitListeners = new Set<(result: ClaudeAuthLoginPtyExit) => void>();
  killed = false;

  writeLine(): void {
    return;
  }

  async kill(): Promise<void> {
    this.killed = true;
  }

  onData(listener: (data: Buffer) => void): () => void {
    this.#dataListeners.add(listener);
    return () => this.#dataListeners.delete(listener);
  }

  onExit(listener: (result: ClaudeAuthLoginPtyExit) => void): () => void {
    this.#exitListeners.add(listener);
    return () => this.#exitListeners.delete(listener);
  }

  exit(result: ClaudeAuthLoginPtyExit): void {
    for (const listener of this.#exitListeners) listener(result);
  }
}

class ServiceFakePtyFactory implements ClaudeAuthLoginPtyFactory {
  readonly ptys: ServiceFakePty[] = [];
  readonly spawnOptions: ClaudeAuthLoginPtySpawnOptions[] = [];

  spawn(options: ClaudeAuthLoginPtySpawnOptions): ClaudeAuthLoginPty {
    this.spawnOptions.push(options);
    const pty = new ServiceFakePty();
    this.ptys.push(pty);
    return pty;
  }
}

class ServiceFakeBrowser implements ClaudeAuthBrowserFactory {
  readonly cleared: string[] = [];
  readonly events: string[];
  clearGate: Deferred | null = null;
  clearError: Error | null = null;
  onClear: ((partition: string) => Promise<void> | void) | null = null;

  constructor(events: string[]) {
    this.events = events;
  }

  open(): ClaudeAuthBrowserSession {
    return { close: () => undefined };
  }

  async clear(partition: string): Promise<void> {
    this.events.push('clear');
    await this.onClear?.(partition);
    await this.clearGate?.promise;
    if (this.clearError) throw this.clearError;
    this.cleared.push(partition);
  }
}

class ServiceFakeAuthCli implements ClaudeAccountAuthCli {
  readonly verifyCalls: ClaudeAccountExecutionContext[] = [];
  readonly logoutCalls: ClaudeAccountExecutionContext[] = [];
  readonly events: string[];
  verifyError: Error | null = null;
  logoutError: Error | null = null;
  logoutGate: Deferred | null = null;

  constructor(events: string[]) {
    this.events = events;
  }

  async verify(context: ClaudeAccountExecutionContext) {
    this.verifyCalls.push(context);
    if (this.verifyError) throw this.verifyError;
    return {
      loggedIn: true as const,
      authMethod: 'claude.ai' as const,
      apiProvider: 'firstParty' as const,
      subscriptionType: 'max' as const,
      email: 'personal@example.test'
    };
  }

  async logout(context: ClaudeAccountExecutionContext): Promise<void> {
    this.events.push('logout');
    this.logoutCalls.push(context);
    await this.logoutGate?.promise;
    if (this.logoutError) throw this.logoutError;
  }
}

class ServiceFakeExecutor implements ClaudeExecutor {
  readonly calls: ClaudeExecutionRequest[] = [];
  error: Error | null = null;
  deferred = false;
  started = false;
  aborted = false;
  #resolve: (() => void) | null = null;

  async execute(
    request: ClaudeExecutionRequest,
    options: { signal?: AbortSignal } = {}
  ): Promise<ClaudeExecutionResult> {
    this.calls.push(request);
    this.started = true;
    if (this.error) throw this.error;
    if (this.deferred) {
      await new Promise<void>((resolve, reject) => {
        this.#resolve = resolve;
        const abort = (): void => {
          this.aborted = true;
          reject(new ClaudeRequestAbortedError());
        };
        options.signal?.addEventListener('abort', abort, { once: true });
        if (options.signal?.aborted) abort();
      });
    }
    return {
      decision: { action: 'final', text: 'ready' },
      rawUsage: {}
    };
  }

  resolve(): void {
    this.#resolve?.();
    this.#resolve = null;
  }
}

class ServiceFakeServer implements ClaudeSubscriptionServerLifecycle {
  listenCalls = 0;
  closeCalls = 0;

  async listen(): Promise<void> {
    this.listenCalls += 1;
  }

  async close(): Promise<void> {
    this.closeCalls += 1;
  }
}

interface AuthorizationCallCounts {
  start: number;
  submit: number;
  cancel: number;
}

interface ServiceFixture {
  rootDirectory: string;
  repository: ClaudeAccountRepository;
  router: ClaudeAccountRouter;
  identity: ClaudeAccountIdentity;
  ptyFactory: ServiceFakePtyFactory;
  browser: ServiceFakeBrowser;
  authCli: ServiceFakeAuthCli;
  executor: ServiceFakeExecutor;
  server: ServiceFakeServer;
  authorization: ClaudeAuthorizationCoordinator;
  authorizationCalls: AuthorizationCallCounts;
  broadcasts: ClaudeSubscriptionSnapshot[];
  clipboardWrites: string[];
  events: string[];
  service: ClaudeSubscriptionService;
}

const createFixture = async (): Promise<ServiceFixture> => {
  const rootDirectory = await mkdtemp(path.join(os.tmpdir(), 'bitterless-claude-service-'));
  const ids = [ACCOUNT_ID, SECOND_ACCOUNT_ID, NEW_ACCOUNT_ID];
  const repository = new ClaudeAccountRepository({
    rootDirectory,
    // Slots live under the home directory and removal deletes them, so tests
    // must never resolve a real one.
    homeDirectory: path.join(rootDirectory, 'home'),
    isolatedCredentialStorageAvailable: true,
    createId: () => ids.shift() ?? NEW_ACCOUNT_ID
  });
  await repository.initialize();
  const identity = await repository.createIdentity();
  await repository.saveAccount(identity, 'Personal Max', {
    email: 'personal@example.test',
    subscriptionType: 'max'
  });
  const router = new ClaudeAccountRouter(repository);
  const events: string[] = [];
  const ptyFactory = new ServiceFakePtyFactory();
  const browser = new ServiceFakeBrowser(events);
  const authCli = new ServiceFakeAuthCli(events);
  const executor = new ServiceFakeExecutor();
  const server = new ServiceFakeServer();
  const broadcasts: ClaudeSubscriptionSnapshot[] = [];
  const clipboardWrites: string[] = [];
  let service: ClaudeSubscriptionService | null = null;
  const authorization = new ClaudeAuthorizationCoordinator({
    repository,
    ptyFactory,
    authCli,
    browserFactory: browser,
    createFlowId: () => FLOW_ID,
    timeoutMs: 5_000,
    onFlowChanged: (flow) => service?.authorizationFlowChanged(flow),
    onAccountSaved: (account) => service?.authorizationAccountSaved(account.id),
    onFlowError: () => service?.authorizationFlowFailed()
  });
  const authorizationCalls: AuthorizationCallCounts = { start: 0, submit: 0, cancel: 0 };
  const startAuthorization = authorization.start.bind(authorization);
  const submitAuthorizationCode = authorization.submitCode.bind(authorization);
  const cancelAuthorization = authorization.cancel.bind(authorization);
  authorization.start = (input) => {
    authorizationCalls.start += 1;
    return startAuthorization(input);
  };
  authorization.submitCode = (flowId, code) => {
    authorizationCalls.submit += 1;
    submitAuthorizationCode(flowId, code);
  };
  authorization.cancel = async (flowId) => {
    authorizationCalls.cancel += 1;
    await cancelAuthorization(flowId);
  };
  service = new ClaudeSubscriptionService({
    repository,
    router,
    executor,
    server,
    authorization,
    authCli,
    browserFactory: browser,
    writeClipboard: (text) => clipboardWrites.push(text),
    broadcastSnapshot: (snapshot) => broadcasts.push(parseClaudeSubscriptionSnapshot(snapshot)),
    now: (() => {
      let now = 1_777_000_000_000;
      return () => ++now;
    })()
  });
  await service.start();
  return {
    rootDirectory,
    repository,
    router,
    identity,
    ptyFactory,
    browser,
    authCli,
    executor,
    server,
    authorization,
    authorizationCalls,
    broadcasts,
    clipboardWrites,
    events,
    service
  };
};

const addSecondAccount = async (fixture: ServiceFixture): Promise<ClaudeAccountIdentity> => {
  const identity = await fixture.repository.createIdentity();
  await fixture.repository.saveAccount(identity, 'Second Max', {
    email: 'second@example.test',
    subscriptionType: 'max'
  });
  return identity;
};

const cleanup = async (fixture: ServiceFixture): Promise<void> => {
  fixture.executor.resolve();
  fixture.authCli.logoutGate?.resolve();
  fixture.browser.clearGate?.resolve();
  await fixture.service.stop();
  await rm(fixture.rootDirectory, { recursive: true, force: true });
};

const invokeRejectedActions = async (fixture: ServiceFixture, accountId: string): Promise<void> => {
  const actions = [
    await fixture.service.testAccount({ accountId }),
    await fixture.service.startAuthorization({ accountId, label: 'Must not start' }),
    await fixture.service.submitAuthorizationCode({ flowId: FLOW_ID, code: 'manual-code' }),
    await fixture.service.cancelAuthorization({ flowId: FLOW_ID }),
    await fixture.service.renameAccount({ accountId, label: 'Must not rename' }),
    await fixture.service.setAccountEnabled({ accountId, enabled: false }),
    await fixture.service.removeAccount({ accountId })
  ];
  for (const result of actions) assertRuntimeUnavailable(result);
  assertRuntimeUnavailable(await fixture.service.copyCodexProfile());
};

test('stop fences every action, awaits a deferred logout/removal, and start reopens admission', async () => {
  const fixture = await createFixture();
  const second = await addSecondAccount(fixture);
  const logoutGate = createDeferred();
  fixture.authCli.logoutGate = logoutGate;
  try {
    const removal = fixture.service.removeAccount({ accountId: fixture.identity.id });
    await waitUntil(() => fixture.authCli.logoutCalls.length === 1, 'logout should start');

    let stopped = false;
    const stopping = fixture.service.stop().then(() => {
      stopped = true;
    });
    await nextTurn();
    assert.equal(stopped, false, 'stop must await the in-flight removal lifecycle');

    await invokeRejectedActions(fixture, second.id);
    assert.deepEqual(fixture.authorizationCalls, { start: 0, submit: 0, cancel: 0 });
    assert.equal(fixture.executor.calls.length, 0);
    assert.equal(fixture.authCli.logoutCalls.length, 1);
    assert.equal(fixture.ptyFactory.ptys.length, 0);
    assert.deepEqual(fixture.clipboardWrites, []);

    logoutGate.resolve();
    assert.equal((await removal).ok, true);
    await stopping;
    assert.equal(stopped, true);

    await invokeRejectedActions(fixture, second.id);
    assert.deepEqual(fixture.authorizationCalls, { start: 0, submit: 0, cancel: 0 });
    assert.equal(fixture.executor.calls.length, 0);
    assert.equal(fixture.authCli.logoutCalls.length, 1);
    assert.equal(fixture.ptyFactory.ptys.length, 0);
    assert.deepEqual(fixture.clipboardWrites, []);

    await fixture.service.start();
    const restartedAuth = await fixture.service.startAuthorization({ label: 'After restart' });
    assert.equal(restartedAuth.ok, true);
    assert.equal(fixture.authorizationCalls.start, 1);
    assert.equal(fixture.ptyFactory.ptys.length, 1);
    if (restartedAuth.ok) {
      const flowId = restartedAuth.snapshot.authFlow?.flowId;
      assert.ok(flowId);
      assert.equal((await fixture.service.cancelAuthorization({ flowId })).ok, true);
    }
    assert.equal((await fixture.service.testAccount({ accountId: second.id })).ok, true);
    assert.equal(fixture.executor.calls.length, 1);
    assert.deepEqual(await fixture.service.copyCodexProfile(), { ok: true });
    // Codex reads its model list from `model_catalog_json`, never from the
    // provider's /v1/models, so the copied snippet has to carry a path to a
    // catalog that exists. The key must also precede the first table header, or
    // TOML scopes it into the provider block and Codex ignores it.
    const copied = String(fixture.clipboardWrites[0] ?? '');
    assert.ok(
      copied.indexOf('model_catalog_json') < copied.indexOf('[model_providers.'),
      'model_catalog_json must appear before any table header'
    );
    const catalogMatch = /^model_catalog_json = "(.+)"$/mu.exec(copied);
    assert.ok(catalogMatch, 'the snippet must reference a catalog file');
    const catalogPath = catalogMatch[1]!;
    assert.equal(
      copied,
      buildClaudeSubscriptionCodexProfile(CLAUDE_SUBSCRIPTION_DEFAULT_PORT, catalogPath)
    );

    const catalog = JSON.parse(await readFile(catalogPath, 'utf8')) as {
      models: Array<{ slug: string; supported_reasoning_levels: Array<{ effort: string }> }>;
    };
    // Both subscriptions are offered through the one provider Desktop allows.
    assert.deepEqual(
      catalog.models.map((model) => model.slug).sort(),
      [
        'claude-opus',
        'claude-sonnet',
        'gpt-5.6-luna',
        'gpt-5.6-sol',
        'gpt-5.6-terra'
      ],
      'the catalog covers both upstreams, not just Claude'
    );

    // Every entry advertises the same client ladder. The upstreams do not share a
    // vocabulary — pi has `minimal` and no `ultra`, the Claude CLI has neither — so
    // the catalogue publishes the client's rungs and each request is shifted onto its
    // upstream's ladder by rank at dispatch.
    const effortsOf = (slug: string): string[] =>
      catalog.models
        .find((model) => model.slug === slug)!
        .supported_reasoning_levels.map((level) => level.effort);
    // Asserted as a rule rather than a copied list: an entry publishes a contiguous
    // prefix of the client ladder, shortened only where the upstream has no top rung
    // to back it. Duplicating the list here would only record which revision of it
    // the test was written against.
    const clientLadder = [...SUB2API_CLIENT_EFFORTS];
    for (const slug of ['claude-opus', 'claude-sonnet', 'gpt-5.6-sol']) {
      const efforts = effortsOf(slug);
      assert.ok(efforts.length > 0, `${slug} advertises at least one level`);
      assert.deepEqual(
        efforts,
        clientLadder.slice(0, efforts.length),
        `${slug} advertises a prefix of the client ladder`
      );
    }
    // Only an upstream without a top rung is allowed to be short.
    assert.deepEqual(effortsOf('claude-opus'), clientLadder);
    assert.deepEqual(effortsOf('gpt-5.6-sol'), clientLadder);

    for (const model of catalog.models) {
      // 0.137 rejects an entry missing either of these; 0.149 tolerates it. A
      // single missing field discards the entire catalog.
      for (const required of [
        'supports_reasoning_summaries',
        'supports_parallel_tool_calls',
        'visibility',
        'truncation_policy'
      ]) {
        assert.ok(required in model, `${model.slug} is missing ${required}`);
      }
    }
  } finally {
    logoutGate.resolve();
    await cleanup(fixture);
  }
});

test('service maintenance blocks routing and an existing routing lease blocks service mutation', async () => {
  const fixture = await createFixture();
  try {
    fixture.executor.deferred = true;
    const testing = fixture.service.testAccount({ accountId: fixture.identity.id });
    await waitUntil(() => fixture.executor.started, 'account test should enter its maintenance');
    await assert.rejects(fixture.router.lease('maintenance-first'), ClaudeNoEligibleAccountError);

    fixture.executor.resolve();
    assert.equal((await testing).ok, true);
    const expectedContext = await fixture.repository.getExecutionContext(fixture.identity.id);
    assert.deepEqual(fixture.executor.calls[0]?.context, expectedContext);

    const lease = await fixture.router.lease('lease-first');
    try {
      const rename = await fixture.service.renameAccount({
        accountId: fixture.identity.id,
        label: 'Must not rename under an active lease'
      });
      assertRuntimeUnavailable(rename);
      assert.equal((await fixture.repository.listAccounts())[0]?.label, 'Personal Max');
    } finally {
      lease.release();
    }

    const renamed = await fixture.service.renameAccount({
      accountId: fixture.identity.id,
      label: 'Renamed after release'
    });
    assert.equal(renamed.ok, true);
    assert.equal((await fixture.repository.listAccounts())[0]?.label, 'Renamed after release');
  } finally {
    fixture.executor.resolve();
    await cleanup(fixture);
  }
});

test('a second authorization cannot replace the active flow maintenance handle', async () => {
  const fixture = await createFixture();
  const second = await addSecondAccount(fixture);
  await fixture.repository.setEnabled(second.id, false);
  try {
    const started = await fixture.service.startAuthorization({
      accountId: fixture.identity.id,
      label: 'Existing label is retained'
    });
    assert.equal(started.ok, true);
    await assert.rejects(fixture.router.lease('active-auth'), ClaudeNoEligibleAccountError);

    const competing = await fixture.service.startAuthorization({
      accountId: second.id,
      label: 'Must not start'
    });
    assert.equal(competing.ok, false);
    if (!competing.ok) {
      assert.deepEqual(competing.error, { code: 'auth_busy', retryable: false });
    }
    assert.equal(fixture.authorizationCalls.start, 1);

    const flowId = fixture.authorization.currentFlow()?.flowId;
    assert.ok(flowId);
    assert.equal((await fixture.service.cancelAuthorization({ flowId })).ok, true);

    const reacquired = fixture.router.tryAcquireMaintenance(fixture.identity.id);
    assert.ok(reacquired, 'the original authorization maintenance must be released');
    reacquired.release();
  } finally {
    await cleanup(fixture);
  }
});

test('remove orders isolated logout before partition clear and metadata deletion', async () => {
  const fixture = await createFixture();
  const originalRemove = fixture.repository.remove.bind(fixture.repository);
  fixture.repository.remove = async (accountId) => {
    fixture.events.push('remove');
    await originalRemove(accountId);
  };
  fixture.browser.onClear = async (partition) => {
    assert.equal(partition, fixture.identity.partition);
    assert.notEqual(fixture.repository.getIdentity(fixture.identity.id), null);
    assert.equal((await stat(fixture.identity.configDirectory)).isDirectory(), true);
  };
  try {
    const context = await fixture.repository.getAccountContext(fixture.identity.id);
    const result = await fixture.service.removeAccount({ accountId: fixture.identity.id });

    assert.equal(result.ok, true);
    assert.deepEqual(fixture.events, ['logout', 'clear', 'remove']);
    assert.deepEqual(fixture.authCli.logoutCalls, [context]);
    assert.deepEqual(fixture.browser.cleared, [fixture.identity.partition]);
    assert.equal(fixture.repository.getIdentity(fixture.identity.id), null);
    await assert.rejects(stat(path.join(fixture.rootDirectory, 'accounts', fixture.identity.id)), {
      code: 'ENOENT'
    });
  } finally {
    fixture.repository.remove = originalRemove;
    await cleanup(fixture);
  }
});

test('logout failure preserves metadata but fails closed until reconnect', async () => {
  const fixture = await createFixture();
  fixture.authCli.logoutError = new ClaudeLogoutError();
  try {
    const result = await fixture.service.removeAccount({ accountId: fixture.identity.id });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, 'claude_logout_failed');
    assert.equal(result.snapshot.accounts[0]?.status, 'reconnect');
    assert.notEqual(fixture.repository.getIdentity(fixture.identity.id), null);
    assert.deepEqual(fixture.browser.cleared, []);
    await assert.rejects(fixture.router.lease('logout-failed'), ClaudeNoEligibleAccountError);
  } finally {
    await cleanup(fixture);
  }
});

test('post-logout partition failure leaves reconnect metadata and prevents routing', async () => {
  const fixture = await createFixture();
  fixture.browser.clearError = new Error('partition unavailable');
  try {
    const result = await fixture.service.removeAccount({ accountId: fixture.identity.id });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, 'partition_clear_failed');
    assert.equal(result.snapshot.accounts[0]?.status, 'reconnect');
    assert.notEqual(fixture.repository.getIdentity(fixture.identity.id), null);
    await assert.rejects(fixture.router.lease('clear-failed'), ClaudeNoEligibleAccountError);
  } finally {
    await cleanup(fixture);
  }
});

test('post-logout repository persistence failure leaves reconnect metadata and prevents routing', async () => {
  const fixture = await createFixture();
  const originalRemove = fixture.repository.remove.bind(fixture.repository);
  fixture.repository.remove = async () => {
    throw new Error('registry persistence failed');
  };
  try {
    const result = await fixture.service.removeAccount({ accountId: fixture.identity.id });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, 'runtime_unavailable');
    assert.equal(result.snapshot.accounts[0]?.status, 'reconnect');
    assert.notEqual(fixture.repository.getIdentity(fixture.identity.id), null);
    assert.deepEqual(fixture.browser.cleared, [fixture.identity.partition]);
    await assert.rejects(fixture.router.lease('persist-failed'), ClaudeNoEligibleAccountError);
  } finally {
    fixture.repository.remove = originalRemove;
    await cleanup(fixture);
  }
});

test('deferred partition clearing fences every same-account operation and routing lease', async () => {
  const fixture = await createFixture();
  const clearGate = createDeferred();
  fixture.browser.clearGate = clearGate;
  try {
    const removal = fixture.service.removeAccount({ accountId: fixture.identity.id });
    await waitUntil(() => fixture.events.includes('clear'), 'partition clear should be pending');

    const conflicts = [
      await fixture.service.renameAccount({
        accountId: fixture.identity.id,
        label: 'Must not rename'
      }),
      await fixture.service.setAccountEnabled({
        accountId: fixture.identity.id,
        enabled: false
      }),
      await fixture.service.testAccount({ accountId: fixture.identity.id }),
      await fixture.service.startAuthorization({
        accountId: fixture.identity.id,
        label: 'Must not reconnect'
      }),
      await fixture.service.removeAccount({ accountId: fixture.identity.id })
    ];
    for (const result of conflicts) assertRuntimeUnavailable(result);
    await assert.rejects(fixture.router.lease('clear-pending'), ClaudeNoEligibleAccountError);
    assert.equal(fixture.authCli.logoutCalls.length, 1);
    assert.equal(fixture.executor.calls.length, 0);
    assert.equal(fixture.ptyFactory.ptys.length, 0);

    clearGate.resolve();
    assert.equal((await removal).ok, true);
  } finally {
    clearGate.resolve();
    await cleanup(fixture);
  }
});

test('delayed account reads preserve typed auth-error then null publication order and monotonic revisions', async () => {
  const fixture = await createFixture();
  const originalListAccounts = fixture.repository.listAccounts.bind(fixture.repository);
  const firstReadGate = createDeferred();
  let listCalls = 0;
  fixture.repository.listAccounts = async () => {
    listCalls += 1;
    if (listCalls === 1) await firstReadGate.promise;
    return await originalListAccounts();
  };
  fixture.broadcasts.length = 0;
  try {
    fixture.service.authorizationFlowChanged({
      flowId: FLOW_ID,
      accountId: fixture.identity.id,
      status: 'saving',
      canSubmitCode: false,
      codeAttempt: 0,
      error: { code: 'claude_authentication', retryable: true }
    });
    await waitUntil(() => listCalls === 1, 'the error publication should begin its account read');
    fixture.service.authorizationFlowFailed();
    fixture.service.authorizationFlowChanged(null);
    const concurrentSnapshot = fixture.service.getSnapshot();
    await nextTurn();
    assert.equal(
      listCalls,
      1,
      'later publications and XPC reads must queue behind the delayed error snapshot'
    );

    firstReadGate.resolve();
    await waitUntil(
      () => fixture.broadcasts.length >= 3 && fixture.broadcasts.at(-1)?.authFlow === null,
      'the queued terminal publication should settle after the error snapshot'
    );

    assert.deepEqual(fixture.broadcasts[0]?.authFlow?.error, {
      code: 'claude_authentication',
      retryable: true
    });
    const firstNull = fixture.broadcasts.findIndex((snapshot) => snapshot.authFlow === null);
    const firstError = fixture.broadcasts.findIndex(
      (snapshot) => snapshot.authFlow?.error?.code === 'claude_authentication'
    );
    assert.equal(firstError >= 0 && firstNull > firstError, true);
    const revisions = fixture.broadcasts.map((snapshot) => snapshot.revision);
    assert.equal(new Set(revisions).size, revisions.length);
    assert.deepEqual(
      [...revisions].sort((left, right) => left - right),
      revisions
    );
    const observedAt = fixture.broadcasts.map((snapshot) => snapshot.observedAt);
    assert.deepEqual(
      [...observedAt].sort((left, right) => left - right),
      observedAt
    );
    const readSnapshot = await concurrentSnapshot;
    assert.equal(readSnapshot.authFlow, null);
    assert.equal(readSnapshot.revision > Math.max(...revisions), true);
    assert.doesNotMatch(
      JSON.stringify(fixture.broadcasts),
      /configDirectory|secureStorageConfigDirectory|anthropicConfigDirectory|partition/u
    );
  } finally {
    firstReadGate.resolve();
    fixture.repository.listAccounts = originalListAccounts;
    await cleanup(fixture);
  }
});

test('failed reconnect is published as typed error, marks needsLogin, and cannot be routed', async () => {
  const fixture = await createFixture();
  fixture.authCli.verifyError = new ClaudeAuthenticationError();
  fixture.broadcasts.length = 0;
  try {
    const started = await fixture.service.startAuthorization({
      accountId: fixture.identity.id,
      label: 'Ignored reconnect label'
    });
    assert.equal(started.ok, true);
    fixture.ptyFactory.ptys[0]!.exit({ exitCode: 0, signal: null });
    await waitUntil(
      () =>
        fixture.authorization.currentFlow() === null &&
        fixture.broadcasts.some((snapshot) => snapshot.authFlow?.error !== undefined) &&
        fixture.broadcasts.at(-1)?.authFlow === null,
      'reconnect failure should publish its error and terminal null snapshots'
    );

    const snapshot = await fixture.service.getSnapshot();
    assert.equal(snapshot.accounts[0]?.status, 'reconnect');
    assert.deepEqual(
      fixture.broadcasts.find((candidate) => candidate.authFlow?.error)?.authFlow?.error,
      { code: 'claude_authentication', retryable: true }
    );
    assert.deepEqual(fixture.authCli.logoutCalls, []);
    assert.deepEqual(fixture.browser.cleared, []);
    assert.notEqual(fixture.repository.getIdentity(fixture.identity.id), null);
    await assert.rejects(fixture.router.lease('failed-reconnect'), ClaudeNoEligibleAccountError);
  } finally {
    await cleanup(fixture);
  }
});

test('corrupt local state degrades to a fixed metadata-only snapshot', async () => {
  const rootDirectory = await mkdtemp(path.join(os.tmpdir(), 'bitterless-claude-degraded-'));
  await writeFile(path.join(rootDirectory, 'accounts.json'), '{sensitive-invalid-registry', {
    mode: 0o600
  });
  const repository = new ClaudeAccountRepository({
    rootDirectory,
    // Slots live under the home directory and removal deletes them, so tests
    // must never resolve a real one.
    homeDirectory: path.join(rootDirectory, 'home'),
    isolatedCredentialStorageAvailable: true,
    createId: () => ACCOUNT_ID
  });
  const router = new ClaudeAccountRouter(repository);
  const events: string[] = [];
  const browser = new ServiceFakeBrowser(events);
  const executor = new ServiceFakeExecutor();
  const server = new ServiceFakeServer();
  const authCli = new ServiceFakeAuthCli(events);
  let service: ClaudeSubscriptionService | null = null;
  const authorization = new ClaudeAuthorizationCoordinator({
    repository,
    ptyFactory: null,
    authCli,
    browserFactory: browser,
    onFlowChanged: (flow) => service?.authorizationFlowChanged(flow)
  });
  service = new ClaudeSubscriptionService({
    repository,
    router,
    executor,
    server,
    authorization,
    authCli,
    browserFactory: browser,
    writeClipboard: () => undefined,
    broadcastSnapshot: () => undefined
  });
  try {
    const snapshot = await service.getSnapshot();
    assert.equal(snapshot.server.state, 'attention');
    assert.equal(snapshot.secureStorageAvailable, false);
    assert.deepEqual(snapshot.accounts, []);
    assert.equal(snapshot.authFlow, null);
    assert.doesNotMatch(JSON.stringify(snapshot), /sensitive|registry|path/u);
  } finally {
    await service.stop();
    await rm(rootDirectory, { recursive: true, force: true });
  }
});
