import type {
  ClaudeAccountId,
  ClaudeBridgePayload,
  ClaudeSubscriptionActionResult,
  ClaudeSubscriptionAuthFlowView,
  ClaudeSubscriptionCopyResult,
  ClaudeSubscriptionOperationError,
  ClaudeSubscriptionOperationErrorCode,
  ClaudeSubscriptionServerState,
  ClaudeSubscriptionSnapshot
} from '@shared/claudeSubscription/claudeSubscription.contract';
import {
  CLAUDE_SUBSCRIPTION_CODEX_PROFILE,
  CLAUDE_SUBSCRIPTION_HOST,
  CLAUDE_SUBSCRIPTION_PORT,
  CLAUDE_SUBSCRIPTION_SNAPSHOT_SCHEMA
} from '@shared/claudeSubscription/claudeSubscription.contract';
import {
  parseClaudeSubscriptionAccountIdInput,
  parseClaudeSubscriptionActionResult,
  parseClaudeSubscriptionCopyResult,
  parseClaudeSubscriptionFlowIdInput,
  parseClaudeSubscriptionRenameAccountInput,
  parseClaudeSubscriptionSetAccountEnabledInput,
  parseClaudeSubscriptionSnapshot,
  parseClaudeSubscriptionStartAuthInput,
  parseClaudeSubscriptionSubmitAuthCodeInput
} from '@shared/claudeSubscription/claudeSubscription.schema';
import { ClaudeAccountRepository } from './claudeAccount.repository';
import { ClaudeAccountRouter } from './claudeAccount.router';
import { ClaudeAuthorizationCoordinator, ClaudeAuthorizationError } from './claudeAuth.coordinator';
import type { ClaudeAuthBrowserFactory } from './claudeAuth.browser';
import type { ClaudeAccountAuthCli } from './claudeAuth.command';
import { ClaudeLogoutError } from './claudeAuth.command';
import type { ClaudeExecutor } from './claudeCli.executor';
import {
  ClaudeAuthenticationError,
  ClaudeExecutionError,
  ClaudeSubscriptionRequiredError,
  ClaudeUsageLimitError
} from './claudeSubscription.errors';

export interface ClaudeSubscriptionServerLifecycle {
  listen(): Promise<unknown>;
  close(): Promise<void>;
}

export interface ClaudeSubscriptionServiceOptions {
  repository: ClaudeAccountRepository;
  router: ClaudeAccountRouter;
  executor: ClaudeExecutor;
  server: ClaudeSubscriptionServerLifecycle;
  authorization: ClaudeAuthorizationCoordinator;
  authCli: ClaudeAccountAuthCli | null;
  browserFactory: ClaudeAuthBrowserFactory;
  writeClipboard(text: string): void;
  broadcastSnapshot(snapshot: ClaudeSubscriptionSnapshot): void;
  now?: () => number;
}

export class ClaudeSubscriptionStartupError extends Error {
  constructor() {
    super('Claude subscription endpoint could not start on 127.0.0.1:8741.');
    this.name = 'ClaudeSubscriptionStartupError';
  }
}

interface ActiveAccountTest {
  controller: AbortController;
  promise: Promise<void>;
}

interface ClaudeSubscriptionSnapshotCapture {
  authFlow: ClaudeSubscriptionAuthFlowView | null;
  serverState: ClaudeSubscriptionServerState;
  secureStorageAvailable: boolean;
  testingAccountIds: ReadonlySet<ClaudeAccountId>;
}

const ACCOUNT_TEST_PAYLOAD: ClaudeBridgePayload = {
  codex_instructions: 'Return a short readiness confirmation. Do not request a tool.',
  conversation: [{ role: 'user', content: 'Verify this local Claude subscription account.' }],
  available_tools: [],
  unsupported_codex_tool_types: [],
  response_rule: 'Return a final decision only.'
};

const operationError = (
  code: ClaudeSubscriptionOperationErrorCode,
  retryable = true
): ClaudeSubscriptionOperationError => ({ code, retryable });

