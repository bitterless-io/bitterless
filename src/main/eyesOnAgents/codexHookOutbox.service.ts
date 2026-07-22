import { randomUUID } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
import net, { type Socket } from 'node:net';
import { basename, dirname, join, resolve } from 'node:path';
import {
  CODEX_HOOK_BRIDGE_MAX_FRAME_BYTES,
  parseCodexHookDelivery,
  parseCodexHookDeliveryAck,
  parseCodexHookMetadataOnlyDelivery,
  toMetadataOnlyCodexHookDelivery
} from '@shared/eyesOnAgents/codexHookBridge.contract';
import type {
  CodexHookBridgeEndpoint,
  CodexHookDelivery,
  CodexHookMetadataOnlyDelivery
} from '@shared/eyesOnAgents/codexHookBridge.type';

export const CODEX_HOOK_OUTBOX_MAX_FILES = 512;
export const CODEX_HOOK_OUTBOX_MAX_FILE_BYTES = 16 * 1024;
export const CODEX_HOOK_OUTBOX_MAX_QUARANTINE_FILES = 32;

const MAX_ACK_BYTES = 256;
const DELIVERY_TIMEOUT_MS = 500;
const LOCK_STALE_MS = 5_000;
const LOCK_ATTEMPTS = 10;
const LOCK_RETRY_MS = 5;
const MAX_GAP_OCCURRENCES = 1_000_000;
const DELIVERY_FILE_PATTERN = /^\d{16}-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.json$/i;
const COVERAGE_REASONS = [
  'corrupt_file',
  'outbox_overflow',
  'storage_unavailable'
] as const;

export type CodexHookDeliveryResult = 'committed' | 'unavailable';
export type CodexHookOutboxPersistResult =
  | 'stored'
  | 'already_stored'
  | 'overflow'
  | 'unavailable';
export type CodexHookOutboxCoverageReason = typeof COVERAGE_REASONS[number];

export interface CodexHookOutboxCoverageGap {
  schemaVersion: 1;
  reasons: CodexHookOutboxCoverageReason[];
  firstDetectedAt: number;
  lastDetectedAt: number;
  occurrences: number;
}

export interface CodexHookOutboxInspection {
  pendingCount: number;
  quarantinedCount: number;
  coverageGap: CodexHookOutboxCoverageGap | null;
}

export interface CodexHookOutboxReplayResult extends CodexHookOutboxInspection {
  replayedCount: number;
}

export interface CodexHookOutboxCoverageRecoveryResult extends CodexHookOutboxInspection {
  discardedCount: number;
  recoveredGap: CodexHookOutboxCoverageGap | null;
}

interface CodexHookOutboxPaths {
  root: string;
  pending: string;
  quarantine: string;
  lock: string;
  coverageGap: string;
  emergencyGap: string;
}

interface CodexHookOutboxEntry {
  filePath: string;
  delivery: CodexHookMetadataOnlyDelivery;
}

type OutboxDeliverySender = (
  endpoint: CodexHookBridgeEndpoint,
  delivery: CodexHookMetadataOnlyDelivery
) => Promise<CodexHookDeliveryResult>;
type SocketFactory = (path: string) => Socket;

const outboxPaths = (outboxPath: string): CodexHookOutboxPaths => {
  const root = resolve(outboxPath);
  return {
    root,
    pending: join(root, 'pending'),
    quarantine: join(root, 'quarantine'),
    lock: join(root, '.lock'),
    coverageGap: join(root, 'coverage-gap.json'),
    emergencyGap: join(root, 'coverage-gap.emergency')
  };
};

const applyPrivateMode = (path: string, mode: number): void => {
  if (process.platform !== 'win32') chmodSync(path, mode);
};

const ensureDirectories = (paths: CodexHookOutboxPaths): void => {
  for (const path of [paths.root, paths.pending, paths.quarantine]) {
    mkdirSync(path, { recursive: true, mode: 0o700 });
    applyPrivateMode(path, 0o700);
  }
};

const sleepSync = (milliseconds: number): void => {
  const view = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(view, 0, 0, milliseconds);
};

