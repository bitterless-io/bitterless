import type {
  ClaudeAccountId,
  ClaudeBridgePayload,
  ClaudeSubscriptionActionResult,
  ClaudeSubscriptionAdoptableSlot,
  ClaudeSubscriptionCatalogEntry,
  ClaudeSubscriptionCodexAccountView,
  ClaudeSubscriptionAuthFlowView,
  ClaudeSubscriptionCopyResult,
  ClaudeSubscriptionOperationError,
  ClaudeSubscriptionOperationErrorCode,
  ClaudeSubscriptionServerState,
  ClaudeSubscriptionSnapshot
} from '@shared/claudeSubscription/claudeSubscription.contract';
import {
  buildClaudeSubscriptionCodexProfile,
  claudeSubscriptionCatalogEntries,
  CLAUDE_SUBSCRIPTION_DEFAULT_PORT,
  CLAUDE_SUBSCRIPTION_HOST,
  CLAUDE_SUBSCRIPTION_SNAPSHOT_SCHEMA,
  SUB2API_CLIENT_EFFORTS,
  sortSub2ApiCatalogEntries
} from '@shared/claudeSubscription/claudeSubscription.contract';
import {
  parseClaudeSubscriptionAccountIdInput,
  parseClaudeSubscriptionAdoptAccountInput,
  parseClaudeSubscriptionActionResult,
  parseClaudeSubscriptionCopyResult,
  parseClaudeSubscriptionFlowIdInput,
  parseClaudeSubscriptionRenameAccountInput,
  parseClaudeSubscriptionSetAccountEnabledInput,
  parseClaudeSubscriptionSetServerPortInput,
  parseClaudeSubscriptionSnapshot,
  parseClaudeSubscriptionStartAuthInput,
  parseClaudeSubscriptionSubmitAuthCodeInput
} from '@shared/claudeSubscription/claudeSubscription.schema';
import {
  CODEX_RUNTIME_MODELS,
  CODEX_RUNTIME_MODEL_CONTEXT_WINDOW,
  CODEX_RUNTIME_MODEL_MAX_CONTEXT_WINDOW,
  CODEX_RUNTIME_MODEL_DEFAULT_EFFORT,
  CODEX_RUNTIME_MODEL_EFFORTS
} from '@main/codex/codexRuntime.service';
import { ClaudeAccountRepository } from './claudeAccount.repository';
import { ClaudeAccountRouter } from './claudeAccount.router';
import { ClaudeAuthorizationCoordinator, ClaudeAuthorizationError } from './claudeAuth.coordinator';
import type { ClaudeAuthBrowserFactory } from './claudeAuth.browser';
import type { ClaudeAccountAuthCli } from './claudeAuth.command';
import { ClaudeLogoutError } from './claudeAuth.command';
import type { ClaudeExecutor } from './claudeCli.executor';
import type { ClaudeUsageProbe } from './claudeUsage.probe';
import type { CodexAccountRepository } from './codexAccount.repository';
import {
  ClaudeAuthenticationError,
  ClaudeExecutionError,
  ClaudeSubscriptionRequiredError,
  ClaudeUsageLimitError
} from './claudeSubscription.errors';

/** How long a Codex credential probe is trusted before it is refreshed. */
const CODEX_PROBE_TTL_MS = 60_000;

/**
 * How often each account's quota is re-read.
 *
 * The report costs nothing — `claude -p '/usage'` returns `num_turns: 0` and zero
 * tokens — so the interval is set by how fast the number moves, not by price. Five
 * minutes is well inside the five-hour window it reports on.
 */
const USAGE_PROBE_INTERVAL_MS = 5 * 60_000;

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
  /** The GPT half of the endpoint. Absent in tests and when pi cannot be loaded. */
  codexUpstream?: { isAvailable(): Promise<boolean> } | null;
  /** Reads each account's remaining quota. Absent when the CLI is unavailable. */
  usageProbe?: ClaudeUsageProbe | null;
  /** Named captures of the ChatGPT credential. */
  codexAccounts?: CodexAccountRepository | null;
  usageProbeIntervalMs?: number;
  writeClipboard(text: string): void;
  broadcastSnapshot(snapshot: ClaudeSubscriptionSnapshot): void;
  now?: () => number;
}

