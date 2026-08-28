import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { ClaudeSubscriptionAuthFlowView } from '../../src/shared/claudeSubscription';
import {
  ClaudeAccountRepository,
  type ClaudeAccountExecutionContext
} from '../../src/main/claudeSubscription/claudeAccount.repository';
import type {
  ClaudeAuthBrowserFactory,
  ClaudeAuthBrowserSession,
  OpenClaudeAuthBrowserInput
} from '../../src/main/claudeSubscription/claudeAuth.browser';
import type { ClaudeAccountAuthCli } from '../../src/main/claudeSubscription/claudeAuth.command';
import {
  ClaudeAuthorizationCoordinator,
  ClaudeAuthorizationError
} from '../../src/main/claudeSubscription/claudeAuth.coordinator';
import type {
  ClaudeAuthLoginPty,
  ClaudeAuthLoginPtyExit,
  ClaudeAuthLoginPtyFactory,
  ClaudeAuthLoginPtySpawnOptions
} from '../../src/main/claudeSubscription/claudeAuthLogin.pty';
import {
  ClaudeAuthenticationError,
  ClaudeSubscriptionRequiredError
} from '../../src/main/claudeSubscription/claudeSubscription.errors';

const ACCOUNT_IDS = [
  '00000000-0000-4000-8000-000000000041',
  '00000000-0000-4000-8000-000000000042',
  '00000000-0000-4000-8000-000000000043'
];
const FLOW_IDS = [
  '00000000-0000-4000-8000-000000000051',
  '00000000-0000-4000-8000-000000000052',
  '00000000-0000-4000-8000-000000000053'
];
const TOKEN_SHAPED_OUTPUT = 'sk-ant-oat01-abcdefghijklmnopqrstuvwxyz123456';
const AUTHORIZATION_URL =
  'https://claude.ai/oauth/authorize?client_id=bitterless-test&code_challenge=challenge';

class FakePty implements ClaudeAuthLoginPty {
  readonly writes: string[] = [];
  killed = false;
  blockKill = false;
  readonly #dataListeners = new Set<(data: Buffer) => void>();
  readonly #historicalDataListeners = new Set<(data: Buffer) => void>();
  readonly #exitListeners = new Set<(result: ClaudeAuthLoginPtyExit) => void>();
  #resolveKill: (() => void) | null = null;

  writeLine(value: string): void {
    this.writes.push(value);
  }

  async kill(): Promise<void> {
    this.killed = true;
    if (!this.blockKill) return;
    await new Promise<void>((resolve) => {
      this.#resolveKill = resolve;
    });
  }

  releaseKill(): void {
    this.#resolveKill?.();
    this.#resolveKill = null;
  }

  onData(listener: (data: Buffer) => void): () => void {
    this.#dataListeners.add(listener);
    this.#historicalDataListeners.add(listener);
    return () => this.#dataListeners.delete(listener);
  }

  onExit(listener: (result: ClaudeAuthLoginPtyExit) => void): () => void {
    this.#exitListeners.add(listener);
    return () => this.#exitListeners.delete(listener);
  }

