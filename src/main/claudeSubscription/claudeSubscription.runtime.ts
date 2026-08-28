import { spawn } from 'node:child_process';
import path from 'node:path';
import { app, clipboard } from 'electron';
import { xpcMain } from 'electron-xpc/main';
import type {
  ClaudeSubscriptionActionResult,
  ClaudeSubscriptionAdoptableSlot,
  ClaudeSubscriptionCopyResult,
  ClaudeSubscriptionSnapshot
} from '@shared/claudeSubscription/claudeSubscription.contract';
import { CLAUDE_SUBSCRIPTION_SNAPSHOT_CHANGED_EVENT } from '@shared/claudeSubscription/claudeSubscription.contract';
import { resolveClaudeExecutable } from '@main/eyesOnAgents/claudeExecutable.resolver';
import { ClaudeAccountRepository } from './claudeAccount.repository';
import { ClaudeAccountRouter } from './claudeAccount.router';
import { ElectronClaudeAuthBrowserFactory } from './claudeAuth.browser';
import { ClaudeCliAccountAuth } from './claudeAuth.command';
import { ClaudeAuthorizationCoordinator } from './claudeAuth.coordinator';
import { ScriptClaudeAuthLoginPtyFactory } from './claudeAuthLogin.pty';
import { probeClaudeCliCapabilities } from './claudeCli.capability';
import {
  ClaudeCliExecutor,
  type ClaudeExecutionResult,
  type ClaudeExecutor
} from './claudeCli.executor';
import { ClaudeResponsesRuntime, ClaudeResponsesServer } from './claudeResponses.server';
import { ClaudeExecutionError } from './claudeSubscription.errors';
import { ClaudeSubscriptionService } from './claudeSubscription.service';

class UnavailableClaudeExecutor implements ClaudeExecutor {
  async execute(): Promise<ClaudeExecutionResult> {
    throw new ClaudeExecutionError('The Claude CLI executable is unavailable.');
  }
}

export type ClaudeSubscriptionServiceFactory = () => Promise<ClaudeSubscriptionService>;

const createDefaultClaudeSubscriptionService = async (): Promise<ClaudeSubscriptionService> => {
  const resolvedExecutable = resolveClaudeExecutable({
    homePath: app.getPath('home'),
    pathValue: process.env.PATH
  });
  const capability = resolvedExecutable
    ? await probeClaudeCliCapabilities(resolvedExecutable)
    : { canonicalExecutable: null, isolatedCredentialStorage: false };
  const claudeExecutable = capability.isolatedCredentialStorage
    ? capability.canonicalExecutable
    : null;
  const repository = new ClaudeAccountRepository({
    rootDirectory: path.join(app.getPath('userData'), 'claude-subscription'),
    homeDirectory: app.getPath('home'),
    isolatedCredentialStorageAvailable: claudeExecutable !== null
  });
  let service: ClaudeSubscriptionService | null = null;
  const router = new ClaudeAccountRouter(repository, {
    onStateChanged: () => service?.routingStateChanged()
  });
  const executor: ClaudeExecutor = claudeExecutable
    ? new ClaudeCliExecutor({ claudeExecutable })
    : new UnavailableClaudeExecutor();
  const spawnProcess = (
    command: string,
    arguments_: readonly string[],
    environment: Readonly<Record<string, string>>,
    cwd: string
  ) =>
    spawn(command, [...arguments_], {
      cwd,
      env: { ...environment },
      stdio: ['pipe', 'pipe', 'pipe']
    });
  const authCli = claudeExecutable
    ? new ClaudeCliAccountAuth({ claudeExecutable, spawnProcess })
    : null;
  const responsesRuntime = new ClaudeResponsesRuntime(router, executor);
  const server = new ClaudeResponsesServer(router, responsesRuntime);
  const browserFactory = new ElectronClaudeAuthBrowserFactory();

  const authorization = new ClaudeAuthorizationCoordinator({
    repository,
    ptyFactory: claudeExecutable ? new ScriptClaudeAuthLoginPtyFactory({ claudeExecutable }) : null,
    authCli,
    browserFactory,
    onFlowChanged: (flow) => service?.authorizationFlowChanged(flow),
    onAccountSaved: (account) => service?.authorizationAccountSaved(account.id),
    onFlowError: () => service?.authorizationFlowFailed()
  });
  service = new ClaudeSubscriptionService({
    repository,
    router,
    executor,
    server,
    authorization,
    authCli,
    browserFactory,
    writeClipboard: (text) => clipboard.writeText(text),
    broadcastSnapshot: (snapshot) =>
      xpcMain.broadcast(CLAUDE_SUBSCRIPTION_SNAPSHOT_CHANGED_EVENT, snapshot)
  });
  return service;
};

