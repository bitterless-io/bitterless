import { randomUUID } from 'node:crypto';
import type {
  ClaudeSubscriptionAccountView,
  ClaudeSubscriptionAuthFlowStatus,
  ClaudeSubscriptionAuthFlowView,
  ClaudeSubscriptionOperationErrorCode,
  ClaudeSubscriptionStartAuthInput
} from '@shared/claudeSubscription/claudeSubscription.contract';
import { redactClaudeSubscriptionSecrets } from '@shared/claudeSubscription/claudeSubscription.redaction';
import type {
  ClaudeAccountExecutionContext,
  ClaudeAccountIdentity,
  ClaudeAccountRepository
} from './claudeAccount.repository';
import type { ClaudeAuthBrowserFactory, ClaudeAuthBrowserSession } from './claudeAuth.browser';
import type { ClaudeAccountAuthCli } from './claudeAuth.command';
import {
  hasClaudeManualCodePrompt,
  parseClaudeAuthorizationOutputChunk
} from './claudeAuthLogin.parser';
import type {
  ClaudeAuthLoginPty,
  ClaudeAuthLoginPtyExit,
  ClaudeAuthLoginPtyFactory
} from './claudeAuthLogin.pty';
import {
  ClaudeAuthenticationError,
  ClaudeSubscriptionRequiredError
} from './claudeSubscription.errors';

export class ClaudeAuthorizationError extends Error {
  constructor(
    readonly code: ClaudeSubscriptionOperationErrorCode,
    readonly retryable: boolean
  ) {
    super(code);
    this.name = 'ClaudeAuthorizationError';
  }
}

export interface ClaudeAuthorizationCoordinatorOptions {
  repository: ClaudeAccountRepository;
  ptyFactory: ClaudeAuthLoginPtyFactory | null;
  authCli: ClaudeAccountAuthCli | null;
  browserFactory: ClaudeAuthBrowserFactory;
  timeoutMs?: number;
  maximumOutputBytes?: number;
  createFlowId?: () => string;
  onFlowChanged?(flow: ClaudeSubscriptionAuthFlowView | null): void;
  onAccountSaved?(account: ClaudeSubscriptionAccountView): void;
  onFlowError?(error: ClaudeAuthorizationError): void;
}

interface ActiveClaudeAuthorizationFlow {
  flowId: string;
  identity: ClaudeAccountIdentity;
  label: string;
  isNewAccount: boolean;
  pty: ClaudeAuthLoginPty;
  browser: ClaudeAuthBrowserSession | null;
  parserOutput: string;
  pendingAuthorizationTail: string;
  outputBytes: number;
  status: ClaudeSubscriptionAuthFlowStatus;
  canSubmitCode: boolean;
  codeSubmitted: boolean;
  terminal: boolean;
  closingInternally: boolean;
  ioClosed: boolean;
  timeout: NodeJS.Timeout;
  removeDataListener: () => void;
  removeExitListener: () => void;
  completionPromise: Promise<void> | null;
}

const DEFAULT_TIMEOUT_MS = 10 * 60_000;
const DEFAULT_MAXIMUM_OUTPUT_BYTES = 1024 * 1024;
const PARSER_TAIL_CHARACTERS = 64 * 1024;

const operationErrorView = (
  error: ClaudeAuthorizationError
): { code: ClaudeSubscriptionOperationErrorCode; retryable: boolean } => ({
  code: error.code,
  retryable: error.retryable
});

const executionContext = (identity: ClaudeAccountIdentity): ClaudeAccountExecutionContext => ({
  configDirectory: identity.configDirectory,
  secureStorageConfigDirectory: identity.secureStorageConfigDirectory,
  anthropicConfigDirectory: identity.anthropicConfigDirectory
});

const mapVerificationError = (error: unknown): ClaudeAuthorizationError => {
  if (error instanceof ClaudeAuthorizationError) return error;
  if (error instanceof ClaudeSubscriptionRequiredError) {
    return new ClaudeAuthorizationError('subscription_required', false);
  }
  if (error instanceof ClaudeAuthenticationError) {
    return new ClaudeAuthorizationError('claude_authentication', true);
  }
  return new ClaudeAuthorizationError('claude_authentication', true);
};

