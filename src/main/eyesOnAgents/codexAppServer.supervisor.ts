import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { constants as fsConstants, accessSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type {
  EyesOnAgentsConnectionState,
  EyesOnAgentsConnectionStatus
} from '@shared/eyesOnAgents/eyesOnAgents.type';
import { isEyesOnAgentsRecord } from '@shared/eyesOnAgents/eyesOnAgents.contract';

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

interface AppServerConnection {
  generation: number;
  child: ChildProcessWithoutNullStreams;
  stdoutBuffer: string;
  stderrTail: string;
  pending: Map<number, PendingRequest>;
  disconnecting: boolean;
}

export type CodexHookTrustStatus =
  | 'managed'
  | 'untrusted'
  | 'trusted'
  | 'modified'
  | 'unknown';

export interface CodexHookDefinition {
  command: string | null;
  enabled: boolean;
  eventName: string;
  handlerType: string;
  matcher: string | null;
  trustStatus: CodexHookTrustStatus;
}

type SpawnAppServer = (
  executable: string,
  args: string[]
) => ChildProcessWithoutNullStreams;

export interface CodexAppServerSupervisorOptions {
  executable?: string;
  spawnAppServer?: SpawnAppServer;
  requestTimeoutMs?: number;
  now?: () => number;
  onNotification?: (method: string, params: unknown) => Promise<void> | void;
  onStatusChanged?: () => void;
}

const MAX_FRAME_BYTES = 4 * 1024 * 1024;
const MAX_THREADS = 10_000;
const MAX_PAGES = 100;
const MAX_HOOKS = 1_000;
const MAX_HOOK_TEXT_LENGTH = 8_192;
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

const fixedCodexCandidates = (): string[] => {
  const home = homedir();
  const candidates = process.platform === 'win32'
    ? [
        join(
          process.env.LOCALAPPDATA ?? '',
          'Programs',
          'ChatGPT',
          'resources',
          'codex.exe'
        ),
        join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Codex', 'resources', 'codex.exe'),
        join(home, '.local', 'bin', 'codex.exe')
      ]
    : [
        '/Applications/ChatGPT.app/Contents/Resources/codex',
        '/Applications/Codex.app/Contents/Resources/codex',
        '/opt/homebrew/bin/codex',
        '/usr/local/bin/codex',
        join(home, '.local', 'bin', 'codex'),
        join(home, '.cargo', 'bin', 'codex')
      ];
  return candidates.filter(Boolean);
};

export const resolveCodexAppServerExecutable = (): string => {
  for (const candidate of fixedCodexCandidates()) {
    if (!existsSync(candidate)) continue;
    try {
      accessSync(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // Keep looking for an executable fixed candidate.
    }
  }
  // A shell is never used. This final fixed command lets normal CLI PATH installations work.
  return process.platform === 'win32' ? 'codex.exe' : 'codex';
};

const defaultSpawnAppServer: SpawnAppServer = (executable, args) => {
  return spawn(executable, args, {
    env: process.env,
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true
  });
};

const errorMessage = (value: unknown): string => {
  if (isEyesOnAgentsRecord(value)) {
    if (typeof value.message === 'string' && value.message.trim()) return value.message.trim();
    if (isEyesOnAgentsRecord(value.error) && typeof value.error.message === 'string') {
      return value.error.message;
    }
  }
  return 'Codex App Server request failed';
};

const parseHookText = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || value.length > MAX_HOOK_TEXT_LENGTH) {
    throw new Error(`Codex hooks/list ${label} is invalid`);
  }
  return value;
};

const parseNullableHookText = (value: unknown, label: string): string | null => {
  if (value === null || value === undefined) return null;
  return parseHookText(value, label);
};

const parseHookTrustStatus = (value: unknown): CodexHookTrustStatus => {
  if (value === 'managed' || value === 'untrusted' || value === 'trusted' || value === 'modified') {
    return value;
  }
  return 'unknown';
};

