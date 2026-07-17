import { dirname } from 'node:path';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  renameSync,
  unlinkSync
} from 'node:fs';
import net, { type Server, type Socket } from 'node:net';
import {
  CODEX_HOOK_BRIDGE_MAX_FRAME_BYTES,
  parseCodexHookDelivery
} from '@shared/eyesOnAgents/codexHookBridge.contract';
import type {
  CodexHookBridgeEndpoint,
  CodexHookDelivery
} from '@shared/eyesOnAgents/codexHookBridge.type';
import { parseEyesOnAgentsUuid } from '@shared/eyesOnAgents/eyesOnAgents.contract';
import {
  replayCodexHookOutbox,
  type CodexHookOutboxCoverageGap,
  type CodexHookOutboxReplayResult
} from './codexHookOutbox.service';

interface UnixSocketIdentity {
  dev: number;
  ino: number;
  mode: number;
  ctimeMs: number;
  birthtimeMs: number;
}

type EventConsumer = (delivery: CodexHookDelivery) => Promise<{ duplicate: boolean }>;
type ServerFactory = (listener: (socket: Socket) => void) => Server;
type CoverageGapConsumer = (gap: CodexHookOutboxCoverageGap) => Promise<void>;
type OutboxReplayer = (params: {
  endpoint: CodexHookBridgeEndpoint;
  outboxPath: string;
  onCoverageGap?: (gap: CodexHookOutboxCoverageGap) => void | Promise<void>;
}) => Promise<CodexHookOutboxReplayResult>;

const getSocketIdentity = (path: string): UnixSocketIdentity => {
  const stats = lstatSync(path);
  if (!stats.isSocket()) throw new Error(`Refusing non-socket bridge path: ${path}`);
  return {
    dev: stats.dev,
    ino: stats.ino,
    mode: stats.mode,
    ctimeMs: stats.ctimeMs,
    birthtimeMs: stats.birthtimeMs
  };
};

const sameSocket = (path: string, identity: UnixSocketIdentity): boolean => {
  try {
    const current = getSocketIdentity(path);
    return current.dev === identity.dev &&
      current.ino === identity.ino &&
      current.mode === identity.mode &&
      current.ctimeMs === identity.ctimeMs &&
      current.birthtimeMs === identity.birthtimeMs;
  } catch {
    return false;
  }
};

const probeSocket = (path: string): Promise<'live' | 'stale'> => {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(path);
    let settled = false;
    const finish = (state: 'live' | 'stale', error?: Error): void => {
      if (settled) return;
      settled = true;
      socket.removeAllListeners();
      socket.destroy();
      if (error) reject(error);
      else resolve(state);
    };
    socket.once('connect', () => finish('live'));
    socket.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ECONNREFUSED' || error.code === 'ENOENT') finish('stale');
      else finish('live', error);
    });
    socket.setTimeout(500, () => finish('live', new Error('Bridge probe timed out')));
  });
};

const writeAck = (socket: Socket, value: object): void => {
  if (socket.destroyed) return;
  socket.end(`${JSON.stringify(value)}\n`);
};

export class CodexHookBridgeServer {
  private server: Server | null = null;
  private endpoint: CodexHookBridgeEndpoint | null = null;
  private installationId: string | null = null;
  private socketIdentity: UnixSocketIdentity | null = null;
  private consume: EventConsumer | null = null;
  private consumeQueue: Promise<void> = Promise.resolve();
  private outboxPath: string | null = null;
  private onCoverageGap: CoverageGapConsumer | null = null;
  private replayPromise: Promise<void> | null = null;
  private replayRequested = false;
  private replayEnabled = false;
  private reportedCoverageGap: string | null = null;
  private listeningSince: number | null = null;
  private lastEventAt: number | null = null;

  constructor(
    private readonly now: () => number = Date.now,
    private readonly serverFactory: ServerFactory = net.createServer,
    private readonly outboxReplayer: OutboxReplayer = replayCodexHookOutbox
  ) {}

  isListening(): boolean {
    return this.server?.listening === true;
  }

  getLastEventAt(): number | null {
    return this.lastEventAt;
  }

  getListeningSince(): number | null {
    return this.listeningSince;
  }