const tryAcquireLock = (paths: CodexHookOutboxPaths, now: number): boolean => {
  for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt += 1) {
    try {
      mkdirSync(paths.lock, { mode: 0o700 });
      applyPrivateMode(paths.lock, 0o700);
      return true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST') throw error;
      try {
        if (now - statSync(paths.lock).mtimeMs > LOCK_STALE_MS) {
          rmdirSync(paths.lock);
          continue;
        }
      } catch (lockError) {
        const lockCode = (lockError as NodeJS.ErrnoException).code;
        if (lockCode !== 'ENOENT' && lockCode !== 'ENOTEMPTY') throw lockError;
      }
      if (attempt + 1 < LOCK_ATTEMPTS) sleepSync(LOCK_RETRY_MS);
    }
  }
  return false;
};

const writeEmergencyGap = (paths: CodexHookOutboxPaths, detectedAt: number): void => {
  try {
    writeFileSync(paths.emergencyGap, `${detectedAt}\n`, { flag: 'a', mode: 0o600 });
    applyPrivateMode(paths.emergencyGap, 0o600);
  } catch {
    // There is no safer fallback when the private outbox directory itself is unavailable.
  }
};

const readEmergencyGapDetectedAt = (
  paths: CodexHookOutboxPaths,
  fallback: number
): number => {
  const stats = statSync(paths.emergencyGap);
  if (stats.size === 0 || stats.size > CODEX_HOOK_OUTBOX_MAX_FILE_BYTES) {
    const modifiedAt = Math.floor(stats.mtimeMs);
    return Number.isSafeInteger(modifiedAt) && modifiedAt >= 0 ? modifiedAt : fallback;
  }
  let detectedAt: number | null = null;
  for (const line of readFileSync(paths.emergencyGap, 'utf8').split('\n')) {
    if (!line) continue;
    const value = Number(line);
    if (!Number.isSafeInteger(value) || value < 0) continue;
    detectedAt = Math.max(detectedAt ?? value, value);
  }
  if (detectedAt !== null) return detectedAt;
  const modifiedAt = Math.floor(stats.mtimeMs);
  return Number.isSafeInteger(modifiedAt) && modifiedAt >= 0 ? modifiedAt : fallback;
};

const withOutboxLock = <T>(params: {
  outboxPath: string;
  now: number;
  recordEmergencyGap?: boolean;
  action: (paths: CodexHookOutboxPaths) => T;
}): T | null => {
  const paths = outboxPaths(params.outboxPath);
  try {
    ensureDirectories(paths);
    if (!tryAcquireLock(paths, params.now)) {
      if (params.recordEmergencyGap !== false) writeEmergencyGap(paths, params.now);
      return null;
    }
    try {
      return params.action(paths);
    } finally {
      try {
        rmdirSync(paths.lock);
      } catch {
        // A stale lock is recovered by a later invocation.
      }
    }
  } catch {
    if (params.recordEmergencyGap !== false) writeEmergencyGap(paths, params.now);
    return null;
  }
};

const atomicWrite = (path: string, content: string): void => {
  const tempPath = join(dirname(path), `.tmp-${randomUUID()}`);
  try {
    writeFileSync(tempPath, content, { flag: 'wx', mode: 0o600 });
    renameSync(tempPath, path);
    applyPrivateMode(path, 0o600);
  } finally {
    if (existsSync(tempPath)) unlinkSync(tempPath);
  }
};

const parseCoverageGap = (value: unknown): CodexHookOutboxCoverageGap => {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new Error('invalid coverage gap');
  }
  const record = value as Record<string, unknown>;
  if (
    record.schemaVersion !== 1 ||
    Object.keys(record).sort().join(',') !==
      'firstDetectedAt,lastDetectedAt,occurrences,reasons,schemaVersion' ||
    !Array.isArray(record.reasons) ||
    !record.reasons.every((reason) => COVERAGE_REASONS.includes(reason as CodexHookOutboxCoverageReason)) ||
    !Number.isSafeInteger(record.firstDetectedAt) ||
    (record.firstDetectedAt as number) < 0 ||
    !Number.isSafeInteger(record.lastDetectedAt) ||
    (record.lastDetectedAt as number) < 0 ||
    !Number.isSafeInteger(record.occurrences) ||
    (record.occurrences as number) < 1
  ) {
    throw new Error('invalid coverage gap');
  }
  return {
    schemaVersion: 1,
    reasons: [...new Set(record.reasons as CodexHookOutboxCoverageReason[])],
    firstDetectedAt: record.firstDetectedAt as number,
    lastDetectedAt: record.lastDetectedAt as number,
    occurrences: Math.min(record.occurrences as number, MAX_GAP_OCCURRENCES)
  };
};