const parseHookDefinition = (value: unknown, index: number): CodexHookDefinition => {
  if (!isEyesOnAgentsRecord(value)) {
    throw new Error(`Codex hooks/list hook ${index} is invalid`);
  }
  if (typeof value.enabled !== 'boolean') {
    throw new Error(`Codex hooks/list hook ${index} enabled flag is invalid`);
  }
  return {
    command: parseNullableHookText(value.command, `hook ${index} command`),
    enabled: value.enabled,
    eventName: parseHookText(value.eventName, `hook ${index} eventName`),
    handlerType: parseHookText(value.handlerType, `hook ${index} handlerType`),
    matcher: parseNullableHookText(value.matcher, `hook ${index} matcher`),
    trustStatus: parseHookTrustStatus(value.trustStatus)
  };
};

export class CodexAppServerSupervisor {
  private readonly executable: string;
  private readonly spawnAppServer: SpawnAppServer;
  private readonly requestTimeoutMs: number;
  private readonly now: () => number;
  private connection: AppServerConnection | null = null;
  private generation = 0;
  private nextRequestId = 0;
  private connectPromise: Promise<void> | null = null;
  private disconnectPromise: Promise<void> | null = null;
  private state: EyesOnAgentsConnectionState = 'disconnected';
  private lastSyncedAt: number | null = null;
  private lastError: string | null = null;

  constructor(private readonly options: CodexAppServerSupervisorOptions = {}) {
    this.executable = options.executable ?? resolveCodexAppServerExecutable();
    this.spawnAppServer = options.spawnAppServer ?? defaultSpawnAppServer;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.now = options.now ?? Date.now;
  }

  isConnected(): boolean {
    return this.connection !== null && (this.state === 'connected' || this.state === 'syncing');
  }

  getStatus(autoConnectEnabled: boolean): EyesOnAgentsConnectionStatus {
    return {
      state: this.state,
      lastSyncedAt: this.lastSyncedAt === null
        ? null
        : new Date(this.lastSyncedAt).toISOString(),
      error: this.lastError,
      autoConnectEnabled
    };
  }

  private setStatus(state: EyesOnAgentsConnectionState, error: string | null = null): void {
    this.state = state;
    this.lastError = error;
    this.options.onStatusChanged?.();
  }

  async connect(): Promise<void> {
    if (this.connectPromise) return await this.connectPromise;
    if (this.connection && this.state !== 'error') return;
    if (this.disconnectPromise) await this.disconnectPromise;
    this.connectPromise = this.performConnect();
    try {
      await this.connectPromise;
    } finally {
      this.connectPromise = null;
    }
  }

  private async performConnect(): Promise<void> {
    const previous = this.connection;
    if (previous) {
      previous.disconnecting = true;
      this.connection = null;
      this.rejectPending(previous, new Error('Codex App Server is reconnecting'));
      await this.terminateConnection(previous);
    }
    this.setStatus('connecting');
    let child: ChildProcessWithoutNullStreams;
    try {
      child = this.spawnAppServer(this.executable, ['app-server', '--stdio']);
    } catch (error) {
      const message = `Unable to start Codex App Server: ${error instanceof Error ? error.message : String(error)}`;
      this.setStatus('error', message);
      throw new Error(message);
    }
    const connection: AppServerConnection = {
      generation: ++this.generation,
      child,
      stdoutBuffer: '',
      stderrTail: '',
      pending: new Map(),
      disconnecting: false
    };
    this.connection = connection;
    child.stdout.on('data', (chunk: Buffer) => this.handleStdout(connection, chunk));
    child.stderr.on('data', (chunk: Buffer) => this.handleStderr(connection, chunk));
    child.stdin.on('error', (error) => this.handleProcessFailure(connection, error));
    child.once('error', (error) => this.handleProcessFailure(connection, error));
    child.once('close', (code, signal) => this.handleClose(connection, code, signal));

    try {
      await this.request(connection, 'initialize', {
        clientInfo: { name: 'bitterless', title: 'Bitterless EyesOnAgents', version: '1' },
        capabilities: null
      });
      this.notify(connection, 'initialized');
      if (this.connection === connection) this.setStatus('connected');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (this.connection === connection) {
        this.connection = null;
        this.setStatus('error', message);
      }
      connection.disconnecting = true;
      this.rejectPending(connection, new Error(message));
      await this.terminateConnection(connection);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.disconnectPromise) return await this.disconnectPromise;
    this.disconnectPromise = this.performDisconnect();
    try {
      await this.disconnectPromise;
    } finally {
      this.disconnectPromise = null;
    }
  }

