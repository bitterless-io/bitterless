import { randomUUID } from 'node:crypto';
import {
  chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync,
  renameSync, rmSync, rmdirSync, statSync, unlinkSync, writeFileSync
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import net from 'node:net';
import {
  CLAUDE_HOOK_LIVE_MAX_FRAME_BYTES,
  CLAUDE_HOOK_OFFLINE_MAX_FILE_BYTES,
  parseClaudeHookAcknowledgement,
  parseClaudeHookDelivery,
  parseClaudeHookMetadataOnlyDelivery,
  toMetadataOnlyClaudeHookDelivery
} from '@shared/eyesOnAgents/claudeHookBridge.contract';
import type {
  ClaudeHookBridgeEndpoint,
  ClaudeHookDelivery,
  ClaudeHookMetadataOnlyDelivery
} from
  '@shared/eyesOnAgents/claudeHookBridge.type';

export const CLAUDE_HOOK_OUTBOX_MAX_FILES = 128;
export const CLAUDE_HOOK_OUTBOX_MAX_QUARANTINE_FILES = 32;
const SOCKET_TIMEOUT_MS = 750;
const LOCK_STALE_MS = 5_000;
const DELIVERY_FILE = /^\d{16}-[0-9a-f-]{36}\.json$/i;
const COVERAGE_REASONS = ['corrupt_file', 'outbox_overflow', 'storage_unavailable'] as const;

export type ClaudeHookOutboxCoverageReason = typeof COVERAGE_REASONS[number];
export interface ClaudeHookOutboxCoverageGap {
  schemaVersion: 1;
  reasons: ClaudeHookOutboxCoverageReason[];
  firstDetectedAt: number;
  lastDetectedAt: number;
  occurrences: number;
}

interface OutboxPaths {
  root: string;
  pending: string;
  quarantine: string;
  lock: string;
  coverage: string;
  emergency: string;
}

const pathsFor = (outboxPath: string): OutboxPaths => {
  const root = resolve(outboxPath);
  return {
    root,
    pending: join(root, 'pending'),
    quarantine: join(root, 'quarantine'),
    lock: join(root, '.lock'),
    coverage: join(root, 'coverage-gap.json'),
    emergency: join(root, 'coverage-gap.emergency')
  };
};

const privateMode = (path: string, mode: number): void => {
  if (process.platform !== 'win32') chmodSync(path, mode);
};

const ensure = (paths: OutboxPaths): void => {
  for (const path of [paths.root, paths.pending, paths.quarantine]) {
    mkdirSync(path, { recursive: true, mode: 0o700 });
    privateMode(path, 0o700);
  }
};

const sleep = (milliseconds: number): void => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
};

const acquire = (paths: OutboxPaths, now: number): boolean => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      mkdirSync(paths.lock, { mode: 0o700 });
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      try {
        if (now - statSync(paths.lock).mtimeMs > LOCK_STALE_MS) rmdirSync(paths.lock);
      } catch { /* A concurrent owner may have released it. */ }
      if (attempt < 9) sleep(5);
    }
  }
  return false;
};

const atomicWrite = (path: string, content: string): void => {
  const temp = join(dirname(path), `.tmp-${randomUUID()}`);
  try {
    writeFileSync(temp, content, { flag: 'wx', mode: 0o600 });
    renameSync(temp, path);
    privateMode(path, 0o600);
  } finally {
    if (existsSync(temp)) unlinkSync(temp);
  }
};

const readGap = (paths: OutboxPaths): ClaudeHookOutboxCoverageGap | null => {
  try {
    if (!existsSync(paths.coverage) ||
      statSync(paths.coverage).size > CLAUDE_HOOK_OFFLINE_MAX_FILE_BYTES) {
      return null;
    }
    const value = JSON.parse(readFileSync(paths.coverage, 'utf8')) as ClaudeHookOutboxCoverageGap;
    if (value.schemaVersion !== 1 || !Array.isArray(value.reasons) ||
      !value.reasons.every((reason) => COVERAGE_REASONS.includes(reason)) ||
      !Number.isSafeInteger(value.firstDetectedAt) || !Number.isSafeInteger(value.lastDetectedAt) ||
      !Number.isSafeInteger(value.occurrences) || value.occurrences < 1) return null;
    return value;
  } catch {
    return null;
  }
};

const recordGap = (
  paths: OutboxPaths,
  reason: ClaudeHookOutboxCoverageReason,
  now: number
): ClaudeHookOutboxCoverageGap => {
  const current = readGap(paths);
  const reasons = [...new Set([...(current?.reasons ?? []), reason])];
  const next: ClaudeHookOutboxCoverageGap = {
    schemaVersion: 1,
    reasons,
    firstDetectedAt: current ? Math.min(current.firstDetectedAt, now) : now,
    lastDetectedAt: current ? Math.max(current.lastDetectedAt, now) : now,
    occurrences: Math.min((current?.occurrences ?? 0) + 1, 1_000_000)
  };
  atomicWrite(paths.coverage, `${JSON.stringify(next)}\n`);
  return next;
};

