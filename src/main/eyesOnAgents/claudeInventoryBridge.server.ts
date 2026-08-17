import { chmodSync, existsSync, lstatSync, mkdirSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';
import net, { type Server, type Socket } from 'node:net';
import {
  CLAUDE_INVENTORY_MAX_FRAME_BYTES,
  parseClaudeInventoryInvalidation
} from '@shared/eyesOnAgents/claudeInventoryBridge.contract';
import type {
  ClaudeInventoryBridgeEndpoint,
  ClaudeInventoryInvalidation
} from '@shared/eyesOnAgents/claudeInventoryBridge.type';

interface UnixSocketIdentity {
  dev: number;
  ino: number;
  mode: number;
  ctimeMs: number;
  birthtimeMs: number;
}

const getSocketIdentity = (path: string): UnixSocketIdentity => {
  const stat = lstatSync(path);
  if (!stat.isSocket()) throw new Error('Claude inventory bridge path is not a socket');
  return {
    dev: stat.dev,
    ino: stat.ino,
    mode: stat.mode,
    ctimeMs: stat.ctimeMs,
    birthtimeMs: stat.birthtimeMs
  };
};

const sameSocket = (path: string, identity: UnixSocketIdentity): boolean => {
  try {
    const current = getSocketIdentity(path);
    return current.dev === identity.dev && current.ino === identity.ino &&
      current.mode === identity.mode && current.ctimeMs === identity.ctimeMs &&
      current.birthtimeMs === identity.birthtimeMs;
  } catch {
    return false;
  }
};

export class ClaudeInventoryBridgeServer {
  private server: Server | null = null;
  private endpoint: ClaudeInventoryBridgeEndpoint | null = null;
  private consume: ((value: ClaudeInventoryInvalidation) => void | Promise<void>) | null = null;
  private nonce: string | null = null;
  private pending = new Map<ClaudeInventoryInvalidation['source'], ClaudeInventoryInvalidation>();
  private dispatchTimer: NodeJS.Timeout | null = null;
  private sockets = new Set<Socket>();
  private socketIdentity: UnixSocketIdentity | null = null;

  isListening(): boolean { return this.server?.listening === true; }

  async start(params: {
    endpoint: ClaudeInventoryBridgeEndpoint;
    nonce: string;
    consume: (value: ClaudeInventoryInvalidation) => void | Promise<void>;
  }): Promise<void> {
    if (this.server) return;
    const server = net.createServer((socket) => this.handle(socket));
    let createdIdentity: UnixSocketIdentity | null = null;
    try {
      if (params.endpoint.transport === 'unix') {
        mkdirSync(dirname(params.endpoint.path), { recursive: true, mode: 0o700 });
        chmodSync(dirname(params.endpoint.path), 0o700);
        if (existsSync(params.endpoint.path)) {
          const identity = getSocketIdentity(params.endpoint.path);
          const live = await new Promise<boolean>((resolve) => {
            const probe = net.createConnection(params.endpoint.path);
            let settled = false;
            const finish = (value: boolean): void => {
              if (settled) return;
              settled = true;
              probe.destroy();
              resolve(value);
            };
            probe.setTimeout(500, () => finish(true));
            probe.once('connect', () => finish(true));
            probe.once('error', (error: NodeJS.ErrnoException) => {
              finish(error.code !== 'ECONNREFUSED' && error.code !== 'ENOENT');
            });
          });
          if (live) throw new Error('Claude inventory bridge is already running');
          if (!sameSocket(params.endpoint.path, identity)) {
            throw new Error('Claude inventory bridge path changed during stale-socket probe');
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
      if (params.endpoint.transport === 'unix') {
        chmodSync(params.endpoint.path, 0o600);
        createdIdentity = getSocketIdentity(params.endpoint.path);
      }
      this.server = server;
      this.endpoint = params.endpoint;
      this.consume = params.consume;
      this.nonce = params.nonce;
      this.socketIdentity = createdIdentity;
    } catch (error) {
      if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
      if (
        params.endpoint.transport === 'unix' && createdIdentity &&
        existsSync(params.endpoint.path) && sameSocket(params.endpoint.path, createdIdentity)
      ) unlinkSync(params.endpoint.path);
      throw error;
    }
  }

  async stop(): Promise<void> {
    const server = this.server;
    const endpoint = this.endpoint;
    const socketIdentity = this.socketIdentity;
    this.server = null;
    this.endpoint = null;
    this.consume = null;
    this.nonce = null;
    this.pending.clear();
    if (this.dispatchTimer) clearTimeout(this.dispatchTimer);
    this.dispatchTimer = null;
    this.socketIdentity = null;
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    if (
      endpoint?.transport === 'unix' && socketIdentity &&
      sameSocket(endpoint.path, socketIdentity)
    ) {
      try { unlinkSync(endpoint.path); } catch { /* endpoint already removed */ }
    }
  }

  private handle(socket: Socket): void {
    this.sockets.add(socket);
    socket.setTimeout(1_000, () => socket.destroy());
    socket.on('error', () => socket.destroy());
    socket.once('close', () => this.sockets.delete(socket));
    const chunks: Buffer[] = [];
    let bytes = 0;
    socket.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > CLAUDE_INVENTORY_MAX_FRAME_BYTES) {
        socket.destroy();
        return;
      }
      chunks.push(chunk);
    });
    socket.once('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        if (!text.endsWith('\n') || text.slice(0, -1).includes('\n')) throw new Error('invalid frame');
        const value = parseClaudeInventoryInvalidation(JSON.parse(text.slice(0, -1)) as unknown);
        if (value.nonce !== this.nonce) throw new Error('invalid nonce');
        const consume = this.consume;
        if (!consume) return;
        this.pending.set(value.source, value);
        this.scheduleDispatch();
      } catch {
        // Invalid helper frames are ignored and cannot reach the scanner.
      }
    });
  }

  private scheduleDispatch(): void {
    if (this.dispatchTimer) return;
    this.dispatchTimer = setTimeout(() => {
      this.dispatchTimer = null;
      const consume = this.consume;
      if (!consume) {
        this.pending.clear();
        return;
      }
      const values = [...this.pending.values()];
      this.pending.clear();
      const value = values.at(-1);
      if (value) {
        try {
          void Promise.resolve(consume(value)).catch(() => undefined);
        } catch {
          // Observation failures are reconciled by the periodic/manual refresh fallback.
        }
      }
      if (this.pending.size > 0) this.scheduleDispatch();
    }, 25);
  }
}