export class ClaudeSubscriptionMainRuntime {
  readonly #createService: ClaudeSubscriptionServiceFactory;
  #servicePromise: Promise<ClaudeSubscriptionService> | null = null;
  #startPromise: Promise<ClaudeSubscriptionSnapshot> | null = null;
  #stopPromise: Promise<void> | null = null;

  constructor(
    createService: ClaudeSubscriptionServiceFactory = createDefaultClaudeSubscriptionService
  ) {
    this.#createService = createService;
  }

  async start(): Promise<ClaudeSubscriptionSnapshot> {
    if (this.#stopPromise) await this.#stopPromise;
    if (!this.#startPromise) {
      this.#startPromise = this.#service().then(async (service) => await service.start());
    }
    const pending = this.#startPromise;
    try {
      return await pending;
    } finally {
      if (this.#startPromise === pending) this.#startPromise = null;
    }
  }

  async stop(): Promise<void> {
    if (this.#stopPromise) return await this.#stopPromise;
    if (!this.#servicePromise) return;
    this.#stopPromise = this.#stopInternal();
    try {
      await this.#stopPromise;
    } finally {
      this.#stopPromise = null;
    }
  }

  async getSnapshot(): Promise<ClaudeSubscriptionSnapshot> {
    return await (await this.#service()).getSnapshot();
  }

  async startAuthorization(value: unknown): Promise<ClaudeSubscriptionActionResult> {
    return await (await this.#service()).startAuthorization(value);
  }

  async submitAuthorizationCode(value: unknown): Promise<ClaudeSubscriptionActionResult> {
    return await (await this.#service()).submitAuthorizationCode(value);
  }

  async cancelAuthorization(value: unknown): Promise<ClaudeSubscriptionActionResult> {
    return await (await this.#service()).cancelAuthorization(value);
  }

  async renameAccount(value: unknown): Promise<ClaudeSubscriptionActionResult> {
    return await (await this.#service()).renameAccount(value);
  }

  async setAccountEnabled(value: unknown): Promise<ClaudeSubscriptionActionResult> {
    return await (await this.#service()).setAccountEnabled(value);
  }

  async adoptAccount(value: unknown): Promise<ClaudeSubscriptionActionResult> {
    return await (await this.#service()).adoptAccount(value);
  }

  async listAdoptableSlots(): Promise<ClaudeSubscriptionAdoptableSlot[]> {
    return await (await this.#service()).listAdoptableSlots();
  }

  async testAccount(value: unknown): Promise<ClaudeSubscriptionActionResult> {
    return await (await this.#service()).testAccount(value);
  }

  async removeAccount(value: unknown): Promise<ClaudeSubscriptionActionResult> {
    return await (await this.#service()).removeAccount(value);
  }

  async copyCodexProfile(): Promise<ClaudeSubscriptionCopyResult> {
    return await (await this.#service()).copyCodexProfile();
  }

  async #stopInternal(): Promise<void> {
    const starting = this.#startPromise;
    const servicePromise = this.#servicePromise;
    if (!servicePromise) return;
    const service = await servicePromise;
    await service.stop();
    if (starting) await starting.catch(() => undefined);
  }

  #service(): Promise<ClaudeSubscriptionService> {
    if (!this.#servicePromise) {
      this.#servicePromise = this.#createService().catch((error) => {
        this.#servicePromise = null;
        throw error;
      });
    }
    return this.#servicePromise;
  }
}

export const claudeSubscriptionRuntime = new ClaudeSubscriptionMainRuntime();