const sameCoverageGap = (
  left: CodexHookOutboxCoverageGap,
  right: CodexHookOutboxCoverageGap
): boolean => {
  return left.schemaVersion === right.schemaVersion &&
    left.firstDetectedAt === right.firstDetectedAt &&
    left.lastDetectedAt === right.lastDetectedAt &&
    left.occurrences === right.occurrences &&
    [...left.reasons].sort().join(',') === [...right.reasons].sort().join(',');
};

const readCoverageGap = (paths: CodexHookOutboxPaths): CodexHookOutboxCoverageGap | null => {
  if (!existsSync(paths.coverageGap)) return null;
  try {
    if (statSync(paths.coverageGap).size > CODEX_HOOK_OUTBOX_MAX_FILE_BYTES) {
      throw new Error('oversized coverage gap');
    }
    return parseCoverageGap(JSON.parse(readFileSync(paths.coverageGap, 'utf8')) as unknown);
  } catch {
    unlinkSync(paths.coverageGap);
    return null;
  }
};

const recordCoverageGap = (
  paths: CodexHookOutboxPaths,
  reason: CodexHookOutboxCoverageReason,
  now: number
): CodexHookOutboxCoverageGap => {
  const current = readCoverageGap(paths);
  const reasons = current ? [...current.reasons] : [];
  if (!reasons.includes(reason)) reasons.push(reason);
  const next: CodexHookOutboxCoverageGap = {
    schemaVersion: 1,
    reasons,
    firstDetectedAt: current ? Math.min(current.firstDetectedAt, now) : now,
    lastDetectedAt: current ? Math.max(current.lastDetectedAt, now) : now,
    occurrences: Math.min((current?.occurrences ?? 0) + 1, MAX_GAP_OCCURRENCES)
  };
  atomicWrite(paths.coverageGap, `${JSON.stringify(next)}\n`);
  return next;
};

const consumeEmergencyGap = (paths: CodexHookOutboxPaths, now: number): void => {
  if (!existsSync(paths.emergencyGap)) return;
  const detectedAt = readEmergencyGapDetectedAt(paths, now);
  recordCoverageGap(paths, 'storage_unavailable', detectedAt);
  unlinkSync(paths.emergencyGap);
};

const deliveryFileName = (delivery: CodexHookMetadataOnlyDelivery): string => {
  const occurredAt = String(delivery.event.occurredAt).padStart(16, '0');
  return `${occurredAt}-${delivery.deliveryId}.json`;
};

const serializeDelivery = (delivery: CodexHookMetadataOnlyDelivery): string => {
  const parsed = parseCodexHookMetadataOnlyDelivery(delivery);
  const serialized = `${JSON.stringify(parsed)}\n`;
  if (Buffer.byteLength(serialized, 'utf8') > CODEX_HOOK_OUTBOX_MAX_FILE_BYTES) {
    throw new Error('Codex hook delivery exceeds the outbox limit');
  }
  return serialized;
};

const directChild = (parent: string, path: string): boolean => {
  return dirname(resolve(path)) === resolve(parent);
};

const trimQuarantine = (paths: CodexHookOutboxPaths): void => {
  const files = readdirSync(paths.quarantine)
    .map((name) => join(paths.quarantine, name))
    .filter((path) => {
      try {
        return lstatSync(path).isFile();
      } catch {
        return false;
      }
    })
    .sort((left, right) => {
      const timeDiff = statSync(left).mtimeMs - statSync(right).mtimeMs;
      return timeDiff || basename(left).localeCompare(basename(right));
    });
  while (files.length >= CODEX_HOOK_OUTBOX_MAX_QUARANTINE_FILES) {
    const oldest = files.shift();
    if (oldest && existsSync(oldest)) unlinkSync(oldest);
  }
};

