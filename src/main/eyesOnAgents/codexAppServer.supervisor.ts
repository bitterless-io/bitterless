import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { constants as fsConstants, accessSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import type {
  EyesOnAgentsConnectionState,
  EyesOnAgentsConnectionStatus
} from '@shared/eyesOnAgents/eyesOnAgents.type';
import { isEyesOnAgentsRecord } from '@shared/eyesOnAgents/eyesOnAgents.contract';

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
  responseFrameLimitBytes: number;
}

interface AppServerConnection {
  generation: number;
  child: ChildProcessWithoutNullStreams;
  stdoutBuffer: string;
  stdoutBufferBytes: number;
  stdoutDecoder: StringDecoder;
  stderrTail: string;
  pending: Map<number, PendingRequest>;
  disconnecting: boolean;
}

export type CodexHookTrustStatus =
  | 'managed'
  | 'untrusted'
  | 'trusted'
  | 'modified';

export interface CodexHookDefinition {
  command: string | null;
  currentHash: string;
  enabled: boolean;
  eventName: string;
  handlerType: string;
  isManaged: boolean;
  key: string;
  matcher: string | null;
  source: string;
  sourcePath: string;
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
const MAX_FULL_TURN_FRAME_BYTES = 16 * 1024 * 1024;
const MAX_THREADS = 10_000;
const MAX_PAGES = 100;
const MAX_HOOKS = 1_000;
const MAX_HOOK_TEXT_LENGTH = 8_192;
const MAX_TURN_CURSOR_LENGTH = 8_192;
const THREAD_TURN_LIMIT = 10;
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

const responseFrameLimitBytes = (method: string, params: unknown): number => {
  if (
    method === 'thread/turns/list' &&
    isEyesOnAgentsRecord(params) &&
    params.itemsView === 'full'
  ) {
    return MAX_FULL_TURN_FRAME_BYTES;
  }
  return MAX_FRAME_BYTES;
};

const parseTurnCursor = (value: unknown, label: string): string | null => {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || !value || value.length > MAX_TURN_CURSOR_LENGTH) {
    throw new Error(`Codex thread/turns/list ${label} is invalid`);
  }
  return value;
};

const hasUnpairedSurrogate = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!Number.isFinite(next) || next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
};

const turnContainsTextualUserMessage = (turn: unknown): boolean => {
  if (!isEyesOnAgentsRecord(turn) || !Array.isArray(turn.items)) {
    throw new Error('Codex thread/turns/list turn is invalid');
  }
  if (
    Object.prototype.hasOwnProperty.call(turn, 'itemsView') &&
    turn.itemsView !== 'full'
  ) {
    throw new Error('Codex thread/turns/list itemsView is not full');
  }
  for (let itemIndex = turn.items.length - 1; itemIndex >= 0; itemIndex -= 1) {
    const item = turn.items[itemIndex];
    if (!isEyesOnAgentsRecord(item) || item.type !== 'userMessage') continue;
    if (!Array.isArray(item.content)) {
      throw new Error('Codex thread/turns/list userMessage content is invalid');
    }
    const textSegments: string[] = [];
    for (const segment of item.content) {
      if (!isEyesOnAgentsRecord(segment) || segment.type !== 'text') continue;
      if (typeof segment.text !== 'string') {
        throw new Error('Codex thread/turns/list userMessage text is invalid');
      }
      textSegments.push(segment.text);
    }
    const text = textSegments.join('').trim();
    if (text && !text.includes('\0') && !hasUnpairedSurrogate(text)) return true;
  }
  return false;
};

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

const parseAbsoluteHookPath = (value: unknown, label: string): string => {
  const path = parseHookText(value, label);
  if (!isAbsolute(path)) {
    throw new Error(`Codex hooks/list ${label} must be absolute`);
  }
  return path;
};

const parseHookTrustStatus = (value: unknown): CodexHookTrustStatus => {
  if (value === 'managed' || value === 'untrusted' || value === 'trusted' || value === 'modified') {
    return value;
  }
  throw new Error('Codex hooks/list trust status is unsupported');
};