export class ClaudeSubscriptionStartupError extends Error {
  constructor() {
    super('Claude subscription endpoint could not start on its configured loopback port.');
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
  readonly #codexUpstream: { isAvailable(): Promise<boolean> } | null;
  readonly #usageProbe: ClaudeUsageProbe | null;
  readonly #codexAccounts: CodexAccountRepository | null;
  #codexAccountViews: ClaudeSubscriptionCodexAccountView[] = [];
  readonly #usageProbeIntervalMs: number;
  #usageTimer: NodeJS.Timeout | null = null;
  #usageSweepRunning = false;
  #codexConnected = false;
  #codexProbedAt = 0;
  #codexProbeInFlight = false;
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
    this.#codexUpstream = options.codexUpstream ?? null;
    this.#usageProbe = options.usageProbe ?? null;
    this.#codexAccounts = options.codexAccounts ?? null;
    this.#usageProbeIntervalMs = options.usageProbeIntervalMs ?? USAGE_PROBE_INTERVAL_MS;
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

  /**
   * Registers a slot the owner already logged in from a terminal.
   *
   * This is the tail of the authorization flow without its head: verification and
   * persistence, but no PTY and no browser, because the login already happened.
   *
   * Unlike `startAuthorization`, a failure here must **not** log out or delete the
   * directory. The flow cleans up after itself because it created the directory;
   * adoption did not, and an owner's working account must survive a failed attempt
   * to register it.
   */
  async adoptAccount(value: unknown): Promise<ClaudeSubscriptionActionResult> {
    let input;
    try {
      input = parseClaudeSubscriptionAdoptAccountInput(value);
    } catch {
      return await this.#failure(operationError('invalid_input', false));
    }
    if (!this.#acceptingActions) {
      return await this.#failure(operationError('runtime_unavailable', true));
    }
    const authCli = this.#authCli;
    if (!authCli) return await this.#failure(operationError('runtime_unavailable', true));

    const settleLifecycle = this.#beginLifecycleOperation();
    try {
      await this.#ensureInitialized();
      if (!this.#acceptingActions) {
        return await this.#failure(operationError('runtime_unavailable', true));
      }
      if (!this.#repository.isolatedCredentialStorageAvailable()) {
        return await this.#failure(operationError('runtime_unavailable', true));
      }
      const identity = await this.#repository.adoptIdentity(input.slot);
      const status = await authCli.verify({
        configDirectory: identity.configDirectory,
        secureStorageConfigDirectory: identity.secureStorageConfigDirectory,
        anthropicConfigDirectory: identity.anthropicConfigDirectory
      });
      const account = await this.#repository.saveAccount(identity, input.label, {
        ...(status.email ? { email: status.email } : {}),
        subscriptionType: status.subscriptionType
      });
      this.#router.markReady(account.id);
      return await this.#success();
    } catch (error) {
      return await this.#failure(mapOperationError(error));
    } finally {
      try {
        await this.#publishSnapshot().catch(() => undefined);
      } finally {
        settleLifecycle();
      }
    }
  }

  /**
   * Persists a new loopback port. The listener is not restarted here: the server
   * instance is constructed with its port, so the change takes effect on the next
   * start rather than tearing down a server that may be serving a request.
   */
  async setServerPort(value: unknown): Promise<ClaudeSubscriptionActionResult> {
    let input;
    try {
      input = parseClaudeSubscriptionSetServerPortInput(value);
    } catch {
      return await this.#failure(operationError('invalid_input', false));
    }
    if (!this.#acceptingActions) {
      return await this.#failure(operationError('runtime_unavailable', true));
    }
    const settleLifecycle = this.#beginLifecycleOperation();
    try {
      await this.#ensureInitialized();
      await this.#repository.setServerPort(input.port);
      return await this.#success();
    } catch (error) {
      return await this.#failure(mapOperationError(error));
    } finally {
      try {
        await this.#publishSnapshot().catch(() => undefined);
      } finally {
        settleLifecycle();
      }
    }
  }

  async listAdoptableSlots(): Promise<ClaudeSubscriptionAdoptableSlot[]> {
    await this.#ensureInitialized();
    return await this.#repository.listAdoptableSlots();
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
      // The catalog file must exist before the snippet references it, otherwise
      // Codex discards the whole catalog and silently keeps its built-in list.
      const catalogPath = await this.#repository.writeCodexModelCatalog(this.#catalogEntries());
      this.#writeClipboard(
        buildClaudeSubscriptionCodexProfile(this.#repository.serverPort(), catalogPath)
      );
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
    this.#startUsageSweeps();
    await this.refreshCodexAccounts();
  }

  /**
   * Quota is read on start and then on an interval. Routing prefers the account with
   * the most left, so a pool whose numbers are never refreshed converges on whichever
   * account happened to be measured first — the sweep is what keeps the preference
   * meaningful rather than accidental.
   */
  #startUsageSweeps(): void {
    if (!this.#usageProbe || this.#usageTimer) return;
    void this.#sweepUsage();
    this.#usageTimer = setInterval(() => void this.#sweepUsage(), this.#usageProbeIntervalMs);
    this.#usageTimer.unref?.();
  }

  #stopUsageSweeps(): void {
    if (!this.#usageTimer) return;
    clearInterval(this.#usageTimer);
    this.#usageTimer = null;
  }

  async #sweepUsage(): Promise<void> {
    const probe = this.#usageProbe;
    // Sweeps never overlap: a slow CLI would otherwise stack children, one per account
    // per interval, against directories that must be used by a single process at a time.
    if (!probe || this.#usageSweepRunning) return;
    this.#usageSweepRunning = true;
    try {
      const accounts = await this.#repository.listAccounts();
      let changed = false;
      for (const account of accounts) {
        // A probe is a `claude` child in the account's own config directory, and the CLI
        // rewrites `.claude.json` on every run. Two children in one directory race on
        // that file — on 2026-08-26 exactly that truncated a 50KB config to a stub — so
        // the probe takes the same exclusion a request takes. It never waits: a busy
        // account is measured on the next sweep rather than queueing behind a turn.
        const maintenance = this.#router.tryAcquireMaintenance(account.id);
        if (!maintenance) continue;
        try {
          const context = await this.#repository.getExecutionContext(account.id);
          // Null while an account is mid-removal or its directory has gone; skip it
          // rather than probing a path that is no longer this account's.
          if (!context) continue;
          const report = await probe.probe(context);
          if (!report) continue;
          this.#router.observeRateLimit(account.id, {
            ...(report.sessionUsedPercent !== undefined
              ? { sessionUsedPercent: report.sessionUsedPercent }
              : {}),
            ...(report.weekUsedPercent !== undefined
              ? { weekUsedPercent: report.weekUsedPercent }
              : {}),
            ...(report.sessionResetsAt ? { sessionResetsAt: report.sessionResetsAt } : {}),
            ...(report.weekResetsAt ? { weekResetsAt: report.weekResetsAt } : {}),
            observedAt: report.observedAt
          });
          changed = true;
        } catch {
          // A quota reading is an optimisation for routing. Losing one must never
          // disturb the pool or the snapshot.
        } finally {
          maintenance.release();
        }
      }
      if (changed) await this.#publishSnapshot().catch(() => undefined);
    } finally {
      this.#usageSweepRunning = false;
    }
  }

  async #stopInternal(): Promise<void> {
    this.#stopUsageSweeps();
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
    this.#maybeProbeCodexUpstream();
    const revision = ++this.#revision;
    const observedAt = Math.max(this.#now(), this.#lastObservedAt + 1);
    this.#lastObservedAt = observedAt;
    const routing = await this.#repository.listRoutingAccounts().catch(() => []);
    const activeAccountId = this.#router.activeAccountId(routing);
    const accounts = (await this.#repository.listAccounts()).map((account) => {
      const activeRequests = this.#router.activeRequests(account.id);
      const testing = capture.testingAccountIds.has(account.id);
      const usage = this.#router.rateLimit(account.id);
      return {
        ...account,
        ...(usage ? { usage } : {}),
        ...(account.id === activeAccountId ? { active: true } : {}),
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
        port: this.#repository.serverPort()
      },
      authFlow: capture.authFlow,
      codexUpstream: {
        connected: this.#codexConnected,
        models: [...CODEX_RUNTIME_MODELS],
        accounts: this.#codexAccountViews.map((account) => ({ ...account }))
      }
    });
  }

  /** Refreshes the named ChatGPT captures shown in the panel. */
  async refreshCodexAccounts(): Promise<void> {
    const repository = this.#codexAccounts;
    if (!repository) return;
    try {
      const [accounts, activeId] = await Promise.all([repository.list(), repository.activeId()]);
      this.#codexAccountViews = accounts.map((account) => ({
        id: account.id,
        label: account.label,
        active: account.id === activeId,
        createdAt: account.createdAt
      }));
    } catch {
      this.#codexAccountViews = [];
    }
  }

  async captureCodexAccount(label: string): Promise<ClaudeSubscriptionActionResult> {
    const repository = this.#codexAccounts;
    if (!repository) {
      return parseClaudeSubscriptionActionResult({
        ok: false,
        snapshot: await this.#readSnapshot(),
        error: operationError('runtime_unavailable', true)
      });
    }
    try {
      await repository.capture(label);
      await this.refreshCodexAccounts();
      // A capture changes which credential the endpoint reads, so the probe's cached
      // answer is stale by definition.
      this.#codexProbedAt = 0;
      return parseClaudeSubscriptionActionResult({ ok: true, snapshot: await this.#readSnapshot() });
    } catch {
      return parseClaudeSubscriptionActionResult({
        ok: false,
        snapshot: await this.#readSnapshot(),
        error: operationError('codex_account_failed', true)
      });
    }
  }

  async activateCodexAccount(accountId: string): Promise<ClaudeSubscriptionActionResult> {
    const repository = this.#codexAccounts;
    if (!repository) {
      return parseClaudeSubscriptionActionResult({
        ok: false,
        snapshot: await this.#readSnapshot(),
        error: operationError('runtime_unavailable', true)
      });
    }
    try {
      await repository.activate(accountId);
      await this.refreshCodexAccounts();
      this.#codexProbedAt = 0;
      return parseClaudeSubscriptionActionResult({ ok: true, snapshot: await this.#readSnapshot() });
    } catch {
      return parseClaudeSubscriptionActionResult({
        ok: false,
        snapshot: await this.#readSnapshot(),
        error: operationError('codex_account_failed', true)
      });
    }
  }

  async removeCodexAccount(accountId: string): Promise<ClaudeSubscriptionActionResult> {
    const repository = this.#codexAccounts;
    if (!repository) {
      return parseClaudeSubscriptionActionResult({
        ok: false,
        snapshot: await this.#readSnapshot(),
        error: operationError('runtime_unavailable', true)
      });
    }
    try {
      await repository.remove(accountId);
      await this.refreshCodexAccounts();
      this.#codexProbedAt = 0;
      return parseClaudeSubscriptionActionResult({ ok: true, snapshot: await this.#readSnapshot() });
    } catch {
      return parseClaudeSubscriptionActionResult({
        ok: false,
        snapshot: await this.#readSnapshot(),
        error: operationError('codex_account_failed', true)
      });
    }
  }

  /**
   * Resolving the Codex credential loads pi and reads the auth file, which is far too
   * slow to sit in snapshot creation — snapshots are published on every account and
   * routing change. The last known answer is served immediately and a refresh is fired
   * in the background, so the panel converges instead of stalling.
   */
  #maybeProbeCodexUpstream(): void {
    const upstream = this.#codexUpstream;
    if (!upstream || this.#codexProbeInFlight) return;
    if (this.#codexProbedAt !== 0 && this.#now() - this.#codexProbedAt < CODEX_PROBE_TTL_MS) return;
    this.#codexProbeInFlight = true;
    void upstream
      .isAvailable()
      .catch(() => false)
      .then((connected) => {
        this.#codexProbedAt = this.#now();
        this.#codexProbeInFlight = false;
        // Republish only on a change: an unconditional publish here would be observed
        // by the next snapshot, which probes again, which publishes again.
        if (connected === this.#codexConnected) return;
        this.#codexConnected = connected;
        void this.#publishSnapshot().catch(() => undefined);
      });
  }

  /**
   * Claude entries plus the GPT models the Codex runtime can serve. Effort lists
   * differ per model — `gpt-5.6-sol` accepts only medium..xhigh — so each entry
   * carries its own rather than sharing one list.
   */
  #catalogEntries(): ClaudeSubscriptionCatalogEntry[] {
    return sortSub2ApiCatalogEntries([
      ...claudeSubscriptionCatalogEntries(),
      // Owner decision (2026-08-31): only the 5.6 family is offered. gpt-5.5 stays in
      // the runtime for Translator and the credential probe, but is not advertised.
      ...CODEX_RUNTIME_MODELS.filter((slug) => slug !== 'gpt-5.5').map((slug) => ({
        slug: slug as string,
        label: slug as string,
        // Client rungs, not pi's: the shift onto pi's ladder happens per request.
        // gpt-5.5 has no `max` in pi's `thinkingLevelMap`, and Codex publishes it with
        // no top rung either, so it advertises one fewer than the rest.
        efforts: CODEX_RUNTIME_MODEL_EFFORTS[slug].some((level) => level === 'max')
          ? SUB2API_CLIENT_EFFORTS
          : SUB2API_CLIENT_EFFORTS.filter((level) => level !== 'ultra'),
        defaultEffort: CODEX_RUNTIME_MODEL_DEFAULT_EFFORT[slug],
        contextWindow: CODEX_RUNTIME_MODEL_CONTEXT_WINDOW[slug],
        maxContextWindow: CODEX_RUNTIME_MODEL_MAX_CONTEXT_WINDOW[slug],
        description: 'GPT through the Bitterless local Codex subscription'
      }))
    ]);
  }

  #serverPortOrDefault(): number {
    try {
      return this.#repository.serverPort();
    } catch {
      return CLAUDE_SUBSCRIPTION_DEFAULT_PORT;
    }
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
        // Degraded snapshots can precede initialization, so the configured port
        // may not be readable yet; the default keeps the shape valid.
        port: this.#serverPortOrDefault()
      },
      authFlow: null,
      codexUpstream: {
        connected: this.#codexConnected,
        models: [...CODEX_RUNTIME_MODELS],
        accounts: this.#codexAccountViews.map((account) => ({ ...account }))
      }
    });
  }
}
