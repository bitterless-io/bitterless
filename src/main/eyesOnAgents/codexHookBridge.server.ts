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
  parseCodexHookEvent
} from '@shared/eyesOnAgents/codexHookBridge.contract';
import type {
  CodexHookBridgeEndpoint,
  CodexHookEvent
} from '@shared/eyesOnAgents/codexHookBridge.type';
import { parseEyesOnAgentsUuid } from '@shared/eyesOnAgents/eyesOnAgents.contract';

const MAX_SEEN_EVENTS = 1024;

interface UnixSocketIdentity {
  dev: number;
  ino: number;
  mode: number;
  ctimeMs: number;
  birthtimeMs: number;
}

type EventConsumer = (event: CodexHookEvent) => Promise<void>;

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
  socket.end(`${JSON.stringify(value)}\n`);
};

export class CodexHookBridgeServer {
  private server: Server | null = null;
  private endpoint: CodexHookBridgeEndpoint | null = null;
  private installationId: string | null = null;
  private socketIdentity: UnixSocketIdentity | null = null;
  private consume: EventConsumer | null = null;
  private consumeQueue: Promise<void> = Promise.resolve();
  private readonly seenEvents = new Set<string>();
  private lastEventAt: number | null = null;

  isListening(): boolean {
    return this.server?.listening === true;
  }

  getLastEventAt(): number | null {
    return this.lastEventAt;
  }

  async start(params: {
    endpoint: CodexHookBridgeEndpoint;
    installationId: string;
    consume: EventConsumer;
  }): Promise<CodexHookBridgeEndpoint> {
    if (this.server && this.endpoint) return this.endpoint;
    const installationId = parseEyesOnAgentsUuid(params.installationId, 'installationId');
    const server = net.createServer((socket) => this.handleConnection(socket));
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
      this.socketIdentity = params.endpoint.transport === 'unix'
        ? getSocketIdentity(params.endpoint.path)
        : null;
      return params.endpoint;
    } catch (error) {
      if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
      throw error;
    }
  }

  async stop(): Promise<void> {
    const server = this.server;
    const endpoint = this.endpoint;
    const identity = this.socketIdentity;
    this.server = null;
    this.endpoint = null;
    this.installationId = null;
    this.socketIdentity = null;
    this.consume = null;
    this.seenEvents.clear();
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

  private remember(eventId: string): boolean {
    if (this.seenEvents.has(eventId)) return false;
    this.seenEvents.add(eventId);
    while (this.seenEvents.size > MAX_SEEN_EVENTS) {
      const oldest = this.seenEvents.values().next().value as string | undefined;
      if (!oldest) break;
      this.seenEvents.delete(oldest);
    }
    return true;
  }

  private enqueue(event: CodexHookEvent): void {
    if (!this.consume) return;
    const consume = this.consume;
    this.consumeQueue = this.consumeQueue
      .then(async () => await consume(event))
      .catch(() => undefined);
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
      try {
        const line = buffer.slice(0, newline).trim();
        if (!line) throw new Error('empty frame');
        const event = parseCodexHookEvent(JSON.parse(line) as unknown);
        if (event.installationId !== this.installationId) throw new Error('installation mismatch');
        const key = `${event.installationId}:${event.eventId}`;
        if (!this.remember(key)) {
          writeAck(socket, { ok: true, duplicate: true });
          return;
        }
        this.lastEventAt = Math.max(this.lastEventAt ?? 0, event.occurredAt);
        this.enqueue(event);
        writeAck(socket, { ok: true });
      } catch {
        writeAck(socket, { ok: false, error: 'invalid-event' });
      }
    });
  }
}

export const codexHookBridgeServer = new CodexHookBridgeServer();
