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
  CODING_AGENT_BRIDGE_MAX_FRAME_BYTES,
  parseCodingAgentHookEvent
} from '@shared/codingAgent/codingAgentHookBridge.contract';
import type {
  CodingAgentBridgeEndpoint,
  CodingAgentHookEvent
} from '@shared/codingAgent/codingAgentHookBridge.type';
import type { CodingAgentProvider } from '@shared/codingAgent/codingAgentSession.type';
import { parseUuid } from '@shared/codingAgent/codingAgentSession.contract';

const MAX_SEEN_EVENTS = 1024;

interface UnixSocketIdentity {
  dev: number;
  ino: number;
  mode: number;
  ctimeMs: number;
  birthtimeMs: number;
}

type EventConsumer = (event: CodingAgentHookEvent) => Promise<void>;

const getUnixSocketIdentity = (path: string): UnixSocketIdentity => {
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

const isSameUnixSocket = (path: string, identity: UnixSocketIdentity): boolean => {
  try {
    const current = getUnixSocketIdentity(path);
    return current.dev === identity.dev &&
      current.ino === identity.ino &&
      current.mode === identity.mode &&
      current.ctimeMs === identity.ctimeMs &&
      current.birthtimeMs === identity.birthtimeMs;
  } catch {
    return false;
  }
};

const probeUnixSocket = (path: string): Promise<'live' | 'stale'> => {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(path);
    let settled = false;
    const finish = (result: 'live' | 'stale', error?: Error): void => {
      if (settled) return;
      settled = true;
      socket.removeAllListeners();
      socket.destroy();
      if (error) reject(error);
      else resolve(result);
    };
    socket.once('connect', () => finish('live'));
    socket.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ECONNREFUSED' || error.code === 'ENOENT') finish('stale');
      else finish('live', error);
    });
    socket.setTimeout(500, () => finish('live', new Error('Bridge socket probe timed out')));
  });
};

const writeAck = (socket: Socket, value: object): void => {
  socket.end(`${JSON.stringify(value)}\n`);
};

export class AgentSessionEventBridgeServer {
  private server: Server | null = null;
  private endpoint: CodingAgentBridgeEndpoint | null = null;
  private installationId: string | null = null;
  private unixSocketIdentity: UnixSocketIdentity | null = null;
  private consume: EventConsumer | null = null;
  private consumeQueue: Promise<void> = Promise.resolve();
  private readonly seenEvents = new Map<string, true>();
  private readonly eventTimes = new Map<CodingAgentProvider, number>();

  isListening(): boolean {
    return this.server?.listening === true;
  }

  getLastEventAt(provider: CodingAgentProvider): number | null {
    return this.eventTimes.get(provider) ?? null;
  }

  async start(params: {
    endpoint: CodingAgentBridgeEndpoint;
    installationId: string;
    consume: EventConsumer;
  }): Promise<CodingAgentBridgeEndpoint> {
    if (this.server && this.endpoint) return this.endpoint;
    const installationId = parseUuid(params.installationId, 'installationId');
    const server = net.createServer((socket) => this.handleConnection(socket));
    let identity: UnixSocketIdentity | null = null;

    try {
      if (params.endpoint.transport === 'unix') {
        const socketDirectory = dirname(params.endpoint.path);
        mkdirSync(socketDirectory, { recursive: true, mode: 0o700 });
        chmodSync(socketDirectory, 0o700);
        if (existsSync(params.endpoint.path)) {
          identity = getUnixSocketIdentity(params.endpoint.path);
          const state = await probeUnixSocket(params.endpoint.path);
          if (state === 'live') {
            throw new Error(`Coding-agent bridge is already running: ${params.endpoint.path}`);
          }
          if (!isSameUnixSocket(params.endpoint.path, identity)) {
            throw new Error('Coding-agent bridge path changed during stale-socket probe');
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
      server.on('error', () => {
        // A late listener error must not crash the host. Startup errors are handled above.
      });
      if (params.endpoint.transport === 'unix') chmodSync(params.endpoint.path, 0o600);
      this.server = server;
      this.endpoint = params.endpoint;
      this.installationId = installationId;
      this.consume = params.consume;
      this.unixSocketIdentity = params.endpoint.transport === 'unix'
        ? getUnixSocketIdentity(params.endpoint.path)
        : null;
      return params.endpoint;
    } catch (error) {
      if (server.listening) {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
      throw error;
    }
  }

  async stop(): Promise<void> {
    const server = this.server;
    const endpoint = this.endpoint;
    const identity = this.unixSocketIdentity;
    this.server = null;
    this.endpoint = null;
    this.installationId = null;
    this.unixSocketIdentity = null;
    this.consume = null;
    this.seenEvents.clear();
    this.eventTimes.clear();
    if (server) {
      let preservedPath: string | null = null;
      if (
        endpoint?.transport === 'unix' &&
        identity &&
        existsSync(endpoint.path) &&
        !isSameUnixSocket(endpoint.path, identity)
      ) {
        preservedPath = `${endpoint.path}.preserved-${process.pid}-${Date.now()}`;
        renameSync(endpoint.path, preservedPath);
      }
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (preservedPath && endpoint?.transport === 'unix' && !existsSync(endpoint.path)) {
        renameSync(preservedPath, endpoint.path);
      } else if (
        endpoint?.transport === 'unix' &&
        identity &&
        existsSync(endpoint.path) &&
        isSameUnixSocket(endpoint.path, identity)
      ) {
        unlinkSync(endpoint.path);
      }
    }
    await this.consumeQueue;
  }

  private rememberEvent(key: string): boolean {
    if (this.seenEvents.has(key)) return false;
    this.seenEvents.set(key, true);
    while (this.seenEvents.size > MAX_SEEN_EVENTS) {
      const oldest = this.seenEvents.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.seenEvents.delete(oldest);
    }
    return true;
  }

  private enqueue(event: CodingAgentHookEvent): void {
    const consume = this.consume;
    if (!consume) return;
    this.consumeQueue = this.consumeQueue
      .then(async () => await consume(event))
      .catch(() => {
        // Do not log hook payloads. A later event can refresh the same session.
      });
  }

  private handleConnection(socket: Socket): void {
    socket.setEncoding('utf8');
    socket.on('error', () => {
      // Hook processes may exit as soon as they send a frame; never surface socket errors.
    });
    socket.setTimeout(1000, () => socket.destroy());
    let buffer = '';
    let handled = false;
    socket.on('data', (chunk: string) => {
      if (handled) return;
      buffer += chunk;
      if (Buffer.byteLength(buffer, 'utf8') > CODING_AGENT_BRIDGE_MAX_FRAME_BYTES) {
        handled = true;
        writeAck(socket, { ok: false, error: 'frame-too-large' });
        return;
      }
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      handled = true;
      const line = buffer.slice(0, newline).trim();
      try {
        if (!line) throw new Error('empty frame');
        const event = parseCodingAgentHookEvent(JSON.parse(line) as unknown);
        if (event.installationId !== this.installationId) {
          throw new Error('installation mismatch');
        }
        const key = `${event.installationId}:${event.eventId}`;
        if (!this.rememberEvent(key)) {
          writeAck(socket, { ok: true, duplicate: true });
          return;
        }
        this.eventTimes.set(
          event.provider,
          Math.max(this.eventTimes.get(event.provider) ?? 0, event.occurredAt)
        );
        this.enqueue(event);
        writeAck(socket, { ok: true });
      } catch {
        writeAck(socket, { ok: false, error: 'invalid-event' });
      }
    });
  }
}

export const agentSessionEventBridgeServer = new AgentSessionEventBridgeServer();