const emergencyGap = (paths: OutboxPaths, now: number): void => {
  try {
    mkdirSync(paths.root, { recursive: true, mode: 0o700 });
    writeFileSync(paths.emergency, `${now}\n`, { flag: 'a', mode: 0o600 });
  } catch { /* No writable local storage remains. */ }
};

const readEmergencyGapTimes = (paths: OutboxPaths, fallback: number): number[] => {
  try {
    if (!existsSync(paths.emergency) ||
      statSync(paths.emergency).size > CLAUDE_HOOK_OFFLINE_MAX_FILE_BYTES) {
      return [fallback];
    }
    const values = readFileSync(paths.emergency, 'utf8').split('\n')
      .filter(Boolean)
      .slice(-CLAUDE_HOOK_OUTBOX_MAX_FILES)
      .map((value) => Number(value))
      .filter((value) => Number.isSafeInteger(value) && value >= 0);
    return values.length > 0 ? values : [fallback];
  } catch {
    return [fallback];
  }
};

const withLock = <T>(
  outboxPath: string,
  action: (paths: OutboxPaths) => T,
  emergencyDetectedAt = Date.now()
): T | null => {
  const paths = pathsFor(outboxPath);
  const now = Date.now();
  try {
    ensure(paths);
    if (!acquire(paths, now)) {
      emergencyGap(paths, emergencyDetectedAt);
      return null;
    }
    try {
      if (existsSync(paths.emergency)) {
        for (const detectedAt of readEmergencyGapTimes(paths, emergencyDetectedAt)) {
          recordGap(paths, 'storage_unavailable', detectedAt);
        }
        unlinkSync(paths.emergency);
      }
      return action(paths);
    } finally {
      try { rmdirSync(paths.lock); } catch { /* recovered as a stale lock */ }
    }
  } catch {
    emergencyGap(paths, emergencyDetectedAt);
    return null;
  }
};

const deliveryName = (delivery: ClaudeHookDelivery): string => (
  `${String(delivery.event.occurredAt).padStart(16, '0')}-${delivery.deliveryId}.json`
);

const pendingNames = (paths: OutboxPaths): string[] => readdirSync(paths.pending)
  .filter((name) => DELIVERY_FILE.test(name)).sort();

const trimQuarantine = (paths: OutboxPaths): void => {
  const entries = readdirSync(paths.quarantine).map((name) => join(paths.quarantine, name))
    .filter((path) => {
      try { return lstatSync(path).isFile(); } catch { return false; }
    }).sort((left, right) => statSync(left).mtimeMs - statSync(right).mtimeMs);
  while (entries.length >= CLAUDE_HOOK_OUTBOX_MAX_QUARANTINE_FILES) {
    const oldest = entries.shift();
    if (oldest) unlinkSync(oldest);
  }
};

const quarantine = (paths: OutboxPaths, path: string, now: number): void => {
  trimQuarantine(paths);
  rmSync(path, { recursive: true, force: true });
  atomicWrite(join(paths.quarantine, `${String(now).padStart(16, '0')}-${randomUUID()}.bad`),
    `${JSON.stringify({ schemaVersion: 1, reason: 'invalid-outbox-entry', detectedAt: now })}\n`);
  recordGap(paths, 'corrupt_file', now);
};

const recover = (paths: OutboxPaths, now: number): void => {
  for (const name of readdirSync(paths.pending)) {
    if (DELIVERY_FILE.test(name)) continue;
    const path = join(paths.pending, name);
    try {
      const stat = lstatSync(path);
      if (!stat.isFile() || stat.size > CLAUDE_HOOK_OFFLINE_MAX_FILE_BYTES) {
        throw new Error('invalid');
      }
      const delivery = parseClaudeHookMetadataOnlyDelivery(
        JSON.parse(readFileSync(path, 'utf8')) as unknown
      );
      const target = join(paths.pending, deliveryName(delivery));
      if (existsSync(target)) unlinkSync(path);
      else renameSync(path, target);
    } catch {
      quarantine(paths, path, now);
    }
  }
};

export const persistClaudeHookOutboxDelivery = (params: {
  outboxPath: string;
  delivery: ClaudeHookDelivery;
}): boolean => {
  const delivery = toMetadataOnlyClaudeHookDelivery(params.delivery);
  return withLock(params.outboxPath, (paths) => {
    recover(paths, Date.now());
    const finalPath = join(paths.pending, deliveryName(delivery));
    if (existsSync(finalPath)) return true;
    if (pendingNames(paths).length >= CLAUDE_HOOK_OUTBOX_MAX_FILES) {
      recordGap(paths, 'outbox_overflow', Date.now());
      return false;
    }
    const content = `${JSON.stringify(delivery)}\n`;
    if (Buffer.byteLength(content) > CLAUDE_HOOK_OFFLINE_MAX_FILE_BYTES) {
      recordGap(paths, 'corrupt_file', Date.now());
      return false;
    }
    atomicWrite(finalPath, content);
    return true;
  }, delivery.event.occurredAt) ?? false;
};