export class ClaudeAuthorizationCoordinator {
  readonly #repository: ClaudeAccountRepository;
  readonly #ptyFactory: ClaudeAuthLoginPtyFactory | null;
  readonly #authCli: ClaudeAccountAuthCli | null;
  readonly #browserFactory: ClaudeAuthBrowserFactory;
  readonly #timeoutMs: number;
  readonly #maximumOutputBytes: number;
  readonly #createFlowId: () => string;
  readonly #onFlowChanged: (flow: ClaudeSubscriptionAuthFlowView | null) => void;
  readonly #onAccountSaved: (account: ClaudeSubscriptionAccountView) => void;
  readonly #onFlowError: (error: ClaudeAuthorizationError) => void;
  #active: ActiveClaudeAuthorizationFlow | null = null;
  #startPromise: Promise<ClaudeSubscriptionAuthFlowView> | null = null;
  #stopPromise: Promise<void> | null = null;
  #lifecycle = 0;

  constructor(options: ClaudeAuthorizationCoordinatorOptions) {
    this.#repository = options.repository;
    this.#ptyFactory = options.ptyFactory;
    this.#authCli = options.authCli;
    this.#browserFactory = options.browserFactory;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#maximumOutputBytes = options.maximumOutputBytes ?? DEFAULT_MAXIMUM_OUTPUT_BYTES;
    this.#createFlowId = options.createFlowId ?? randomUUID;
    this.#onFlowChanged = options.onFlowChanged ?? (() => undefined);
    this.#onAccountSaved = options.onAccountSaved ?? (() => undefined);
    this.#onFlowError = options.onFlowError ?? (() => undefined);
  }

  currentFlow(): ClaudeSubscriptionAuthFlowView | null {
    return this.#active ? this.#flowView(this.#active) : null;
  }