const quarantinePendingPath = (
  paths: CodexHookOutboxPaths,
  filePath: string,
  now: number
): void => {
  if (!directChild(paths.pending, filePath) || !existsSync(filePath)) return;
  trimQuarantine(paths);
  const quarantinePath = join(paths.quarantine, `${String(now).padStart(16, '0')}-${randomUUID()}.bad`);
  rmSync(filePath, { recursive: true, force: true });
  atomicWrite(
    quarantinePath,
    `${JSON.stringify({ schemaVersion: 1, reason: 'invalid-outbox-entry', detectedAt: now })}\n`
  );
  recordCoverageGap(paths, 'corrupt_file', now);
};

const readDeliveryFile = (filePath: string): CodexHookMetadataOnlyDelivery => {
  const stats = lstatSync(filePath);
  if (!stats.isFile() || stats.size > CODEX_HOOK_OUTBOX_MAX_FILE_BYTES) {
    throw new Error('invalid outbox file');
  }
  return parseCodexHookMetadataOnlyDelivery(
    JSON.parse(readFileSync(filePath, 'utf8')) as unknown
  );
};

const recoverTemporaryFiles = (paths: CodexHookOutboxPaths, now: number): void => {
  const names = readdirSync(paths.pending).filter((name) => name.startsWith('.tmp-'));
  for (const name of names) {
    const filePath = join(paths.pending, name);
    try {
      const delivery = readDeliveryFile(filePath);
      const target = join(paths.pending, deliveryFileName(delivery));
      if (existsSync(target)) unlinkSync(filePath);
      else renameSync(filePath, target);
    } catch {
      quarantinePendingPath(paths, filePath, now);
    }
  }
};

const listEntries = (paths: CodexHookOutboxPaths, now: number): CodexHookOutboxEntry[] => {
  consumeEmergencyGap(paths, now);
  recoverTemporaryFiles(paths, now);
  const entries: CodexHookOutboxEntry[] = [];
  for (const name of readdirSync(paths.pending)) {
    const filePath = join(paths.pending, name);
    try {
      if (!DELIVERY_FILE_PATTERN.test(name)) throw new Error('invalid outbox file name');
      const delivery = readDeliveryFile(filePath);
      if (name !== deliveryFileName(delivery)) throw new Error('outbox file name mismatch');
      entries.push({ filePath, delivery });
    } catch {
      quarantinePendingPath(paths, filePath, now);
    }
  }
  entries.sort((left, right) => {
    const occurredAt = left.delivery.event.occurredAt - right.delivery.event.occurredAt;
    return occurredAt || left.delivery.deliveryId.localeCompare(right.delivery.deliveryId);
  });
  return entries;
};

const quarantineCount = (paths: CodexHookOutboxPaths): number => {
  return readdirSync(paths.quarantine).filter((name) => {
    try {
      return lstatSync(join(paths.quarantine, name)).isFile();
    } catch {
      return false;
    }
  }).length;
};

export const sendCodexHookDelivery = (
  endpoint: CodexHookBridgeEndpoint,
  delivery: CodexHookDelivery,
  timeoutMs = DELIVERY_TIMEOUT_MS,
  socketFactory: SocketFactory = (path) => net.createConnection(path)
): Promise<CodexHookDeliveryResult> => {
  return new Promise((resolvePromise) => {
    let frame: string;
    try {
      frame = `${JSON.stringify(parseCodexHookDelivery(delivery))}\n`;
      if (Buffer.byteLength(frame, 'utf8') > CODEX_HOOK_BRIDGE_MAX_FRAME_BYTES) {
        resolvePromise('unavailable');
        return;
      }
    } catch {
      resolvePromise('unavailable');
      return;
    }
    const socket = socketFactory(endpoint.path);
    socket.setEncoding('utf8');
    let settled = false;
    let ack = '';
    const finish = (result: CodexHookDeliveryResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket.removeAllListeners();
      socket.destroy();
      resolvePromise(result);
    };
    const timeout = setTimeout(() => finish('unavailable'), timeoutMs);
    timeout.unref();
    socket.once('connect', () => socket.write(frame));
    socket.on('data', (chunk: string) => {
      ack += chunk;
      if (Buffer.byteLength(ack, 'utf8') > MAX_ACK_BYTES) {
        finish('unavailable');
        return;
      }
      const newline = ack.indexOf('\n');
      if (newline < 0) return;
      try {
        parseCodexHookDeliveryAck(JSON.parse(ack.slice(0, newline)) as unknown);
        finish('committed');
      } catch {
        finish('unavailable');
      }
    });
    socket.once('error', () => finish('unavailable'));
    socket.once('close', () => finish('unavailable'));
  });
};