const mapOperationError = (error: unknown): ClaudeSubscriptionOperationError => {
  if (error instanceof ClaudeAuthorizationError) {
    return operationError(error.code, error.retryable);
  }
  if (error instanceof ClaudeSubscriptionRequiredError)
    return operationError('subscription_required', false);
  if (error instanceof ClaudeLogoutError) return operationError('claude_logout_failed', true);
  if (error instanceof ClaudeAuthenticationError) {
    return operationError('claude_authentication');
  }
  if (error instanceof ClaudeUsageLimitError) {
    return operationError('claude_usage_limit');
  }
  if (error instanceof ClaudeExecutionError) {
    return operationError('claude_execution');
  }
  return operationError('runtime_unavailable');
};

export class ClaudeSubscriptionService {
  readonly #repository: ClaudeAccountRepository;
  readonly #router: ClaudeAccountRouter;
  readonly #executor: ClaudeExecutor;
  readonly #server: ClaudeSubscriptionServerLifecycle;
  readonly #authorization: ClaudeAuthorizationCoordinator;
  readonly #authCli: ClaudeAccountAuthCli | null;
  readonly #browserFactory: ClaudeAuthBrowserFactory;
  readonly #writeClipboard: (text: string) => void;
  readonly #broadcastSnapshot: (snapshot: ClaudeSubscriptionSnapshot) => void;
  readonly #now: () => number;
  readonly #activeTests = new Map<ClaudeAccountId, ActiveAccountTest>();
  readonly #activeAccountMutations = new Set<ClaudeAccountId>();
  readonly #pendingAuthorizationAccounts = new Set<ClaudeAccountId>();
  #authMaintenance: { accountId: ClaudeAccountId; release(): void } | null = null;
  #authorizationCompletedSuccessfully = false;
  readonly #activeLifecycleOperations = new Set<Promise<void>>();
  #initializePromise: Promise<void> | null = null;
  #startPromise: Promise<void> | null = null;
  #stopPromise: Promise<void> | null = null;
  #serverState: ClaudeSubscriptionServerState = 'stopped';
  #authFlow: ClaudeSubscriptionAuthFlowView | null = null;
  #revision = 0;
  #lastObservedAt = -1;
  #acceptingActions = false;
  #snapshotPublication: Promise<void> = Promise.resolve();
  #routingSnapshotScheduled = false;

  constructor(options: ClaudeSubscriptionServiceOptions) {
    this.#repository = options.repository;
    this.#router = options.router;
    this.#executor = options.executor;
    this.#server = options.server;
    this.#authorization = options.authorization;
    this.#authCli = options.authCli;
    this.#browserFactory = options.browserFactory;
    this.#writeClipboard = options.writeClipboard;
    this.#broadcastSnapshot = options.broadcastSnapshot;
    this.#now = options.now ?? Date.now;
  }

  authorizationFlowChanged(flow: ClaudeSubscriptionAuthFlowView | null): void {
    const priorMaintenance = this.#authMaintenance;
    this.#authFlow = flow;
    if (flow && !this.#authMaintenance) {
      const maintenance = this.#router.tryAcquireMaintenance(flow.accountId);
      if (maintenance) this.#authMaintenance = maintenance;
    }
    if (!flow && priorMaintenance) {
      if (
        !this.#authorizationCompletedSuccessfully &&
        this.#repository.getIdentity(priorMaintenance.accountId)
      ) {
        this.#repository.markNeedsLogin(priorMaintenance.accountId);
        void this.#router.markNeedsLogin(priorMaintenance.accountId).catch(() => undefined);
      }
      priorMaintenance.release();
      this.#authMaintenance = null;
      this.#authorizationCompletedSuccessfully = false;
    }
    void this.#publishSnapshot(flow).catch(() => undefined);
  }

  authorizationAccountSaved(accountId: ClaudeAccountId): void {
    this.#authorizationCompletedSuccessfully = true;
    this.#repository.markReady(accountId);
    this.#router.markReady(accountId);
    void this.#publishSnapshot().catch(() => undefined);
  }