  start(input: ClaudeSubscriptionStartAuthInput): Promise<ClaudeSubscriptionAuthFlowView> {
    if (this.#active || this.#startPromise || this.#stopPromise) {
      return Promise.reject(new ClaudeAuthorizationError('auth_busy', false));
    }
    if (!this.#repository.isolatedCredentialStorageAvailable()) {
      return Promise.reject(new ClaudeAuthorizationError('secure_storage_unavailable', true));
    }
    if (!this.#ptyFactory || !this.#authCli) {
      return Promise.reject(new ClaudeAuthorizationError('claude_cli_unavailable', true));
    }

    const lifecycle = this.#lifecycle;
    const pending = this.#startInternal(input, lifecycle);
    this.#startPromise = pending;
    return pending.finally(() => {
      if (this.#startPromise === pending) this.#startPromise = null;
    });
  }

  async #startInternal(
    input: ClaudeSubscriptionStartAuthInput,
    lifecycle: number
  ): Promise<ClaudeSubscriptionAuthFlowView> {
    const ptyFactory = this.#ptyFactory;
    if (!ptyFactory) throw new ClaudeAuthorizationError('claude_cli_unavailable', true);
    let identity: ClaudeAccountIdentity | null = null;
    let isNewAccount = false;
    try {
      const existing = input.accountId ? this.#repository.getIdentity(input.accountId) : null;
      if (input.accountId && !existing) {
        throw new ClaudeAuthorizationError('account_not_found', false);
      }
      identity = existing ?? (await this.#repository.createIdentity());
      isNewAccount = !existing;
      if (lifecycle !== this.#lifecycle) {
        throw new ClaudeAuthorizationError('auth_cancelled', true);
      }

      let label = input.label;
      if (existing) {
        const account = (await this.#repository.listAccounts()).find(
          (candidate) => candidate.id === existing.id
        );
        if (!account) throw new ClaudeAuthorizationError('account_not_found', false);
        label = account.label;
      }
      if (lifecycle !== this.#lifecycle) {
        throw new ClaudeAuthorizationError('auth_cancelled', true);
      }

      let pty: ClaudeAuthLoginPty;
      try {
        pty = ptyFactory.spawn({ context: executionContext(identity) });
      } catch (error) {
        if (error instanceof ClaudeAuthorizationError) throw error;
        throw new ClaudeAuthorizationError('claude_cli_unavailable', true);
      }

      const flow: ActiveClaudeAuthorizationFlow = {
        flowId: this.#createFlowId(),
        identity,
        label,
        isNewAccount,
        pty,
        browser: null,
        parserOutput: '',
        pendingAuthorizationTail: '',
        outputBytes: 0,
        status: 'starting',
        canSubmitCode: false,
        codeSubmitted: false,
        terminal: false,
        closingInternally: false,
        ioClosed: false,
        timeout: setTimeout(() => undefined, this.#timeoutMs),
        removeDataListener: () => undefined,
        removeExitListener: () => undefined,
        completionPromise: null
      };
      clearTimeout(flow.timeout);
      flow.timeout = setTimeout(() => {
        void this.#fail(flow, new ClaudeAuthorizationError('auth_timeout', true));
      }, this.#timeoutMs);
      flow.timeout.unref?.();
      this.#active = flow;
      flow.removeDataListener = pty.onData((data) => this.#consume(flow, data));
      flow.removeExitListener = pty.onExit((result) => {
        void this.#handleExit(flow, result);
      });
      this.#publish(flow, 'starting', false);
      return this.#flowView(flow);
    } catch (error) {
      if (identity && isNewAccount) await this.#clearProvisionalIdentity(identity);
      throw error;
    }
  }

  submitCode(flowId: string, code: string): void {
    const flow = this.#requireActive(flowId);
    if (!flow.canSubmitCode || flow.codeSubmitted || flow.status !== 'awaiting_code') {
      throw new ClaudeAuthorizationError('invalid_authorization_code', true);
    }
    if (!code || code.length > 4_096 || /[\r\n]/u.test(code) || code.includes('\u0000')) {
      throw new ClaudeAuthorizationError('invalid_authorization_code', true);
    }
    flow.codeSubmitted = true;
    flow.parserOutput = '';
    flow.pendingAuthorizationTail = '';
    try {
      flow.pty.writeLine(code);
    } catch {
      void this.#fail(flow, new ClaudeAuthorizationError('authorization_output_invalid', true));
      throw new ClaudeAuthorizationError('authorization_output_invalid', true);
    }
    this.#publish(flow, 'awaiting_code', false);
  }

  async cancel(flowId: string): Promise<void> {
    const flow = this.#requireActive(flowId);
    if (flow.status === 'saving') {
      await flow.completionPromise;
      return;
    }
    await this.#fail(flow, new ClaudeAuthorizationError('auth_cancelled', true));
  }

  async stop(): Promise<void> {
    if (this.#stopPromise) return await this.#stopPromise;
    this.#stopPromise = this.#stopInternal();
    try {
      await this.#stopPromise;
    } finally {
      this.#stopPromise = null;
    }
  }

  async #stopInternal(): Promise<void> {
    this.#lifecycle += 1;
    const starting = this.#startPromise;
    const current = this.#active;
    if (current) {
      if (current.status === 'saving') {
        await this.#closeIo(current).catch(() => undefined);
        await current.completionPromise;
      } else {
        await this.#fail(current, new ClaudeAuthorizationError('auth_cancelled', true));
      }
    }
    if (starting) await starting.catch(() => undefined);
    const startedAfterFence = this.#active;
    if (startedAfterFence) {
      await this.#fail(startedAfterFence, new ClaudeAuthorizationError('auth_cancelled', true));
    }
  }

  #consume(flow: ActiveClaudeAuthorizationFlow, data: Buffer): void {
    if (!this.#isCurrent(flow) || flow.terminal || flow.status === 'saving') {
      data.fill(0);
      return;
    }
    try {
      flow.outputBytes += data.length;
      if (flow.outputBytes > this.#maximumOutputBytes) {
        void this.#fail(flow, new ClaudeAuthorizationError('authorization_output_invalid', true));
        return;
      }
      if (flow.codeSubmitted) {
        flow.parserOutput = '';
        flow.pendingAuthorizationTail = '';
        return;
      }
      const parsed = parseClaudeAuthorizationOutputChunk(
        flow.pendingAuthorizationTail,
        data.toString('utf8')
      );
      flow.pendingAuthorizationTail = parsed.pendingAuthorizationTail;
      const parserCandidate = `${flow.parserOutput}${redactClaudeSubscriptionSecrets(parsed.completedOutput)}`;
      if (!flow.browser) {
        if (parsed.authorizationUrl) this.#openBrowser(flow, parsed.authorizationUrl);
      }
      if (flow.browser && !flow.codeSubmitted && hasClaudeManualCodePrompt(parserCandidate)) {
        this.#publish(flow, 'awaiting_code', true);
      }
      flow.parserOutput = parserCandidate.slice(-PARSER_TAIL_CHARACTERS);
    } finally {
      data.fill(0);
    }
  }

  async #handleExit(
    flow: ActiveClaudeAuthorizationFlow,
    result: ClaudeAuthLoginPtyExit
  ): Promise<void> {
    if (!this.#isCurrent(flow) || flow.terminal || flow.status === 'saving') return;
    if (!result.error && result.exitCode === 0) {
      flow.completionPromise = this.#complete(flow);
      await flow.completionPromise;
      return;
    }
    await this.#fail(flow, new ClaudeAuthorizationError('authorization_output_invalid', true));
  }

  #openBrowser(flow: ActiveClaudeAuthorizationFlow, authorizationUrl: URL): void {
    if (!this.#isCurrent(flow) || flow.terminal) return;
    try {
      flow.browser = this.#browserFactory.open({
        partition: flow.identity.partition,
        authorizationUrl,
        onClosed: () => {
          if (!flow.closingInternally && this.#isCurrent(flow) && !flow.terminal) {
            void this.#fail(flow, new ClaudeAuthorizationError('auth_cancelled', true));
          }
        },
        onFailed: () => {
          if (this.#isCurrent(flow) && !flow.terminal) {
            void this.#fail(flow, new ClaudeAuthorizationError('browser_open_failed', true));
          }
        }
      });
      this.#publish(flow, 'browser_open', false);
    } catch {
      void this.#fail(flow, new ClaudeAuthorizationError('browser_open_failed', true));
    }
  }

  async #complete(flow: ActiveClaudeAuthorizationFlow): Promise<void> {
    if (!this.#isCurrent(flow) || flow.terminal) return;
    const authCli = this.#authCli;
    if (!authCli) {
      await this.#fail(flow, new ClaudeAuthorizationError('claude_cli_unavailable', true));
      return;
    }
    flow.status = 'saving';
    flow.canSubmitCode = false;
    this.#publish(flow, 'saving', false);
    const context = executionContext(flow.identity);
    let verificationComplete = false;
    let account: ClaudeSubscriptionAccountView;
    try {
      await this.#closeIo(flow);
      flow.parserOutput = '';
      flow.pendingAuthorizationTail = '';
      const status = await authCli.verify(context);
      verificationComplete = true;
      account = await this.#repository.saveAccount(flow.identity, flow.label, {
        ...(status.email ? { email: status.email } : {}),
        subscriptionType: status.subscriptionType
      });
    } catch (error) {
      await this.#fail(
        flow,
        verificationComplete
          ? new ClaudeAuthorizationError('account_save_failed', true)
          : mapVerificationError(error)
      );
      return;
    }
    flow.terminal = true;
    if (this.#active === flow) this.#active = null;
    this.#onAccountSaved(account);
    this.#onFlowChanged(null);
  }

  async #fail(flow: ActiveClaudeAuthorizationFlow, error: ClaudeAuthorizationError): Promise<void> {
    if (!this.#isCurrent(flow) || flow.terminal) return;
    if (error.code !== 'auth_cancelled') {
      this.#onFlowChanged({
        ...this.#flowView(flow),
        canSubmitCode: false,
        error: operationErrorView(error)
      });
    }
    flow.terminal = true;
    flow.parserOutput = '';
    flow.pendingAuthorizationTail = '';
    await this.#closeIo(flow).catch(() => undefined);
    if (flow.isNewAccount) {
      if (this.#authCli) {
        await this.#authCli.logout(executionContext(flow.identity)).catch(() => undefined);
      }
      await this.#clearProvisionalIdentity(flow.identity);
    }
    if (this.#active === flow) this.#active = null;
    if (error.code !== 'auth_cancelled') this.#onFlowError(error);
    this.#onFlowChanged(null);
  }

  async #closeIo(flow: ActiveClaudeAuthorizationFlow): Promise<void> {
    if (flow.ioClosed) return;
    flow.ioClosed = true;
    clearTimeout(flow.timeout);
    flow.removeDataListener();
    flow.removeExitListener();
    flow.closingInternally = true;
    flow.browser?.close();
    flow.browser = null;
    await flow.pty.kill();
  }

  async #clearProvisionalIdentity(identity: ClaudeAccountIdentity): Promise<void> {
    try {
      await this.#browserFactory.clear(identity.partition);
    } catch {
      // Continue with the exact managed directory cleanup even if Chromium storage is unavailable.
    }
    try {
      await this.#repository.discardIdentity(identity);
    } catch {
      // The identity is absent from the registry; startup can retry managed-directory cleanup.
    }
  }

  #publish(
    flow: ActiveClaudeAuthorizationFlow,
    status: ClaudeSubscriptionAuthFlowStatus,
    canSubmitCode: boolean
  ): void {
    if (!this.#isCurrent(flow) || flow.terminal) return;
    flow.status = status;
    flow.canSubmitCode = canSubmitCode;
    this.#onFlowChanged(this.#flowView(flow));
  }

  #flowView(flow: ActiveClaudeAuthorizationFlow): ClaudeSubscriptionAuthFlowView {
    return {
      flowId: flow.flowId,
      accountId: flow.identity.id,
      status: flow.status,
      canSubmitCode: flow.canSubmitCode
    };
  }

  #requireActive(flowId: string): ActiveClaudeAuthorizationFlow {
    if (!this.#active || this.#active.flowId !== flowId || this.#active.terminal) {
      throw new ClaudeAuthorizationError('auth_flow_not_found', false);
    }
    return this.#active;
  }

  #isCurrent(flow: ActiveClaudeAuthorizationFlow): boolean {
    return this.#active === flow;
  }
}