export const persistCodexHookOutboxDelivery = (params: {
  outboxPath: string;
  delivery: CodexHookDelivery;
  now?: number;
}): CodexHookOutboxPersistResult => {
  let delivery: CodexHookMetadataOnlyDelivery;
  let serialized: string;
  try {
    delivery = toMetadataOnlyCodexHookDelivery(params.delivery);
    serialized = serializeDelivery(delivery);
  } catch {
    return 'unavailable';
  }
  const now = params.now ?? Date.now();
  const result = withOutboxLock({
    outboxPath: params.outboxPath,
    now,
    action: (paths): CodexHookOutboxPersistResult => {
      const entries = listEntries(paths, now);
      const filePath = join(paths.pending, deliveryFileName(delivery));
      if (existsSync(filePath)) return 'already_stored';
      if (entries.length >= CODEX_HOOK_OUTBOX_MAX_FILES) {
        recordCoverageGap(paths, 'outbox_overflow', now);
        return 'overflow';
      }
      atomicWrite(filePath, serialized);
      return 'stored';
    }
  });
  return result ?? 'unavailable';
};

export const inspectCodexHookOutbox = (
  outboxPath: string,
  now = Date.now()
): CodexHookOutboxInspection => {
  const result = withOutboxLock({
    outboxPath,
    now,
    action: (paths): CodexHookOutboxInspection => ({
      pendingCount: listEntries(paths, now).length,
      quarantinedCount: quarantineCount(paths),
      coverageGap: readCoverageGap(paths)
    })
  });
  return result ?? {
    pendingCount: 0,
    quarantinedCount: 0,
    coverageGap: {
      schemaVersion: 1,
      reasons: ['storage_unavailable'],
      firstDetectedAt: now,
      lastDetectedAt: now,
      occurrences: 1
    }
  };
};

interface RemoveCommittedEntryResult {
  removed: boolean;
  coverageGap: CodexHookOutboxCoverageGap | null;
}

const removeCommittedEntry = (params: {
  outboxPath: string;
  entry: CodexHookOutboxEntry;
  now: number;
}): RemoveCommittedEntryResult => {
  const result = withOutboxLock({
    outboxPath: params.outboxPath,
    now: params.now,
    action: (paths): RemoveCommittedEntryResult => {
      consumeEmergencyGap(paths, params.now);
      const coverageGap = readCoverageGap(paths);
      if (coverageGap) return { removed: false, coverageGap };
      if (!directChild(paths.pending, params.entry.filePath) || !existsSync(params.entry.filePath)) {
        return { removed: false, coverageGap: null };
      }
      try {
        const current = readDeliveryFile(params.entry.filePath);
        if (current.deliveryId !== params.entry.delivery.deliveryId) {
          return { removed: false, coverageGap: null };
        }
        unlinkSync(params.entry.filePath);
        return { removed: true, coverageGap: null };
      } catch {
        quarantinePendingPath(paths, params.entry.filePath, params.now);
        return { removed: false, coverageGap: readCoverageGap(paths) };
      }
    }
  });
  if (result) return result;
  const inspection = inspectCodexHookOutbox(params.outboxPath, params.now);
  return { removed: false, coverageGap: inspection.coverageGap };
};