  authorizationFlowFailed(): void {
    void this.#publishSnapshot().catch(() => undefined);
  }

  routingStateChanged(): void {
    if (this.#routingSnapshotScheduled) return;
    this.#routingSnapshotScheduled = true;
    queueMicrotask(() => {
      this.#routingSnapshotScheduled = false;
      void this.#publishSnapshot().catch(() => undefined);
    });
  }

  async start(): Promise<ClaudeSubscriptionSnapshot> {
    if (this.#stopPromise) await this.#stopPromise;
    this.#acceptingActions = true;
    if (!this.#startPromise && this.#serverState !== 'ready') {
      this.#startPromise = this.#startInternal();
    }
    const pending = this.#startPromise;
    if (pending) {
      try {
        await pending;
      } catch (error) {
        this.#acceptingActions = false;
        throw error;
      } finally {
        if (this.#startPromise === pending) this.#startPromise = null;
      }
    }
    return await this.getSnapshot();
  }

  async stop(): Promise<void> {
    this.#acceptingActions = false;
    if (this.#stopPromise) return await this.#stopPromise;
    this.#stopPromise = this.#stopInternal();
    try {
      await this.#stopPromise;
    } finally {
      this.#stopPromise = null;
    }
  }

  async getSnapshot(): Promise<ClaudeSubscriptionSnapshot> {
    try {
      await this.#ensureInitialized();
      return await this.#readSnapshot();
    } catch {
      this.#serverState = 'attention';
      return this.#createDegradedSnapshot();
    }
  }

  async startAuthorization(value: unknown): Promise<ClaudeSubscriptionActionResult> {
    let input;
    try {
      input = parseClaudeSubscriptionStartAuthInput(value);
    } catch {
      return await this.#failure(operationError('invalid_input', false));
    }
    if (!this.#acceptingActions) {
      return await this.#failure(operationError('runtime_unavailable', true));
    }
    if (this.#authFlow || this.#authMaintenance || this.#authorization.currentFlow()) {
      return await this.#failure(operationError('auth_busy', false));
    }
    if (input.accountId && this.#hasConflictingAccountActivity(input.accountId)) {
      return await this.#failure(operationError('runtime_unavailable', true));
    }
    const maintenance = input.accountId
      ? this.#router.tryAcquireMaintenance(input.accountId)
      : null;
    if (input.accountId && !maintenance) {
      return await this.#failure(operationError('runtime_unavailable', true));
    }
    if (input.accountId && maintenance) {
      this.#pendingAuthorizationAccounts.add(input.accountId);
      this.#authMaintenance = maintenance;
      this.#authorizationCompletedSuccessfully = false;
    }
    let started = false;
    try {
      await this.#ensureInitialized();
      if (!this.#acceptingActions) {
        return await this.#failure(operationError('runtime_unavailable', true));
      }
      const flow = await this.#authorization.start(input);
      this.#authFlow = flow;
      started = true;
      return await this.#success();
    } catch (error) {
      return await this.#failure(mapOperationError(error));
    } finally {
      if (input.accountId) this.#pendingAuthorizationAccounts.delete(input.accountId);
      if (!started && maintenance) {
        maintenance.release();
        if (this.#authMaintenance === maintenance) this.#authMaintenance = null;
      }
    }
  }

  async submitAuthorizationCode(value: unknown): Promise<ClaudeSubscriptionActionResult> {
    let input;
    try {
      input = parseClaudeSubscriptionSubmitAuthCodeInput(value);
    } catch {
      return await this.#failure(operationError('invalid_input', false));
    }
    if (!this.#acceptingActions) {
      return await this.#failure(operationError('runtime_unavailable', true));
    }
    await this.#ensureInitialized();
    if (!this.#acceptingActions) {
      return await this.#failure(operationError('runtime_unavailable', true));
    }
    try {
      this.#authorization.submitCode(input.flowId, input.code);
      this.#authFlow = this.#authorization.currentFlow();
      return await this.#success();
    } catch (error) {
      return await this.#failure(mapOperationError(error));
    }
  }

  async cancelAuthorization(value: unknown): Promise<ClaudeSubscriptionActionResult> {
    let input;
    try {
      input = parseClaudeSubscriptionFlowIdInput(value);
    } catch {
      return await this.#failure(operationError('invalid_input', false));
    }
    if (!this.#acceptingActions) {
      return await this.#failure(operationError('runtime_unavailable', true));
    }
    await this.#ensureInitialized();
    if (!this.#acceptingActions) {
      return await this.#failure(operationError('runtime_unavailable', true));
    }
    try {
      await this.#authorization.cancel(input.flowId);
      this.#authFlow = this.#authorization.currentFlow();
      return await this.#success();
    } catch (error) {
      return await this.#failure(mapOperationError(error));
    }
  }

  async renameAccount(value: unknown): Promise<ClaudeSubscriptionActionResult> {
    let input;
    try {
      input = parseClaudeSubscriptionRenameAccountInput(value);
    } catch {
      return await this.#failure(operationError('invalid_input', false));
    }
    if (!this.#acceptingActions) {
      return await this.#failure(operationError('runtime_unavailable', true));
    }
    if (this.#hasConflictingAccountActivity(input.accountId)) {
      return await this.#failure(operationError('runtime_unavailable', true));
    }
    const maintenance = this.#router.tryAcquireMaintenance(input.accountId);
    if (!maintenance) return await this.#failure(operationError('runtime_unavailable', true));
    const settleLifecycle = this.#beginLifecycleOperation();
    this.#activeAccountMutations.add(input.accountId);
    try {
      await this.#ensureInitialized();
      if (!this.#acceptingActions) {
        return await this.#failure(operationError('runtime_unavailable', true));
      }
      if (!this.#repository.getIdentity(input.accountId)) {
        return await this.#failure(operationError('account_not_found', false));
      }
      await this.#repository.rename(input.accountId, input.label);
      await this.#publishSnapshot();
      return await this.#success();
    } catch (error) {
      return await this.#failure(mapOperationError(error));
    } finally {
      this.#activeAccountMutations.delete(input.accountId);
      maintenance.release();
      settleLifecycle();
    }
  }

  async setAccountEnabled(value: unknown): Promise<ClaudeSubscriptionActionResult> {
    let input;
    try {
      input = parseClaudeSubscriptionSetAccountEnabledInput(value);
    } catch {
      return await this.#failure(operationError('invalid_input', false));
    }
    if (!this.#acceptingActions) {
      return await this.#failure(operationError('runtime_unavailable', true));
    }
    if (this.#hasConflictingAccountActivity(input.accountId)) {
      return await this.#failure(operationError('runtime_unavailable', true));
    }
    const maintenance = this.#router.tryAcquireMaintenance(input.accountId);
    if (!maintenance) return await this.#failure(operationError('runtime_unavailable', true));
    const settleLifecycle = this.#beginLifecycleOperation();
    this.#activeAccountMutations.add(input.accountId);
    try {
      await this.#ensureInitialized();
      if (!this.#acceptingActions) {
        return await this.#failure(operationError('runtime_unavailable', true));
      }
      if (!this.#repository.getIdentity(input.accountId)) {
        return await this.#failure(operationError('account_not_found', false));
      }
      await this.#repository.setEnabled(input.accountId, input.enabled);
      await this.#publishSnapshot();
      return await this.#success();
    } catch (error) {
      return await this.#failure(mapOperationError(error));
    } finally {
      this.#activeAccountMutations.delete(input.accountId);
      maintenance.release();
      settleLifecycle();
    }
  }

  async testAccount(value: unknown): Promise<ClaudeSubscriptionActionResult> {
    let input;
    try {
      input = parseClaudeSubscriptionAccountIdInput(value);
    } catch {
      return await this.#failure(operationError('invalid_input', false));
    }
    if (!this.#acceptingActions) {
      return await this.#failure(operationError('runtime_unavailable', true));
    }
    if (this.#hasConflictingAccountActivity(input.accountId)) {
      return await this.#failure(operationError('runtime_unavailable', true));
    }
    const maintenance = this.#router.tryAcquireMaintenance(input.accountId);
    if (!maintenance) return await this.#failure(operationError('runtime_unavailable', true));

    const settleLifecycle = this.#beginLifecycleOperation();
    const controller = new AbortController();
    let promise: Promise<void> | null = null;
    this.#activeAccountMutations.add(input.accountId);
    try {
      await this.#ensureInitialized();
      if (!this.#acceptingActions) {
        return await this.#failure(operationError('runtime_unavailable', true));
      }
      promise = this.#runAccountTest(input.accountId, controller.signal);
      this.#activeTests.set(input.accountId, { controller, promise });
      await this.#publishSnapshot();
      await promise;
      return await this.#success();
    } catch (error) {
      return await this.#failure(mapOperationError(error));
    } finally {
      if (promise) {
        controller.abort();
        await Promise.allSettled([promise]);
      }
      this.#activeTests.delete(input.accountId);
      this.#activeAccountMutations.delete(input.accountId);
      maintenance.release();
      try {
        await this.#publishSnapshot().catch(() => undefined);
      } finally {
        settleLifecycle();
      }
    }
  }

  async removeAccount(value: unknown): Promise<ClaudeSubscriptionActionResult> {
    let input;
    try {
      input = parseClaudeSubscriptionAccountIdInput(value);
    } catch {
      return await this.#failure(operationError('invalid_input', false));
    }
    if (!this.#acceptingActions) {
      return await this.#failure(operationError('runtime_unavailable', true));
    }
    if (this.#hasConflictingAccountActivity(input.accountId)) {
      return await this.#failure(operationError('runtime_unavailable', true));
    }
    const maintenance = this.#router.tryAcquireMaintenance(input.accountId);
    if (!maintenance) return await this.#failure(operationError('runtime_unavailable', true));
    const settleLifecycle = this.#beginLifecycleOperation();
    this.#activeAccountMutations.add(input.accountId);
    try {
      await this.#ensureInitialized();
      if (!this.#acceptingActions) {
        return await this.#failure(operationError('runtime_unavailable', true));
      }
      const identity = this.#repository.getIdentity(input.accountId);
      if (!identity) return await this.#failure(operationError('account_not_found', false));
      const context = await this.#repository.getAccountContext(input.accountId);
      if (!context || !this.#authCli) {
        return await this.#failure(operationError('claude_cli_unavailable', true));
      }
      try {
        await this.#authCli.logout(context);
      } catch (error) {
        this.#repository.markNeedsLogin(input.accountId);
        await this.#router.markNeedsLogin(input.accountId).catch(() => undefined);
        return await this.#failure(mapOperationError(error));
      }
      this.#repository.markNeedsLogin(input.accountId);
      await this.#router.markNeedsLogin(input.accountId);
      try {
        await this.#browserFactory.clear(identity.partition);
      } catch {
        return await this.#failure(operationError('partition_clear_failed', true));
      }
      try {
        await this.#repository.remove(input.accountId);
        await this.#publishSnapshot();
        return await this.#success();
      } catch (error) {
        return await this.#failure(mapOperationError(error));
      }
    } finally {
      this.#activeAccountMutations.delete(input.accountId);
      maintenance.release();
      settleLifecycle();
    }
  }

  async copyCodexProfile(): Promise<ClaudeSubscriptionCopyResult> {
    if (!this.#acceptingActions) {
      return parseClaudeSubscriptionCopyResult({
        ok: false,
        error: operationError('runtime_unavailable', true)
      });
    }
    try {
      this.#writeClipboard(CLAUDE_SUBSCRIPTION_CODEX_PROFILE);
      return parseClaudeSubscriptionCopyResult({ ok: true });
    } catch {
      return parseClaudeSubscriptionCopyResult({
        ok: false,
        error: operationError('profile_copy_failed', true)
      });
    }
  }

  async #startInternal(): Promise<void> {
    try {
      await this.#ensureInitialized();
    } catch {
      this.#serverState = 'attention';
      this.#broadcastSnapshot(this.#createDegradedSnapshot());
      throw new ClaudeSubscriptionStartupError();
    }
    this.#serverState = 'starting';
    await this.#publishSnapshot();
    try {
      await this.#server.listen();
      this.#serverState = 'ready';
    } catch {
      this.#serverState = 'attention';
      await this.#publishSnapshot();
      throw new ClaudeSubscriptionStartupError();
    }
    await this.#publishSnapshot();
  }

  async #stopInternal(): Promise<void> {
    const lifecycleOperations = [...this.#activeLifecycleOperations];
    try {
      await this.#ensureInitialized();
    } catch {
      await this.#server.close().catch(() => undefined);
      this.#serverState = 'stopped';
      this.#broadcastSnapshot(this.#createDegradedSnapshot('stopped'));
      return;
    }
    const tests = [...this.#activeTests.values()];
    for (const test of tests) test.controller.abort();
    await this.#authorization.stop();
    if (this.#authMaintenance) {
      this.#authMaintenance.release();
      this.#authMaintenance = null;
    }
    if (this.#startPromise) await this.#startPromise.catch(() => undefined);
    await this.#server.close().catch(() => undefined);
    await Promise.allSettled([
      ...tests.map((test) => test.promise),
      ...lifecycleOperations
    ]);
    this.#serverState = 'stopped';
    this.#authFlow = null;
    await this.#publishSnapshot();
  }

  async #runAccountTest(accountId: ClaudeAccountId, signal: AbortSignal): Promise<void> {
    if (!this.#repository.getIdentity(accountId)) {
      throw new ClaudeAuthorizationError('account_not_found', false);
    }
    const context = await this.#repository.getExecutionContext(accountId);
    if (!context) throw new ClaudeAuthenticationError();
    try {
      await this.#executor.execute(
        {
          model: 'sonnet',
          effort: 'high',
          payload: ACCOUNT_TEST_PAYLOAD,
          context
        },
        { signal }
      );
      this.#repository.markReady(accountId);
      this.#router.markReady(accountId);
    } catch (error) {
      if (
        error instanceof ClaudeAuthenticationError ||
        error instanceof ClaudeSubscriptionRequiredError
      ) {
        await this.#router.markNeedsLogin(accountId);
      } else if (error instanceof ClaudeUsageLimitError) {
        await this.#router.markCooldown(accountId, error.resetAt);
      }
      throw error;
    }
  }

  #hasConflictingAccountActivity(accountId: ClaudeAccountId): boolean {
    return (
      this.#activeAccountMutations.has(accountId) ||
      this.#pendingAuthorizationAccounts.has(accountId) ||
      this.#activeTests.has(accountId) ||
      this.#router.activeRequests(accountId) > 0 ||
      this.#authFlow?.accountId === accountId
    );
  }

  async #ensureInitialized(): Promise<void> {
    if (!this.#initializePromise) {
      this.#initializePromise = this.#repository.initialize().catch((error) => {
        this.#initializePromise = null;
        throw error;
      });
    }
    await this.#initializePromise;
  }