const parseHookDefinition = (value: unknown, index: number): CodexHookDefinition => {
  if (!isEyesOnAgentsRecord(value)) {
    throw new Error(`Codex hooks/list hook ${index} is invalid`);
  }
  if (typeof value.enabled !== 'boolean') {
    throw new Error(`Codex hooks/list hook ${index} enabled flag is invalid`);
  }
  if (typeof value.isManaged !== 'boolean') {
    throw new Error(`Codex hooks/list hook ${index} managed flag is invalid`);
  }
  return {
    command: parseNullableHookText(value.command, `hook ${index} command`),
    currentHash: parseHookText(value.currentHash, `hook ${index} currentHash`),
    enabled: value.enabled,
    eventName: parseHookText(value.eventName, `hook ${index} eventName`),
    handlerType: parseHookText(value.handlerType, `hook ${index} handlerType`),
    isManaged: value.isManaged,
    key: parseHookText(value.key, `hook ${index} key`),
    matcher: parseNullableHookText(value.matcher, `hook ${index} matcher`),
    source: parseHookText(value.source, `hook ${index} source`),
    sourcePath: parseAbsoluteHookPath(value.sourcePath, `hook ${index} sourcePath`),
    trustStatus: parseHookTrustStatus(value.trustStatus)
  };
};

const assertEmptyHookDiagnostics = (value: unknown, label: string): void => {
  if (!Array.isArray(value)) {
    throw new Error(`Codex hooks/list ${label} is invalid`);
  }
  if (value.length > 0) {
    throw new Error(`Codex hooks/list reported ${label}`);
  }
};