  async start(params: {
    endpoint: CodexHookBridgeEndpoint;
    installationId: string;
    consume: EventConsumer;
    outboxPath?: string;
    onCoverageGap?: CoverageGapConsumer;
  }): Promise<CodexHookBridgeEndpoint> {
    if (this.server && this.endpoint) return this.endpoint;
    const installationId = parseEyesOnAgentsUuid(params.installationId, 'installationId');
    const server = this.serverFactory((socket) => this.handleConnection(socket));
    try {
      if (params.endpoint.transport === 'unix') {
        mkdirSync(dirname(params.endpoint.path), { recursive: true, mode: 0o700 });
        chmodSync(dirname(params.endpoint.path), 0o700);
        if (existsSync(params.endpoint.path)) {
          const identity = getSocketIdentity(params.endpoint.path);
          if (await probeSocket(params.endpoint.path) === 'live') {
            throw new Error(`Codex hook bridge is already running: ${params.endpoint.path}`);
          }
          if (!sameSocket(params.endpoint.path, identity)) {
            throw new Error('Codex hook bridge path changed during stale-socket probe');
          }
          unlinkSync(params.endpoint.path);
        }
      }
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(params.endpoint.path, () => {
          server.off('error', reject);
          resolve();
        });
      });
      server.on('error', () => undefined);
      if (params.endpoint.transport === 'unix') chmodSync(params.endpoint.path, 0o600);
      this.server = server;
      this.endpoint = params.endpoint;
      this.installationId = installationId;
      this.consume = params.consume;
      this.outboxPath = params.outboxPath ?? null;
      this.onCoverageGap = params.onCoverageGap ?? null;
      this.replayEnabled = true;
      this.reportedCoverageGap = null;
      this.listeningSince = this.now();
      this.socketIdentity = params.endpoint.transport === 'unix'
        ? getSocketIdentity(params.endpoint.path)
        : null;
      this.requestOutboxReplay();
      return params.endpoint;
    } catch (error) {
      if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.replayEnabled = false;
    this.replayRequested = false;
    if (this.replayPromise) await this.replayPromise.catch(() => undefined);
    const server = this.server;
    const endpoint = this.endpoint;
    const identity = this.socketIdentity;
    this.server = null;
    this.endpoint = null;
    this.installationId = null;
    this.socketIdentity = null;
    this.consume = null;
    this.outboxPath = null;
    this.onCoverageGap = null;
    this.reportedCoverageGap = null;
    this.listeningSince = null;
    this.lastEventAt = null;
    if (server) {
      let preserved: string | null = null;
      if (
        endpoint?.transport === 'unix' &&
        identity &&
        existsSync(endpoint.path) &&
        !sameSocket(endpoint.path, identity)
      ) {
        preserved = `${endpoint.path}.preserved-${process.pid}-${Date.now()}`;
        renameSync(endpoint.path, preserved);
      }
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (preserved && endpoint?.transport === 'unix' && !existsSync(endpoint.path)) {
        renameSync(preserved, endpoint.path);
      } else if (
        endpoint?.transport === 'unix' &&
        identity &&
        existsSync(endpoint.path) &&
        sameSocket(endpoint.path, identity)
      ) {
        unlinkSync(endpoint.path);
      }
    }
    await this.consumeQueue;
  }

  private requestOutboxReplay(): void {
    if (!this.replayEnabled || !this.endpoint || !this.outboxPath) return;
    this.replayRequested = true;
    if (this.replayPromise) return;
    const operation = this.performOutboxReplay();
    this.replayPromise = operation;
    const clear = (): void => {
      if (this.replayPromise !== operation) return;
      this.replayPromise = null;
      if (this.replayRequested) this.requestOutboxReplay();
    };
    void operation.then(clear, clear);
  }

  private async performOutboxReplay(): Promise<void> {
    while (this.replayEnabled && this.replayRequested) {
      this.replayRequested = false;
      const endpoint = this.endpoint;
      const outboxPath = this.outboxPath;
      if (!endpoint || !outboxPath) return;
      let detectedGap: CodexHookOutboxCoverageGap | null = null;
      await this.outboxReplayer({
        endpoint,
        outboxPath,
        onCoverageGap: (gap) => {
          detectedGap = gap;
        }
      });
      if (detectedGap && this.onCoverageGap) {
        const signature = JSON.stringify(detectedGap);
        if (signature !== this.reportedCoverageGap) {
          await this.onCoverageGap(detectedGap);
          this.reportedCoverageGap = signature;
        }
      }
    }
  }

  private enqueue(delivery: CodexHookDelivery): Promise<{ duplicate: boolean }> {
    if (!this.consume) return Promise.reject(new Error('Codex hook listener is unavailable'));
    const consume = this.consume;
    const operation = this.consumeQueue.then(async () => await consume(delivery));
    this.consumeQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  private async handleFrame(socket: Socket, line: string): Promise<void> {
    try {
      if (!line) throw new Error('empty frame');
      const delivery = parseCodexHookDelivery(JSON.parse(line) as unknown);
      if (delivery.event.installationId !== this.installationId) {
        throw new Error('installation mismatch');
      }
      await this.enqueue(delivery);
      this.lastEventAt = Math.max(this.lastEventAt ?? 0, delivery.event.occurredAt);
      writeAck(socket, { status: 'committed' });
      this.requestOutboxReplay();
    } catch {
      writeAck(socket, { status: 'unavailable' });
    }
  }

  private handleConnection(socket: Socket): void {
    socket.setEncoding('utf8');
    socket.on('error', () => undefined);
    socket.setTimeout(1000, () => socket.destroy());
    let buffer = '';
    let handled = false;
    socket.on('data', (chunk: string) => {
      if (handled) return;
      buffer += chunk;
      if (Buffer.byteLength(buffer, 'utf8') > CODEX_HOOK_BRIDGE_MAX_FRAME_BYTES) {
        handled = true;
        writeAck(socket, { ok: false, error: 'frame-too-large' });
        return;
      }
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      handled = true;
      void this.handleFrame(socket, buffer.slice(0, newline).trim());
    });
  }
}

export const codexHookBridgeServer = new CodexHookBridgeServer();
