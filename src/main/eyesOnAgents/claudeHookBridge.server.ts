import { chmodSync, existsSync, lstatSync, mkdirSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';
import net, { type Server, type Socket } from 'node:net';
import {
  CLAUDE_HOOK_LIVE_MAX_FRAME_BYTES,
  parseClaudeHookDelivery
} from '@shared/eyesOnAgents/claudeHookBridge.contract';
import type {
  ClaudeHookBridgeEndpoint,
  ClaudeHookDelivery
} from '@shared/eyesOnAgents/claudeHookBridge.type';
import type { EyesOnAgentsRuntimeDeliveryResult } from '@shared/eyesOnAgents/eyesOnAgents.type';
import {
  replayClaudeHookOutbox,
  inspectClaudeHookOutbox,
  persistClaudeHookOutboxDelivery,
  type ClaudeHookOutboxCoverageGap
} from './claudeHookOutbox.service';

export type ClaudeHookDeliveryOrigin = 'live' | 'outbox_replay';

interface UnixSocketIdentity {
  dev: number;
  ino: number;
  mode: number;
  ctimeMs: number;
  birthtimeMs: number;
}

const getSocketIdentity = (path: string): UnixSocketIdentity => {
  const stat = lstatSync(path);
  if (!stat.isSocket()) throw new Error('Claude hook bridge path is not a socket');
  return {
    dev: stat.dev,
    ino: stat.ino,
    mode: stat.mode,
    ctimeMs: stat.ctimeMs,
    birthtimeMs: stat.birthtimeMs
  };
};

const sameSocket = (path: string, expected: UnixSocketIdentity): boolean => {
  try {
    const current = getSocketIdentity(path);
    return current.dev === expected.dev && current.ino === expected.ino &&
      current.mode === expected.mode && current.ctimeMs === expected.ctimeMs &&
      current.birthtimeMs === expected.birthtimeMs;
  } catch {
    return false;
  }
};

const probeSocket = async (path: string): Promise<boolean> => await new Promise((resolve) => {
  const probe = net.createConnection(path);
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

export class ClaudeHookBridgeServer {
  private server: Server | null = null;
  private endpoint: ClaudeHookBridgeEndpoint | null = null;
  private installationId: string | null = null;
  private outboxPath: string | null = null;
  private consume: ((delivery: ClaudeHookDelivery) => Promise<EyesOnAgentsRuntimeDeliveryResult>) | null = null;
  private onCommitted: ((params: {
    committedAt: number;
    duplicate: boolean;
    origin: ClaudeHookDeliveryOrigin;
    installationId: string;
  }) => void) | null = null;
  private onCoverageGap: ((gap: ClaudeHookOutboxCoverageGap) => void | Promise<void>) | null = null;
  private listeningSince: number | null = null;
  private lastEventAt: number | null = null;
  private socketIdentity: UnixSocketIdentity | null = null;
  private sockets = new Set<Socket>();
  private commitTail: Promise<void> = Promise.resolve();
  private replayPromise: Promise<void> | null = null;
  private replayRequested = false;
  private replayEnabled = false;
  private liveAdmissionEnabled = false;
  private canArm: (() => boolean) | null = null;
  private reportedCoverageGap: string | null = null;

  isListening(): boolean { return this.server?.listening === true; }
  getListeningSince(): number | null { return this.listeningSince; }
  getLastEventAt(): number | null { return this.lastEventAt; }

  async start(params: {
    endpoint: ClaudeHookBridgeEndpoint;
    installationId: string;
    outboxPath: string;
    consume: (delivery: ClaudeHookDelivery) => Promise<EyesOnAgentsRuntimeDeliveryResult>;
    onCommitted?: (params: {
      committedAt: number;
      duplicate: boolean;
      origin: ClaudeHookDeliveryOrigin;
      installationId: string;
    }) => void;
    onCoverageGap?: (gap: ClaudeHookOutboxCoverageGap) => void | Promise<void>;
    deferReplay?: boolean;
    canArm?: () => boolean;
  }): Promise<void> {
    if (this.server) {
      if (
        this.endpoint?.transport === params.endpoint.transport &&
        this.endpoint.path === params.endpoint.path &&
        this.installationId === params.installationId &&
        this.outboxPath === params.outboxPath
      ) return;
      throw new Error('Claude hook bridge is already running with different parameters');
    }
    const server = net.createServer((socket) => this.handle(socket));
    let createdIdentity: UnixSocketIdentity | null = null;
    try {
      if (params.endpoint.transport === 'unix') {
        const parent = dirname(params.endpoint.path);
        mkdirSync(parent, { recursive: true, mode: 0o700 });
        chmodSync(parent, 0o700);
        if (existsSync(params.endpoint.path)) {
          const identity = getSocketIdentity(params.endpoint.path);
          if (await probeSocket(params.endpoint.path)) {
            throw new Error('Claude hook bridge is already running');
          }
          if (!sameSocket(params.endpoint.path, identity)) {
            throw new Error('Claude hook bridge path changed during stale-socket probe');
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
      this.installationId = params.installationId;
      this.outboxPath = params.outboxPath;
      this.consume = params.consume;
      this.onCommitted = params.onCommitted ?? null;
      this.onCoverageGap = params.onCoverageGap ?? null;
      this.canArm = params.canArm ?? null;
      this.socketIdentity = createdIdentity;
      this.listeningSince = Date.now();
      this.replayEnabled = params.deferReplay !== true;
      this.liveAdmissionEnabled = params.deferReplay !== true;
      this.reportedCoverageGap = null;
      if (this.replayEnabled) this.scheduleReplay();
    } catch (error) {
      if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
      if (
        params.endpoint.transport === 'unix' && createdIdentity &&
        sameSocket(params.endpoint.path, createdIdentity)
      ) {
        try { unlinkSync(params.endpoint.path); } catch { /* already removed */ }
      }
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
    this.outboxPath = null;
    this.consume = null;
    this.onCommitted = null;
    this.onCoverageGap = null;
    this.canArm = null;
    this.listeningSince = null;
    this.lastEventAt = null;
    this.socketIdentity = null;
    this.replayEnabled = false;
    this.liveAdmissionEnabled = false;
    this.replayRequested = false;
    this.reportedCoverageGap = null;
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    await this.commitTail.catch(() => undefined);
    if (this.replayPromise) await this.replayPromise.catch(() => undefined);
    if (endpoint?.transport === 'unix' && identity && sameSocket(endpoint.path, identity)) {
      try { unlinkSync(endpoint.path); } catch { /* already removed */ }
    }
  }

  async replayOutbox(): Promise<void> {
    const server = this.server;
    const installationId = this.installationId;
    const outboxPath = this.outboxPath;
    if (!server?.listening || installationId === null || outboxPath === null) return;
    this.replayEnabled = true;
    await this.drainReplay();
    const initialInspection = inspectClaudeHookOutbox(outboxPath);
    if (initialInspection.coverageGap) {
      await this.enqueueCoverageGap(initialInspection.coverageGap);
    }
    if (this.server !== server || this.installationId !== installationId ||
      !this.canOpenLiveAdmission()) return;
    if (initialInspection.pendingCount > 0) {
      throw new Error('Claude hook outbox replay did not clear the durable backlog');
    }
    this.liveAdmissionEnabled = true;
    try {
      await this.drainReplay();
      const finalInspection = inspectClaudeHookOutbox(outboxPath);
      if (finalInspection.coverageGap) {
        await this.enqueueCoverageGap(finalInspection.coverageGap);
      }
      if (this.server !== server || this.installationId !== installationId ||
        !this.canOpenLiveAdmission()) {
        this.liveAdmissionEnabled = false;
        return;
      }
      if (finalInspection.pendingCount > 0) {
        throw new Error('Claude hook outbox changed before live admission stabilized');
      }
    } catch (error) {
      this.liveAdmissionEnabled = false;
      throw error;
    }
  }

  private handle(socket: Socket): void {
    this.sockets.add(socket);
    socket.setTimeout(1_500, () => socket.destroy());
    socket.on('error', () => socket.destroy());
    socket.once('close', () => this.sockets.delete(socket));
    const chunks: Buffer[] = [];
    let bytes = 0;
    let dispatched = false;
    socket.on('data', (chunk: Buffer) => {
      if (dispatched) return;
      bytes += chunk.length;
      if (bytes > CLAUDE_HOOK_LIVE_MAX_FRAME_BYTES) {
        socket.destroy();
        return;
      }
      chunks.push(chunk);
      const text = Buffer.concat(chunks).toString('utf8');
      const newline = text.indexOf('\n');
      if (newline < 0) return;
      if (newline !== text.length - 1) {
        socket.destroy();
        return;
      }
      dispatched = true;
      socket.pause();
      this.dispatch(socket, text.slice(0, -1));
    });
  }

  private dispatch(socket: Socket, frame: string): void {
    let delivery: ClaudeHookDelivery;
    try {
      delivery = parseClaudeHookDelivery(JSON.parse(frame) as unknown);
      if (delivery.installationId !== this.installationId) {
        throw new Error('Claude hook installation identity changed');
      }
    } catch {
      socket.destroy();
      return;
    }
    if (!this.liveAdmissionEnabled) {
      const outboxPath = this.outboxPath;
      if (outboxPath) {
        try {
          persistClaudeHookOutboxDelivery({ outboxPath, delivery });
        } catch {
          // The helper owns durable fallback; an unarmed socket must still fail closed.
        }
        this.scheduleReplay();
      }
      socket.destroy();
      return;
    }
    const operation = this.enqueue(delivery, 'live').then(() => {
      socket.end(`${JSON.stringify({
        schemaVersion: 1,
        deliveryId: delivery.deliveryId,
        status: 'committed'
      })}\n`);
      this.scheduleReplay();
    });
    this.commitTail = operation.then(() => undefined, () => {
      socket.destroy();
    });
  }

  private scheduleReplay(): void {
    if (!this.replayEnabled || !this.endpoint || !this.outboxPath) return;
    this.replayRequested = true;
    if (this.replayPromise) return;
    const operation = this.performReplay();
    this.replayPromise = operation;
    const clear = (): void => {
      if (this.replayPromise === operation) this.replayPromise = null;
      if (this.replayRequested) this.scheduleReplay();
    };
    void operation.then(clear, clear);
  }

  private async drainReplay(): Promise<void> {
    this.scheduleReplay();
    while (this.replayPromise) {
      const operation = this.replayPromise;
      await operation;
      await Promise.resolve();
      if (this.replayPromise === operation && !this.replayRequested) break;
    }
  }

  private canOpenLiveAdmission(): boolean {
    if (this.canArm) return this.canArm();
    return this.reportedCoverageGap === null;
  }

  private enqueue(
    delivery: ClaudeHookDelivery,
    origin: ClaudeHookDeliveryOrigin
  ): Promise<EyesOnAgentsRuntimeDeliveryResult> {
    const operation = this.commitTail.then(async () => {
      const consume = this.consume;
      if (!consume || delivery.installationId !== this.installationId) {
        throw new Error('Claude hook listener stopped or changed generation');
      }
      const result = await consume(delivery);
      const committedAt = Date.now();
      if (!result.duplicate) this.lastEventAt = committedAt;
      try {
        this.onCommitted?.({
          committedAt,
          duplicate: result.duplicate,
          origin,
          installationId: delivery.installationId
        });
      } catch {
        // Status bookkeeping cannot turn a committed SQLite write into a failed delivery.
      }
      if (origin === 'live') this.scheduleReplay();
      return result;
    });
    this.commitTail = operation.then(() => undefined, () => undefined);
    return operation;
  }

  private async performReplay(): Promise<void> {
    while (this.replayEnabled && this.replayRequested) {
      this.replayRequested = false;
      const endpoint = this.endpoint;
      const outboxPath = this.outboxPath;
      if (!endpoint || !outboxPath) return;
      const pendingBefore = inspectClaudeHookOutbox(outboxPath).pendingCount;
      let detectedGap: ClaudeHookOutboxCoverageGap | null = null;
      const replayed = await replayClaudeHookOutbox({
        endpoint,
        outboxPath,
        maxFiles: 40,
        deliver: async (delivery) => {
          try {
            if (detectedGap) {
              const gap = detectedGap;
              detectedGap = null;
              await this.enqueueCoverageGap(gap);
            }
            await this.enqueue(delivery, 'outbox_replay');
            return true;
          } catch {
            return false;
          }
        },
        onCoverageGap: (gap) => {
          detectedGap = gap;
        }
      });
      if (detectedGap) await this.enqueueCoverageGap(detectedGap);
      const inspection = inspectClaudeHookOutbox(outboxPath);
      if (inspection.coverageGap) {
        await this.enqueueCoverageGap(inspection.coverageGap);
      }
      if (inspection.pendingCount > 0) {
        if (!this.canOpenLiveAdmission()) return;
        if (replayed < Math.min(pendingBefore, 40)) {
          throw new Error('Claude hook outbox replay could not commit the existing backlog');
        }
        this.replayRequested = true;
      }
    }
  }

  private enqueueCoverageGap(gap: ClaudeHookOutboxCoverageGap): Promise<void> {
    const signature = JSON.stringify(gap);
    if (signature === this.reportedCoverageGap) return Promise.resolve();
    const operation = this.commitTail.then(async () => {
      if (signature === this.reportedCoverageGap) return;
      this.liveAdmissionEnabled = false;
      if (this.onCoverageGap) await this.onCoverageGap(gap);
      this.reportedCoverageGap = signature;
    });
    this.commitTail = operation.then(() => undefined, () => undefined);
    return operation;
  }
}

export const claudeHookBridgeServer = new ClaudeHookBridgeServer();
