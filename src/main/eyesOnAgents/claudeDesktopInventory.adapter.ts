import { constants } from 'node:fs';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type {
  EyesOnAgentsClaudeDeletionTombstone,
  EyesOnAgentsClaudeInventoryThread
} from '@shared/eyesOnAgents/eyesOnAgents.type';
import {
  parseEyesOnAgentsDesktopSessionId,
  parseEyesOnAgentsPath,
  parseEyesOnAgentsText,
  parseEyesOnAgentsUuid
} from '@shared/eyesOnAgents/eyesOnAgents.contract';
import { isPathInsideRoot } from './claudePath.resolver';

const UUID_DIR = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LOCAL_FILE = /^local_([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.json$/i;
const DELETED_FILE = /^deleted_([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;
const MAX_FILE_BYTES = 1024 * 1024;
const ALLOWED = new Set(['sessionId', 'cliSessionId', 'title', 'isArchived', 'lastActivityAt', 'cwd']);

export interface ClaudeDesktopCandidate {
  root: string;
  sourceKey: string;
  path: string;
  name: string;
  mtimeMs: number;
}

export interface ClaudeDesktopTombstoneCandidate {
  sourceKey: string;
  identityId: string;
  path: string;
  name: string;
  mtimeMs: number;
}

export interface ClaudeDesktopDiscovery {
  candidates: ClaudeDesktopCandidate[];
  tombstones: ClaudeDesktopTombstoneCandidate[];
  healthyScopeKeys: string[];
  complete: boolean;
}

const timestamp = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    const result = Math.floor(value < 10_000_000_000 ? value * 1000 : value);
    return Number.isSafeInteger(result) ? result : null;
  }
  if (typeof value === 'string') {
    const result = Date.parse(value);
    return Number.isFinite(result) && result >= 0 ? result : null;
  }
  return null;
};
const optionalText = (value: unknown): string | null => {
  try { return parseEyesOnAgentsText(value, 'Claude title', 300); } catch { return null; }
};
const optionalPath = (value: unknown): string | null => {
  try { return parseEyesOnAgentsPath(value); } catch { return null; }
};

const readBoundedRegularFile = async (
  path: string,
  expected: Awaited<ReturnType<typeof lstat>>
): Promise<{ content: string; mtimeMs: number }> => {
  const flags = process.platform === 'win32'
    ? constants.O_RDONLY
    : constants.O_RDONLY | constants.O_NOFOLLOW;
  const handle = await open(path, flags);
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.size > MAX_FILE_BYTES ||
      opened.dev !== expected.dev || opened.ino !== expected.ino ||
      opened.size !== expected.size || opened.mtimeMs !== expected.mtimeMs) {
      throw new Error('Claude Desktop metadata identity changed before open');
    }
    const buffer = Buffer.alloc(MAX_FILE_BYTES + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    const after = await handle.stat();
    if (!after.isFile() || after.size > MAX_FILE_BYTES ||
      after.dev !== opened.dev || after.ino !== opened.ino ||
      after.size !== opened.size || after.mtimeMs !== opened.mtimeMs ||
      offset > MAX_FILE_BYTES) {
      throw new Error('Claude Desktop metadata changed during bounded read');
    }
    return {
      content: buffer.subarray(0, offset).toString('utf8'),
      mtimeMs: after.mtimeMs
    };
  } finally {
    await handle.close();
  }
};

export const discoverClaudeDesktopInventory = async (
  roots: readonly string[]
): Promise<ClaudeDesktopDiscovery> => {
  const candidates: ClaudeDesktopCandidate[] = [];
  const tombstones: ClaudeDesktopTombstoneCandidate[] = [];
  const healthyScopeKeys = new Set<string>();
  let complete = roots.length > 0;
  const visitedRoots = new Set<string>();
  for (const root of roots) {
    let canonicalRoot: string;
    try { canonicalRoot = await realpath(root); } catch { complete = false; continue; }
    if (visitedRoots.has(canonicalRoot)) continue;
    visitedRoots.add(canonicalRoot);
    let accounts;
    try { accounts = await readdir(canonicalRoot, { withFileTypes: true }); } catch {
      complete = false;
      continue;
    }
    for (const account of accounts) {
      if (!account.isDirectory() || account.isSymbolicLink() || !UUID_DIR.test(account.name)) continue;
      let organizations;
      try { organizations = await readdir(join(canonicalRoot, account.name), { withFileTypes: true }); } catch {
        complete = false;
        continue;
      }
      for (const organization of organizations) {
        if (!organization.isDirectory() || organization.isSymbolicLink() || !UUID_DIR.test(organization.name)) continue;
        const discoveredOrganizationPath = join(canonicalRoot, account.name, organization.name);
        let organizationPath: string;
        try {
          organizationPath = await realpath(discoveredOrganizationPath);
          const organizationStat = await lstat(organizationPath);
          if (!organizationStat.isDirectory() || organizationStat.isSymbolicLink() ||
            !isPathInsideRoot(canonicalRoot, organizationPath) ||
            basename(organizationPath) !== organization.name) {
            complete = false;
            continue;
          }
        } catch {
          complete = false;
          continue;
        }
        const sourceKey = organizationPath;
        let scopeComplete = true;
        let files;
        try { files = await readdir(organizationPath, { withFileTypes: true }); } catch {
          complete = false;
          continue;
        }
        for (const entry of files) {
          const localMatch = LOCAL_FILE.exec(entry.name);
          const deletedMatch = DELETED_FILE.exec(entry.name);
          if (!localMatch && !deletedMatch) continue;
          if (!entry.isFile() || entry.isSymbolicLink()) {
            if (deletedMatch) scopeComplete = false;
            continue;
          }
          const path = join(organizationPath, entry.name);
          try {
            const stat = await lstat(path);
            if (!stat.isFile() || stat.isSymbolicLink()) {
              if (deletedMatch) scopeComplete = false;
              continue;
            }
            if (localMatch) {
              if (stat.size > MAX_FILE_BYTES) continue;
              candidates.push({
                root: canonicalRoot,
                sourceKey,
                path,
                name: entry.name,
                mtimeMs: stat.mtimeMs
              });
              continue;
            }
            const canonical = await realpath(path);
            if (canonical !== path || !isPathInsideRoot(organizationPath, canonical) ||
              basename(canonical) !== entry.name) {
              scopeComplete = false;
              continue;
            }
            const verified = await lstat(path);
            if (!verified.isFile() || verified.isSymbolicLink() ||
              verified.dev !== stat.dev || verified.ino !== stat.ino ||
              verified.size !== stat.size || verified.mtimeMs !== stat.mtimeMs) {
              scopeComplete = false;
              continue;
            }
            const flags = process.platform === 'win32'
              ? constants.O_RDONLY
              : constants.O_RDONLY | constants.O_NOFOLLOW;
            const handle = await open(path, flags);
            try {
              const opened = await handle.stat();
              if (!opened.isFile() || opened.dev !== verified.dev || opened.ino !== verified.ino ||
                opened.size !== verified.size || opened.mtimeMs !== verified.mtimeMs) {
                scopeComplete = false;
                continue;
              }
              tombstones.push({
                sourceKey,
                identityId: parseEyesOnAgentsUuid(deletedMatch?.[1], 'Claude deleted session ID'),
                path,
                name: entry.name,
                mtimeMs: opened.mtimeMs
              });
            } finally {
              await handle.close();
            }
          } catch {
            if (deletedMatch) scopeComplete = false;
          }
        }
        if (scopeComplete) healthyScopeKeys.add(sourceKey);
        else complete = false;
      }
    }
  }
  return {
    candidates: candidates.sort((a, b) => b.mtimeMs - a.mtimeMs || a.path.localeCompare(b.path)),
    tombstones: tombstones.sort((a, b) => b.mtimeMs - a.mtimeMs || a.path.localeCompare(b.path)),
    healthyScopeKeys: [...healthyScopeKeys].sort(),
    complete
  };
};

export const discoverClaudeDesktopCandidates = async (
  roots: readonly string[]
): Promise<ClaudeDesktopCandidate[]> => {
  return (await discoverClaudeDesktopInventory(roots)).candidates;
};

export const scanClaudeDesktopTombstones = (
  candidates: readonly ClaudeDesktopTombstoneCandidate[],
  observedAt: number
): EyesOnAgentsClaudeDeletionTombstone[] => candidates.map((candidate) => ({
  sourceKey: candidate.sourceKey,
  identityId: candidate.identityId,
  deletedAt: Number.isFinite(candidate.mtimeMs) && candidate.mtimeMs >= 0
    ? Math.min(Math.floor(candidate.mtimeMs), observedAt)
    : observedAt,
  observedAt
}));

export const scanClaudeDesktopCandidates = async (
  candidates: readonly ClaudeDesktopCandidate[], observedAt: number
): Promise<EyesOnAgentsClaudeInventoryThread[]> => {
  const rows: EyesOnAgentsClaudeInventoryThread[] = [];
  for (const candidate of candidates) {
    try {
      const stat = await lstat(candidate.path);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_FILE_BYTES) continue;
      const canonical = await realpath(candidate.path);
      if (canonical !== candidate.path || !isPathInsideRoot(candidate.root, canonical) ||
        basename(canonical) !== candidate.name) continue;
      const metadata = await readBoundedRegularFile(candidate.path, stat);
      const value = JSON.parse(metadata.content) as unknown;
      if (typeof value !== 'object' || value === null || Array.isArray(value)) continue;
      const projected = Object.fromEntries(
        Object.entries(value as Record<string, unknown>).filter(([key]) => ALLOWED.has(key))
      );
      const desktopSessionId = parseEyesOnAgentsDesktopSessionId(projected.sessionId);
      if (desktopSessionId === null || `${desktopSessionId}.json`.toLowerCase() !== candidate.name.toLowerCase()) continue;
      const threadId = parseEyesOnAgentsUuid(projected.cliSessionId, 'Claude cliSessionId');
      rows.push({
        threadId, desktopSessionId,
        desktopMetadataMtime: Number.isFinite(metadata.mtimeMs) && metadata.mtimeMs >= 0
          ? Math.min(Math.floor(metadata.mtimeMs), observedAt)
          : null,
        transcriptPath: null,
        title: optionalText(projected.title), cwd: optionalPath(projected.cwd),
        archiveState: typeof projected.isArchived === 'boolean'
          ? projected.isArchived ? 'archived' : 'active'
          : 'unknown',
        transcriptActivityAt: null,
        lastActivityAt: (() => {
          const value = timestamp(projected.lastActivityAt);
          return value !== null && value <= observedAt ? value : null;
        })(),
        observedAt
      });
    } catch { /* malformed/future provider file */ }
  }
  return rows;
};

export const scanClaudeDesktopInventory = async (
  roots: readonly string[], observedAt = Date.now(),
  page: { offset: number; limit: number } | null = null
): Promise<EyesOnAgentsClaudeInventoryThread[]> => {
  const candidates = await discoverClaudeDesktopCandidates(roots);
  return await scanClaudeDesktopCandidates(
    page === null ? candidates : candidates.slice(page.offset, page.offset + page.limit), observedAt
  );
};