  private async performDisconnect(): Promise<void> {
    const connection = this.connection;
    if (connection) {
      connection.disconnecting = true;
      this.connection = null;
      this.rejectPending(connection, new Error('Codex App Server disconnected'));
      await this.terminateConnection(connection);
    }
    if (this.connection === null) this.setStatus('disconnected');
  }

  private terminateConnection(connection: AppServerConnection): Promise<void> {
    const child = connection.child;
    if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
    return new Promise((resolve) => {
      let settled = false;
      let forceTimer: NodeJS.Timeout | null = null;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        if (forceTimer) clearTimeout(forceTimer);
        child.removeListener('close', finish);
        resolve();
      };
      child.once('close', finish);
      forceTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
        finish();
      }, 500);
      forceTimer.unref();
      child.kill('SIGTERM');
    });
  }

  async listThreads(): Promise<unknown[]> {
    return await this.listThreadInventory(false);
  }

  async listArchivedThreads(): Promise<unknown[]> {
    return await this.listThreadInventory(true);
  }

  private async listThreadInventory(archived: boolean): Promise<unknown[]> {
    const connection = this.connection;
    if (!connection || this.state === 'disconnected' || this.state === 'connecting') {
      throw new Error('Codex App Server is not connected');
    }
    this.setStatus('syncing');
    const threads: unknown[] = [];
    let cursor: string | null = null;
    let pageCount = 0;
    try {
      do {
        pageCount += 1;
        if (pageCount > MAX_PAGES) {
          throw new Error(`Codex thread/list exceeded ${MAX_PAGES} pages`);
        }
        const result = await this.request(connection, 'thread/list', {
          archived,
          cursor,
          limit: 100,
          useStateDbOnly: true
        });
        if (!isEyesOnAgentsRecord(result) || !Array.isArray(result.data)) {
          throw new Error('Codex thread/list response is invalid');
        }
        threads.push(...result.data);
        if (threads.length > MAX_THREADS) {
          throw new Error(`Codex thread/list exceeded ${MAX_THREADS} entries`);
        }
        if (
          result.nextCursor !== null &&
          result.nextCursor !== undefined &&
          typeof result.nextCursor !== 'string'
        ) {
          throw new Error('Codex thread/list nextCursor is invalid');
        }
        cursor = typeof result.nextCursor === 'string' && result.nextCursor
          ? result.nextCursor
          : null;
      } while (cursor !== null);
      if (this.connection !== connection) {
        throw new Error('Codex App Server connection changed during thread/list');
      }
      this.lastSyncedAt = this.now();
      this.setStatus('connected');
      return threads;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (this.connection === connection) this.setStatus('error', message);
      throw error;
    }
  }

  async listHooks(): Promise<CodexHookDefinition[]> {
    const connection = this.connection;
    if (!connection || !this.isConnected()) {
      throw new Error('Codex App Server is not connected');
    }
    const result = await this.request(connection, 'hooks/list', { cwds: [] });
    if (!isEyesOnAgentsRecord(result) || !Array.isArray(result.data) || result.data.length !== 1) {
      throw new Error('Codex hooks/list response is invalid');
    }
    const entry = result.data[0];
    if (!isEyesOnAgentsRecord(entry) || !Array.isArray(entry.hooks)) {
      throw new Error('Codex hooks/list entry is invalid');
    }
    if (entry.hooks.length > MAX_HOOKS) {
      throw new Error(`Codex hooks/list exceeded ${MAX_HOOKS} entries`);
    }
    return entry.hooks.map((hook, index) => parseHookDefinition(hook, index));
  }

  private request(
    connection: AppServerConnection,
    method: string,
    params?: unknown
  ): Promise<unknown> {
    if (this.connection !== connection) {
      return Promise.reject(new Error('Codex App Server connection is stale'));
    }
    const child = connection.child;
    this.nextRequestId += 1;
    const id = this.nextRequestId;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        connection.pending.delete(id);
        reject(new Error(`Codex App Server ${method} timed out after ${this.requestTimeoutMs}ms`));
      }, this.requestTimeoutMs);
      timeout.unref();
      connection.pending.set(id, { resolve, reject, timeout });
      try {
        child.stdin.write(`${JSON.stringify({ method, id, params })}\n`);
      } catch (error) {
        clearTimeout(timeout);
        connection.pending.delete(id);
        reject(new Error(`Unable to write Codex App Server request: ${String(error)}`));
      }
    });
  }

  private notify(connection: AppServerConnection, method: string, params?: unknown): void {
    if (this.connection !== connection) throw new Error('Codex App Server connection is stale');
    const child = connection.child;
    const message = params === undefined ? { method } : { method, params };
    child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private handleStdout(connection: AppServerConnection, chunk: Buffer): void {
    if (this.connection !== connection) return;
    connection.stdoutBuffer += chunk.toString('utf8');
    if (Buffer.byteLength(connection.stdoutBuffer, 'utf8') > MAX_FRAME_BYTES) {
      this.handleProcessFailure(connection, new Error('Codex App Server frame exceeded the size limit'));
      return;
    }
    let newline = connection.stdoutBuffer.indexOf('\n');
    while (newline >= 0) {
      if (this.connection !== connection) return;
      const line = connection.stdoutBuffer.slice(0, newline).trim();
      connection.stdoutBuffer = connection.stdoutBuffer.slice(newline + 1);
      if (line) {
        try {
          this.handleMessage(connection, JSON.parse(line) as unknown);
        } catch {
          this.handleProcessFailure(connection, new Error('Codex App Server returned invalid JSON'));
          return;
        }
      }
      newline = connection.stdoutBuffer.indexOf('\n');
    }
  }

  private handleStderr(connection: AppServerConnection, chunk: Buffer): void {
    if (this.connection !== connection) return;
    connection.stderrTail = `${connection.stderrTail}${chunk.toString('utf8')}`.slice(-8_192);
  }

  private handleMessage(connection: AppServerConnection, value: unknown): void {
    if (this.connection !== connection) return;
    if (!isEyesOnAgentsRecord(value)) {
      this.handleProcessFailure(connection, new Error('Codex App Server returned a non-object message'));
      return;
    }
    if (typeof value.id === 'number') {
      const pending = connection.pending.get(value.id);
      if (!pending) return;
      clearTimeout(pending.timeout);
      connection.pending.delete(value.id);
      if (value.error !== undefined) pending.reject(new Error(errorMessage(value.error)));
      else pending.resolve(value.result);
      return;
    }
    if (typeof value.method !== 'string') return;
    queueMicrotask(() => {
      if (this.connection !== connection) return;
      void Promise.resolve(this.options.onNotification?.(value.method as string, value.params))
        .catch(() => {
          // A malformed notification must not take down the App Server connection.
        });
    });
  }

  private handleProcessFailure(connection: AppServerConnection, error: Error): void {
    if (this.connection !== connection || connection.disconnecting) return;
    const message = `Codex App Server failed: ${error.message}`;
    this.connection = null;
    this.rejectPending(connection, new Error(message));
    this.setStatus('error', message);
    void this.terminateConnection(connection);
  }

  private handleClose(
    connection: AppServerConnection,
    code: number | null,
    signal: NodeJS.Signals | null
  ): void {
    if (this.connection !== connection) return;
    this.connection = null;
    if (connection.disconnecting) return;
    const detail = connection.stderrTail.trim();
    const message = `Codex App Server exited (${code ?? signal ?? 'unknown'})${detail ? `: ${detail}` : ''}`;
    this.rejectPending(connection, new Error(message));
    this.setStatus('error', message);
  }

  private rejectPending(connection: AppServerConnection, error: Error): void {
    for (const pending of connection.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    connection.pending.clear();
  }
}