export const recoverCodexHookOutboxCoverageGap = (params: {
  outboxPath: string;
  expectedGap: CodexHookOutboxCoverageGap;
  now?: number;
}): CodexHookOutboxCoverageRecoveryResult => {
  const expectedGap = parseCoverageGap(params.expectedGap);
  const now = params.now ?? Date.now();
  const result = withOutboxLock({
    outboxPath: params.outboxPath,
    now,
    recordEmergencyGap: false,
    action: (paths): CodexHookOutboxCoverageRecoveryResult => {
      const entries = listEntries(paths, now);
      const coverageGap = readCoverageGap(paths);
      if (!coverageGap) {
        return {
          pendingCount: entries.length,
          quarantinedCount: quarantineCount(paths),
          coverageGap: null,
          discardedCount: 0,
          recoveredGap: null
        };
      }
      if (!sameCoverageGap(coverageGap, expectedGap)) {
        return {
          pendingCount: entries.length,
          quarantinedCount: quarantineCount(paths),
          coverageGap,
          discardedCount: 0,
          recoveredGap: null
        };
      }
      let discardedCount = 0;
      for (const entry of entries) {
        if (entry.delivery.event.occurredAt > coverageGap.lastDetectedAt) continue;
        if (!directChild(paths.pending, entry.filePath) || !existsSync(entry.filePath)) continue;
        const current = readDeliveryFile(entry.filePath);
        if (current.deliveryId !== entry.delivery.deliveryId) {
          throw new Error('Codex hook outbox entry changed during coverage recovery');
        }
        unlinkSync(entry.filePath);
        discardedCount += 1;
      }
      const recoveryResult: CodexHookOutboxCoverageRecoveryResult = {
        pendingCount: entries.length - discardedCount,
        quarantinedCount: quarantineCount(paths),
        coverageGap: null,
        discardedCount,
        recoveredGap: coverageGap
      };
      unlinkSync(paths.coverageGap);
      return recoveryResult;
    }
  });
  if (!result) throw new Error('Codex hook outbox coverage recovery is unavailable');
  return result;
};

export const replayCodexHookOutbox = async (params: {
  endpoint: CodexHookBridgeEndpoint;
  outboxPath: string;
  onCoverageGap?: (gap: CodexHookOutboxCoverageGap) => void | Promise<void>;
  send?: OutboxDeliverySender;
  now?: () => number;
}): Promise<CodexHookOutboxReplayResult> => {
  const now = params.now ?? Date.now;
  let reportedCoverageGap: string | null = null;
  const reportCoverageGap = async (gap: CodexHookOutboxCoverageGap): Promise<void> => {
    const signature = JSON.stringify(gap);
    if (signature === reportedCoverageGap) return;
    reportedCoverageGap = signature;
    await params.onCoverageGap?.(gap);
  };
  const listed = withOutboxLock({
    outboxPath: params.outboxPath,
    now: now(),
    action: (paths) => ({
      entries: listEntries(paths, now()),
      coverageGap: readCoverageGap(paths)
    })
  });
  if (!listed) {
    const inspection = inspectCodexHookOutbox(params.outboxPath, now());
    if (inspection.coverageGap) await reportCoverageGap(inspection.coverageGap);
    return { ...inspection, replayedCount: 0 };
  }
  if (listed.coverageGap) {
    await reportCoverageGap(listed.coverageGap);
    const inspection = inspectCodexHookOutbox(params.outboxPath, now());
    if (inspection.coverageGap) await reportCoverageGap(inspection.coverageGap);
    return {
      ...inspection,
      replayedCount: 0
    };
  }
  const send = params.send ?? sendCodexHookDelivery;
  let replayedCount = 0;
  for (const entry of listed.entries) {
    if (await send(params.endpoint, entry.delivery) !== 'committed') break;
    const removal = removeCommittedEntry({
      outboxPath: params.outboxPath,
      entry,
      now: now()
    });
    if (removal.coverageGap) {
      await reportCoverageGap(removal.coverageGap);
      break;
    }
    if (!removal.removed) break;
    replayedCount += 1;
  }
  const inspection = inspectCodexHookOutbox(params.outboxPath, now());
  if (inspection.coverageGap) await reportCoverageGap(inspection.coverageGap);
  return {
    ...inspection,
    replayedCount
  };
};