export const sendClaudeHookDelivery = (
  endpoint: ClaudeHookBridgeEndpoint,
  deliveryValue: ClaudeHookDelivery
): Promise<boolean> => new Promise((resolvePromise) => {
  const delivery = parseClaudeHookDelivery(deliveryValue);
  const frame = `${JSON.stringify(delivery)}\n`;
  if (Buffer.byteLength(frame) > CLAUDE_HOOK_LIVE_MAX_FRAME_BYTES) {
    return resolvePromise(false);
  }
  const socket = net.createConnection(endpoint.path);
  const chunks: Buffer[] = [];
  let bytes = 0;
  let settled = false;
  const finish = (value: boolean): void => {
    if (settled) return;
    settled = true;
    socket.destroy();
    resolvePromise(value);
  };
  socket.setTimeout(SOCKET_TIMEOUT_MS, () => finish(false));
  socket.once('connect', () => socket.write(frame));
  socket.on('data', (chunk: Buffer) => {
    bytes += chunk.length;
    if (bytes > CLAUDE_HOOK_OFFLINE_MAX_FILE_BYTES) return finish(false);
    chunks.push(chunk);
  });
  socket.once('end', () => {
    try {
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text.endsWith('\n') || text.slice(0, -1).includes('\n')) throw new Error('invalid ACK');
      parseClaudeHookAcknowledgement(JSON.parse(text.slice(0, -1)), delivery.deliveryId);
      finish(true);
    } catch { finish(false); }
  });
  socket.once('error', () => finish(false));
});

export const replayClaudeHookOutbox = async (params: {
  endpoint: ClaudeHookBridgeEndpoint;
  outboxPath: string;
  maxFiles?: number;
  deliver?: (delivery: ClaudeHookDelivery) => Promise<boolean>;
  onCoverageGap?: (gap: ClaudeHookOutboxCoverageGap) => void;
}): Promise<number> => {
  const batch = withLock(params.outboxPath, (paths) => {
    recover(paths, Date.now());
    const entries: Array<{ name: string; delivery: ClaudeHookMetadataOnlyDelivery }> = [];
    for (const name of pendingNames(paths).slice(0, params.maxFiles ?? 40)) {
      const path = join(paths.pending, name);
      try {
        const stat = lstatSync(path);
        if (!stat.isFile() || stat.size > CLAUDE_HOOK_OFFLINE_MAX_FILE_BYTES) {
          throw new Error('invalid');
        }
        const delivery = parseClaudeHookMetadataOnlyDelivery(
          JSON.parse(readFileSync(path, 'utf8')) as unknown
        );
        if (deliveryName(delivery) !== basename(path)) throw new Error('identity mismatch');
        entries.push({ name, delivery });
      } catch {
        if (existsSync(path)) quarantine(paths, path, Date.now());
      }
    }
    return { entries, gap: readGap(paths) };
  });
  if (!batch) return 0;
  if (batch.gap) params.onCoverageGap?.(batch.gap);
  let committed = 0;
  for (const entry of batch.entries) {
    const delivered = await (
      params.deliver?.(entry.delivery) ?? sendClaudeHookDelivery(params.endpoint, entry.delivery)
    );
    if (!delivered) break;
    const removed = withLock(params.outboxPath, (paths) => {
      const path = join(paths.pending, entry.name);
      if (existsSync(path)) unlinkSync(path);
      return !existsSync(path);
    });
    if (removed !== true) break;
    committed += 1;
  }
  return committed;
};

export const inspectClaudeHookOutbox = (
  outboxPath: string
): { pendingCount: number; coverageGap: ClaudeHookOutboxCoverageGap | null } => (
  withLock(outboxPath, (paths) => {
    recover(paths, Date.now());
    return { pendingCount: pendingNames(paths).length, coverageGap: readGap(paths) };
  }) ?? {
    pendingCount: 0,
    coverageGap: {
      schemaVersion: 1,
      reasons: ['storage_unavailable'],
      firstDetectedAt: Date.now(),
      lastDetectedAt: Date.now(),
      occurrences: 1
    }
  }
);

export const clearClaudeHookOutboxRoot = (outboxRootPath: string): void => {
  const root = resolve(outboxRootPath);
  if (!existsSync(root)) return;
  const stat = lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error('Claude hook outbox root is unsafe');
  }
  const detached = join(dirname(root), `.claude-hook-outbox-clearing-${randomUUID()}`);
  renameSync(root, detached);
  try {
    rmSync(detached, { recursive: true, force: true });
  } catch (error) {
    if (!existsSync(root) && existsSync(detached)) {
      try { renameSync(detached, root); } catch { /* preserve the original cleanup error */ }
    }
    throw error;
  }
};