  async #publishSnapshot(
    authFlow: ClaudeSubscriptionAuthFlowView | null = this.#authFlow
  ): Promise<ClaudeSubscriptionSnapshot> {
    return await this.#enqueueSnapshot(authFlow, true);
  }

  async #readSnapshot(
    authFlow: ClaudeSubscriptionAuthFlowView | null = this.#authFlow
  ): Promise<ClaudeSubscriptionSnapshot> {
    return await this.#enqueueSnapshot(authFlow, false);
  }

  async #enqueueSnapshot(
    authFlow: ClaudeSubscriptionAuthFlowView | null,
    broadcast: boolean
  ): Promise<ClaudeSubscriptionSnapshot> {
    const capture = this.#captureSnapshot(authFlow);
    let snapshot!: ClaudeSubscriptionSnapshot;
    const publication = this.#snapshotPublication.then(async () => {
      snapshot = await this.#createSnapshot(capture);
      if (broadcast) this.#broadcastSnapshot(snapshot);
    });
    this.#snapshotPublication = publication.catch(() => undefined);
    await publication;
    return snapshot;
  }

  #beginLifecycleOperation(): () => void {
    let settle!: () => void;
    const promise = new Promise<void>((resolve) => {
      settle = resolve;
    });
    this.#activeLifecycleOperations.add(promise);
    let settled = false;
    return () => {
      if (settled) return;
      settled = true;
      this.#activeLifecycleOperations.delete(promise);
      settle();
    };
  }

  async #success(): Promise<ClaudeSubscriptionActionResult> {
    return parseClaudeSubscriptionActionResult({
      ok: true,
      snapshot: await this.#readSnapshot()
    });
  }

  async #failure(error: ClaudeSubscriptionOperationError): Promise<ClaudeSubscriptionActionResult> {
    try {
      await this.#ensureInitialized();
    } catch {
      this.#serverState = 'attention';
      return parseClaudeSubscriptionActionResult({
        ok: false,
        snapshot: this.#createDegradedSnapshot(),
        error
      });
    }
    return parseClaudeSubscriptionActionResult({
      ok: false,
      snapshot: await this.#readSnapshot(),
      error
    });
  }

  #captureSnapshot(
    authFlow: ClaudeSubscriptionAuthFlowView | null
  ): ClaudeSubscriptionSnapshotCapture {
    return {
      authFlow: authFlow
        ? {
            ...authFlow,
            ...(authFlow.error ? { error: { ...authFlow.error } } : {})
          }
        : null,
      serverState: this.#serverState,
      secureStorageAvailable: this.#repository.isolatedCredentialStorageAvailable(),
      testingAccountIds: new Set(this.#activeTests.keys())
    };
  }

  async #createSnapshot(
    capture: ClaudeSubscriptionSnapshotCapture
  ): Promise<ClaudeSubscriptionSnapshot> {
    const revision = ++this.#revision;
    const observedAt = Math.max(this.#now(), this.#lastObservedAt + 1);
    this.#lastObservedAt = observedAt;
    const accounts = (await this.#repository.listAccounts()).map((account) => {
      const activeRequests = this.#router.activeRequests(account.id);
      const testing = capture.testingAccountIds.has(account.id);
      return {
        ...account,
        activeRequests,
        status: testing
          ? ('checking' as const)
          : activeRequests > 0 && account.status === 'usable'
            ? ('busy' as const)
            : account.status
      };
    });
    return parseClaudeSubscriptionSnapshot({
      schema: CLAUDE_SUBSCRIPTION_SNAPSHOT_SCHEMA,
      revision,
      observedAt,
      secureStorageAvailable: capture.secureStorageAvailable,
      accounts,
      server: {
        state: capture.serverState,
        host: CLAUDE_SUBSCRIPTION_HOST,
        port: CLAUDE_SUBSCRIPTION_PORT
      },
      authFlow: capture.authFlow
    });
  }

  #createDegradedSnapshot(
    serverState: ClaudeSubscriptionServerState = 'attention'
  ): ClaudeSubscriptionSnapshot {
    const revision = ++this.#revision;
    const observedAt = Math.max(this.#now(), this.#lastObservedAt + 1);
    this.#lastObservedAt = observedAt;
    return parseClaudeSubscriptionSnapshot({
      schema: CLAUDE_SUBSCRIPTION_SNAPSHOT_SCHEMA,
      revision,
      observedAt,
      secureStorageAvailable: false,
      accounts: [],
      server: {
        state: serverState,
        host: CLAUDE_SUBSCRIPTION_HOST,
        port: CLAUDE_SUBSCRIPTION_PORT
      },
      authFlow: null
    });
  }
}