const parseBatchWriteResult = (value: unknown): void => {
  if (!isEyesOnAgentsRecord(value)) {
    throw new Error('Codex config/batchWrite response is invalid');
  }
  if (value.status !== 'ok' && value.status !== 'okOverridden') {
    throw new Error('Codex config/batchWrite status is invalid');
  }
  if (typeof value.version !== 'string' || !value.version) {
    throw new Error('Codex config/batchWrite version is invalid');
  }
  if (typeof value.filePath !== 'string' || !isAbsolute(value.filePath)) {
    throw new Error('Codex config/batchWrite filePath is invalid');
  }
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
      stdoutBufferBytes: 0,
      stdoutDecoder: new StringDecoder('utf8'),
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
        capabilities: { experimentalApi: true }
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

  async readThread(threadId: string): Promise<unknown> {
    const connection = this.connection;
    if (!connection || !this.isConnected()) {
      throw new Error('Codex App Server is not connected');
    }
    const result = await this.request(connection, 'thread/read', {
      threadId,
      includeTurns: false
    });
    if (!isEyesOnAgentsRecord(result) || !isEyesOnAgentsRecord(result.thread)) {
      throw new Error('Codex thread/read response is invalid');
    }
    return result.thread;
  }

  async listThreadTurns(threadId: string): Promise<unknown[]> {
    const connection = this.connection;
    if (!connection || !this.isConnected()) {
      throw new Error('Codex App Server is not connected');
    }
    const turns: unknown[] = [];
    const visitedCursors = new Set<string>();
    let cursor: string | null = null;
    for (let page = 0; page < THREAD_TURN_LIMIT; page += 1) {
      const result = await this.request(connection, 'thread/turns/list', {
        threadId,
        cursor,
        itemsView: 'full',
        sortDirection: 'desc',
        limit: 1
      });
      if (
        !isEyesOnAgentsRecord(result) ||
        !Array.isArray(result.data) ||
        result.data.length > 1
      ) {
        throw new Error('Codex thread/turns/list response is invalid');
      }
      const nextCursor = parseTurnCursor(result.nextCursor, 'nextCursor');
      parseTurnCursor(result.backwardsCursor, 'backwardsCursor');
      const turn = result.data[0];
      if (turn !== undefined) {
        turns.push(turn);
        if (turnContainsTextualUserMessage(turn)) return turns;
      }
      if (nextCursor === null) return turns;
      if (visitedCursors.has(nextCursor)) {
        throw new Error('Codex thread/turns/list nextCursor looped');
      }
      visitedCursors.add(nextCursor);
      cursor = nextCursor;
    }
    return turns;
  }

  async readLatestThreadTurn(threadId: string): Promise<unknown | null> {
    const connection = this.connection;
    if (!connection || !this.isConnected()) {
      throw new Error('Codex App Server is not connected');
    }
    const result = await this.request(connection, 'thread/turns/list', {
      threadId,
      cursor: null,
      itemsView: 'notLoaded',
      sortDirection: 'desc',
      limit: 1
    });
    if (
      !isEyesOnAgentsRecord(result) ||
      !Array.isArray(result.data) ||
      result.data.length > 1 ||
      (
        result.nextCursor !== null &&
        result.nextCursor !== undefined &&
        typeof result.nextCursor !== 'string'
      ) ||
      (
        result.backwardsCursor !== null &&
        result.backwardsCursor !== undefined &&
        typeof result.backwardsCursor !== 'string'
      )
    ) {
      throw new Error('Codex latest thread turn response is invalid');
    }
    const turn = result.data[0];
    if (turn === undefined) return null;
    if (
      !isEyesOnAgentsRecord(turn) ||
      turn.itemsView !== 'notLoaded' ||
      !Array.isArray(turn.items) ||
      turn.items.length !== 0
    ) {
      throw new Error('Codex latest thread turn contains unexpected items');
    }
    return {
      id: typeof turn.id === 'string' ? turn.id : null,
      status: typeof turn.status === 'string' ? turn.status : null,
      startedAt: typeof turn.startedAt === 'number' ? turn.startedAt : null,
      completedAt: typeof turn.completedAt === 'number' ? turn.completedAt : null
    };
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
    assertEmptyHookDiagnostics(entry.errors, 'errors');
    assertEmptyHookDiagnostics(entry.warnings, 'warnings');
    if (entry.hooks.length > MAX_HOOKS) {
      throw new Error(`Codex hooks/list exceeded ${MAX_HOOKS} entries`);
    }
    return entry.hooks.map((hook, index) => parseHookDefinition(hook, index));
  }

  async enableHooks(keys: string[]): Promise<void> {
    const connection = this.connection;
    if (!connection || !this.isConnected()) {
      throw new Error('Codex App Server is not connected');
    }
    if (keys.length === 0 || keys.length > MAX_HOOKS || new Set(keys).size !== keys.length) {
      throw new Error('Codex hook keys are invalid');
    }
    const state = Object.fromEntries(keys.map((key, index) => {
      const parsed = parseHookText(key, `hook key ${index}`);
      if (!parsed) throw new Error(`Codex hook key ${index} is invalid`);
      return [parsed, { enabled: true }];
    }));
    const result = await this.request(connection, 'config/batchWrite', {
      edits: [{
        keyPath: 'hooks.state',
        value: state,
        mergeStrategy: 'upsert'
      }],
      filePath: null,
      expectedVersion: null,
      reloadUserConfig: true
    });
    parseBatchWriteResult(result);
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
      connection.pending.set(id, {
        resolve,
        reject,
        timeout,
        responseFrameLimitBytes: responseFrameLimitBytes(method, params)
      });
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
    connection.stdoutBufferBytes += chunk.length;
    connection.stdoutBuffer += connection.stdoutDecoder.write(chunk);
    let newline = connection.stdoutBuffer.indexOf('\n');
    while (newline >= 0) {
      if (this.connection !== connection) return;
      const rawLine = connection.stdoutBuffer.slice(0, newline);
      connection.stdoutBuffer = connection.stdoutBuffer.slice(newline + 1);
      const frameBytes = Buffer.byteLength(rawLine, 'utf8');
      connection.stdoutBufferBytes -= frameBytes + 1;
      if (frameBytes > MAX_FULL_TURN_FRAME_BYTES) {
        this.handleProcessFailure(
          connection,
          new Error('Codex App Server frame exceeded the size limit')
        );
        return;
      }
      const line = rawLine.trim();
      if (line) {
        let value: unknown;
        try {
          value = JSON.parse(line) as unknown;
        } catch {
          this.handleProcessFailure(
            connection,
            new Error(
              frameBytes > MAX_FRAME_BYTES
                ? 'Codex App Server frame exceeded the size limit'
                : 'Codex App Server returned invalid JSON'
            )
          );
          return;
        }
        const frameLimitBytes = isEyesOnAgentsRecord(value) && typeof value.id === 'number'
          ? connection.pending.get(value.id)?.responseFrameLimitBytes ?? MAX_FRAME_BYTES
          : MAX_FRAME_BYTES;
        if (frameBytes > frameLimitBytes) {
          this.handleProcessFailure(
            connection,
            new Error('Codex App Server frame exceeded the size limit')
          );
          return;
        }
        this.handleMessage(connection, value);
      } else if (frameBytes > MAX_FRAME_BYTES) {
        this.handleProcessFailure(
          connection,
          new Error('Codex App Server frame exceeded the size limit')
        );
        return;
      }
      newline = connection.stdoutBuffer.indexOf('\n');
    }
    let residualLimitBytes = MAX_FRAME_BYTES;
    for (const pending of connection.pending.values()) {
      residualLimitBytes = Math.max(residualLimitBytes, pending.responseFrameLimitBytes);
    }
    if (connection.stdoutBufferBytes > residualLimitBytes) {
      this.handleProcessFailure(
        connection,
        new Error('Codex App Server frame exceeded the size limit')
      );
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