  emit(value: string): void {
    for (const listener of this.#dataListeners) listener(Buffer.from(value));
  }

  emitStale(value: string): void {
    for (const listener of this.#historicalDataListeners) listener(Buffer.from(value));
  }

  exit(result: ClaudeAuthLoginPtyExit): void {
    for (const listener of this.#exitListeners) listener(result);
  }
}

class FakePtyFactory implements ClaudeAuthLoginPtyFactory {
  readonly ptys: FakePty[] = [];
  readonly options: ClaudeAuthLoginPtySpawnOptions[] = [];

  spawn(options: ClaudeAuthLoginPtySpawnOptions): ClaudeAuthLoginPty {
    this.options.push(options);
    const pty = new FakePty();
    this.ptys.push(pty);
    return pty;
  }
}

class FakeBrowserFactory implements ClaudeAuthBrowserFactory {
  opened: OpenClaudeAuthBrowserInput | null = null;
  readonly cleared: string[] = [];
  internalCloseCount = 0;

  open(input: OpenClaudeAuthBrowserInput): ClaudeAuthBrowserSession {
    this.opened = input;
    return {
      close: () => {
        this.internalCloseCount += 1;
        input.onClosed();
      }
    };
  }

  async clear(partition: string): Promise<void> {
    this.cleared.push(partition);
  }

  closeAsUser(): void {
    this.opened?.onClosed();
  }
}

class FakeAccountAuthCli implements ClaudeAccountAuthCli {
  readonly verifyCalls: ClaudeAccountExecutionContext[] = [];
  readonly logoutCalls: ClaudeAccountExecutionContext[] = [];
  readonly events: string[];
  verifyError: Error | null = null;
  logoutError: Error | null = null;
  logoutSawManagedDirectory = false;
  readonly status = {
    loggedIn: true as const,
    authMethod: 'claude.ai' as const,
    apiProvider: 'firstParty' as const,
    subscriptionType: 'max' as const,
    email: 'personal@example.test'
  };

  constructor(events: string[]) {
    this.events = events;
  }

  async verify(context: ClaudeAccountExecutionContext) {
    this.events.push('verify');
    this.verifyCalls.push(context);
    if (this.verifyError) throw this.verifyError;
    return this.status;
  }

  async logout(context: ClaudeAccountExecutionContext): Promise<void> {
    this.events.push('logout');
    this.logoutCalls.push(context);
    this.logoutSawManagedDirectory = (await stat(context.configDirectory)).isDirectory();
    if (this.logoutError) throw this.logoutError;
  }
}

interface CoordinatorFixture {
  rootDirectory: string;
  repository: ClaudeAccountRepository;
  ptyFactory: FakePtyFactory;
  authCli: FakeAccountAuthCli;
  browserFactory: FakeBrowserFactory;
  states: Array<ClaudeSubscriptionAuthFlowView | null>;
  errors: ClaudeAuthorizationError[];
  events: string[];
  saveControl: { error: Error | null };
  coordinator: ClaudeAuthorizationCoordinator;
}

const createFixture = async (
  options: {
    timeoutMs?: number;
    maximumOutputBytes?: number;
    isolatedCredentialStorageAvailable?: boolean;
    authCliAvailable?: boolean;
  } = {}
): Promise<CoordinatorFixture> => {
  const rootDirectory = await mkdtemp(path.join(os.tmpdir(), 'bitterless-claude-auth-'));
  const ids = [...ACCOUNT_IDS];
  const repository = new ClaudeAccountRepository({
    rootDirectory,
    // Slots live under the home directory and removal deletes them, so tests
    // must never resolve a real one.
    homeDirectory: path.join(rootDirectory, 'home'),
    isolatedCredentialStorageAvailable: options.isolatedCredentialStorageAvailable ?? true,
    createId: () => ids.shift() ?? ACCOUNT_IDS[2]!
  });
  await repository.initialize();
  const ptyFactory = new FakePtyFactory();
  const browserFactory = new FakeBrowserFactory();
  const states: Array<ClaudeSubscriptionAuthFlowView | null> = [];
  const errors: ClaudeAuthorizationError[] = [];
  const events: string[] = [];
  const authCli = new FakeAccountAuthCli(events);
  const saveControl = { error: null as Error | null };
  const originalSaveAccount = repository.saveAccount.bind(repository);
  repository.saveAccount = async (
    ...arguments_: Parameters<ClaudeAccountRepository['saveAccount']>
  ) => {
    events.push('save');
    if (saveControl.error) throw saveControl.error;
    return await originalSaveAccount(...arguments_);
  };
  const flowIds = [...FLOW_IDS];
  const coordinator = new ClaudeAuthorizationCoordinator({
    repository,
    ptyFactory,
    authCli: options.authCliAvailable === false ? null : authCli,
    browserFactory,
    timeoutMs: options.timeoutMs ?? 5_000,
    maximumOutputBytes: options.maximumOutputBytes,
    createFlowId: () => flowIds.shift() ?? FLOW_IDS[2]!,
    onFlowChanged: (flow) => states.push(flow),
    onFlowError: (error) => errors.push(error)
  });
  return {
    rootDirectory,
    repository,
    ptyFactory,
    authCli,
    browserFactory,
    states,
    errors,
    events,
    saveControl,
    coordinator
  };
};

const waitUntil = async (predicate: () => boolean, message: string): Promise<void> => {
  const deadline = Date.now() + 2_000;
  while (!predicate() && Date.now() < deadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(predicate(), true, message);
};

const cleanup = async (fixture: CoordinatorFixture): Promise<void> => {
  await fixture.coordinator.stop();
  await rm(fixture.rootDirectory, { recursive: true, force: true });
};

const finishLogin = (pty: FakePty): void => {
  pty.exit({ exitCode: 0, signal: null });
};

test('uses all isolated directories, gates one manual code, verifies, then saves metadata only', async () => {
  const fixture = await createFixture();
  try {
    const flow = await fixture.coordinator.start({ label: 'Personal Max' });
    const identity = fixture.repository.getIdentity(flow.accountId);
    assert.equal(identity, null, 'a provisional identity must not enter the registry');
    const context = fixture.ptyFactory.options[0]?.context;
    assert.ok(context);
    // Slots are ~/.claude<N>; see docs/features/claude-subscription-account-slots.md.
    assert.match(context.configDirectory, /\/\.claude[2-9]\d*$/u);
    assert.equal(context.secureStorageConfigDirectory, context.configDirectory);
    assert.equal(context.anthropicConfigDirectory, path.join(context.configDirectory, 'anthropic'));

    const pty = fixture.ptyFactory.ptys[0]!;
    assert.throws(
      () => fixture.coordinator.submitCode(flow.flowId, 'early-code'),
      (error: unknown) =>
        error instanceof ClaudeAuthorizationError && error.code === 'invalid_authorization_code'
    );
    pty.emit(`Open ${AUTHORIZATION_URL}\r\n`);
    pty.emit('\u001b[36mPaste authorization code here if prompted:\u001b[0m ');
    assert.equal(
      fixture.browserFactory.opened?.partition,
      `persist:bitterless-claude-account-${flow.accountId}`
    );
    assert.equal(fixture.browserFactory.opened?.authorizationUrl.href, AUTHORIZATION_URL);
    assert.equal(fixture.coordinator.currentFlow()?.canSubmitCode, true);

    for (const invalid of ['line\nbreak', 'line\rbreak', `nul\u0000byte`, 'x'.repeat(4_097)]) {
      assert.throws(() => fixture.coordinator.submitCode(flow.flowId, invalid));
    }
    fixture.coordinator.submitCode(flow.flowId, 'manual-code');
    assert.deepEqual(pty.writes, ['manual-code']);
    assert.throws(() => fixture.coordinator.submitCode(flow.flowId, 'second-code'));

    pty.emit(`${TOKEN_SHAPED_OUTPUT}\r\n${TOKEN_SHAPED_OUTPUT}-second\r\n`);
    assert.deepEqual(await fixture.repository.listAccounts(), []);
    finishLogin(pty);
    await waitUntil(() => fixture.coordinator.currentFlow() === null, 'login should settle');

    assert.deepEqual(fixture.events, ['verify', 'save']);
    assert.deepEqual(fixture.authCli.verifyCalls, [context]);
    assert.deepEqual(fixture.authCli.logoutCalls, []);
    const [account] = await fixture.repository.listAccounts();
    assert.equal(account?.label, 'Personal Max');
    assert.equal(account?.email, 'personal@example.test');
    assert.equal(account?.subscriptionType, 'max');
    const registry = await readFile(path.join(fixture.rootDirectory, 'accounts.json'), 'utf8');
    assert.doesNotMatch(registry, /sk-ant|oat01|encryptedToken|oauthToken/u);
    assert.equal(pty.killed, true);
    assert.equal(fixture.browserFactory.internalCloseCount, 1);
    assert.equal(fixture.errors.length, 0);
    assert.equal(fixture.states.at(-1), null);
  } finally {
    await cleanup(fixture);
  }
});

test('paid-subscription and generic verification failures logout before clearing a new identity', async () => {
  for (const scenario of [
    {
      error: new ClaudeSubscriptionRequiredError(),
      expectedCode: 'subscription_required' as const,
      retryable: false
    },
    {
      error: new ClaudeAuthenticationError(),
      expectedCode: 'claude_authentication' as const,
      retryable: true
    }
  ]) {
    const fixture = await createFixture();
    try {
      fixture.authCli.verifyError = scenario.error;
      const flow = await fixture.coordinator.start({ label: scenario.expectedCode });
      const accountDirectory = path.join(fixture.rootDirectory, 'accounts', flow.accountId);
      finishLogin(fixture.ptyFactory.ptys[0]!);
      await waitUntil(() => fixture.coordinator.currentFlow() === null, 'failure should settle');

      assert.deepEqual(fixture.events, ['verify', 'logout']);
      assert.equal(fixture.authCli.logoutSawManagedDirectory, true);
      assert.equal(fixture.errors.at(-1)?.code, scenario.expectedCode);
      assert.deepEqual(fixture.states.find((state) => state?.error)?.error, {
        code: scenario.expectedCode,
        retryable: scenario.retryable
      });
      assert.deepEqual(await fixture.repository.listAccounts(), []);
      assert.deepEqual(fixture.browserFactory.cleared, [
        `persist:bitterless-claude-account-${flow.accountId}`
      ]);
      await assert.rejects(stat(accountDirectory), { code: 'ENOENT' });
    } finally {
      await cleanup(fixture);
    }
  }
});

test('metadata save failure performs best-effort logout and still clears the provisional identity', async () => {
  const fixture = await createFixture();
  try {
    fixture.saveControl.error = new Error('metadata persistence failed');
    fixture.authCli.logoutError = new Error('logout failed after verified login');
    const flow = await fixture.coordinator.start({ label: 'Save failure' });
    finishLogin(fixture.ptyFactory.ptys[0]!);
    await waitUntil(() => fixture.coordinator.currentFlow() === null, 'save failure should settle');

    assert.deepEqual(fixture.events, ['verify', 'save', 'logout']);
    assert.equal(fixture.errors.at(-1)?.code, 'account_save_failed');
    assert.equal(fixture.authCli.logoutSawManagedDirectory, true);
    assert.deepEqual(await fixture.repository.listAccounts(), []);
    assert.deepEqual(fixture.browserFactory.cleared, [
      `persist:bitterless-claude-account-${flow.accountId}`
    ]);
    await assert.rejects(stat(path.join(fixture.rootDirectory, 'accounts', flow.accountId)), {
      code: 'ENOENT'
    });
  } finally {
    await cleanup(fixture);
  }
});

test('failed reconnect preserves metadata without logout or clearing, then service can fence routing', async () => {
  const fixture = await createFixture();
  try {
    const identity = await fixture.repository.createIdentity();
    await fixture.repository.saveAccount(identity, 'Existing Label', {
      email: 'old@example.test',
      subscriptionType: 'pro'
    });
    fixture.events.length = 0;
    fixture.authCli.verifyError = new ClaudeAuthenticationError();

    await fixture.coordinator.start({ accountId: identity.id, label: 'Rename Attempt' });
    finishLogin(fixture.ptyFactory.ptys[0]!);
    await waitUntil(() => fixture.coordinator.currentFlow() === null, 'reconnect should fail');

    assert.deepEqual(fixture.events, ['verify']);
    assert.deepEqual(fixture.authCli.logoutCalls, []);
    assert.deepEqual(fixture.browserFactory.cleared, []);
    const [account] = await fixture.repository.listAccounts();
    assert.equal(account?.label, 'Existing Label');
    assert.equal(account?.email, 'old@example.test');
    assert.equal(account?.subscriptionType, 'pro');
    assert.equal((await stat(identity.configDirectory)).isDirectory(), true);
    fixture.repository.markNeedsLogin(identity.id);
    assert.equal((await fixture.repository.listAccounts())[0]?.status, 'reconnect');
    assert.equal(await fixture.repository.getExecutionContext(identity.id), null);
  } finally {
    await cleanup(fixture);
  }
});

test('oversized generic output fails before verification and clears only the provisional identity', async () => {
  const fixture = await createFixture({ maximumOutputBytes: 32 });
  try {
    const flow = await fixture.coordinator.start({ label: 'Oversized' });
    fixture.ptyFactory.ptys[0]!.emit('x'.repeat(33));
    await waitUntil(() => fixture.coordinator.currentFlow() === null, 'oversized flow should fail');

    assert.equal(fixture.errors.at(-1)?.code, 'authorization_output_invalid');
    assert.deepEqual(fixture.events, ['logout']);
    assert.deepEqual(fixture.authCli.verifyCalls, []);
    assert.equal(fixture.authCli.logoutCalls.length, 1);
    assert.deepEqual(fixture.browserFactory.cleared, [
      `persist:bitterless-claude-account-${flow.accountId}`
    ]);
  } finally {
    await cleanup(fixture);
  }
});

test('cancellation waits for PTY teardown and stale events cannot complete a later flow', async () => {
  const fixture = await createFixture();
  try {
    const first = await fixture.coordinator.start({ label: 'First' });
    const firstPty = fixture.ptyFactory.ptys[0]!;
    firstPty.emit(`Open ${AUTHORIZATION_URL}\r\nPaste authorization code here if prompted: `);
    firstPty.blockKill = true;
    let cancelled = false;
    const cancellation = fixture.coordinator.cancel(first.flowId).then(() => {
      cancelled = true;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(cancelled, false);
    firstPty.releaseKill();
    await cancellation;

    const second = await fixture.coordinator.start({ label: 'Second' });
    firstPty.emitStale(`${TOKEN_SHAPED_OUTPUT}\r\n`);
    firstPty.exit({ exitCode: 0, signal: null });
    assert.equal(fixture.coordinator.currentFlow()?.flowId, second.flowId);
    assert.deepEqual(fixture.events, ['logout']);
    await fixture.coordinator.cancel(second.flowId);
    assert.deepEqual(fixture.events, ['logout', 'logout']);
    assert.equal(
      fixture.errors.some((error) => error.code === 'auth_cancelled'),
      false
    );
  } finally {
    await cleanup(fixture);
  }
});

test('start fails closed without isolated CLI credential storage or the auth command verifier', async () => {
  for (const scenario of [
    { isolatedCredentialStorageAvailable: false, authCliAvailable: true },
    { isolatedCredentialStorageAvailable: true, authCliAvailable: false }
  ]) {
    const fixture = await createFixture(scenario);
    try {
      await assert.rejects(
        fixture.coordinator.start({ label: 'Unavailable' }),
        (error: unknown) =>
          error instanceof ClaudeAuthorizationError &&
          error.code ===
            (scenario.isolatedCredentialStorageAvailable
              ? 'claude_cli_unavailable'
              : 'secure_storage_unavailable')
      );
      assert.equal(fixture.ptyFactory.ptys.length, 0);
    } finally {
      await cleanup(fixture);
    }
  }
});
