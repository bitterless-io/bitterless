import { lstat, readdir, realpath } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { EyesOnAgentsClaudeInventoryThread } from '@shared/eyesOnAgents/eyesOnAgents.type';
import { parseEyesOnAgentsUuid } from '@shared/eyesOnAgents/eyesOnAgents.contract';
import { isPathInsideRoot } from './claudePath.resolver';

const UUID_JSONL = /^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.jsonl$/i;
export interface ClaudeTranscriptCandidate {
  path: string;
  threadId: string;
  mtimeMs: number;
  ambiguous?: boolean;
}

export const discoverClaudeTranscriptCandidates = async (
  projectsRoot: string | null
): Promise<ClaudeTranscriptCandidate[]> => {
  if (projectsRoot === null) return [];
  let canonicalRoot: string;
  try { canonicalRoot = await realpath(projectsRoot); } catch { return []; }
  const candidates: ClaudeTranscriptCandidate[] = [];
  let projects;
  try { projects = await readdir(canonicalRoot, { withFileTypes: true }); } catch { return []; }
  for (const project of projects) {
    if (!project.isDirectory() || project.isSymbolicLink()) continue;
    let files;
    try { files = await readdir(join(canonicalRoot, project.name), { withFileTypes: true }); } catch { continue; }
    for (const entry of files) {
      const match = UUID_JSONL.exec(entry.name);
      if (!match || !entry.isFile() || entry.isSymbolicLink()) continue;
      const path = join(canonicalRoot, project.name, entry.name);
      try {
        const stat = await lstat(path);
        if (!stat.isFile() || stat.isSymbolicLink()) continue;
        candidates.push({
          path,
          threadId: parseEyesOnAgentsUuid(match[1], 'Claude transcript session ID'),
          mtimeMs: stat.mtimeMs
        });
      } catch { /* inaccessible candidate */ }
    }
  }
  const counts = new Map<string, number>();
  for (const candidate of candidates) counts.set(candidate.threadId, (counts.get(candidate.threadId) ?? 0) + 1);
  const ambiguous = [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([threadId]) => ({
      path: '', threadId,
      mtimeMs: Math.max(...candidates.filter((candidate) => candidate.threadId === threadId)
        .map((candidate) => candidate.mtimeMs)),
      ambiguous: true as const
    }));
  return [...candidates.filter((candidate) => counts.get(candidate.threadId) === 1), ...ambiguous]
    .sort((a, b) => b.mtimeMs - a.mtimeMs || a.path.localeCompare(b.path));
};

export const scanClaudeTranscriptCandidates = async (
  projectsRoot: string | null,
  candidates: readonly ClaudeTranscriptCandidate[],
  observedAt: number
): Promise<EyesOnAgentsClaudeInventoryThread[]> => {
  if (projectsRoot === null) return [];
  let canonicalRoot: string;
  try { canonicalRoot = await realpath(projectsRoot); } catch { return []; }
  const rows: EyesOnAgentsClaudeInventoryThread[] = [];
  for (const candidate of candidates) {
    const candidateActivityAt = Number.isFinite(candidate.mtimeMs) && candidate.mtimeMs >= 0 &&
      Math.floor(candidate.mtimeMs) <= observedAt
      ? Math.floor(candidate.mtimeMs)
      : null;
    if (candidate.ambiguous) {
      rows.push({
        threadId: candidate.threadId,
        desktopSessionId: null,
        transcriptPath: null,
        clearTranscriptPath: true,
        title: null,
        cwd: null,
        archiveState: 'unknown',
        transcriptActivityAt: null,
        lastActivityAt: candidateActivityAt,
        observedAt
      });
      continue;
    }
    try {
      const stat = await lstat(candidate.path);
      if (!stat.isFile() || stat.isSymbolicLink()) continue;
      const canonical = await realpath(candidate.path);
      if (!isPathInsideRoot(canonicalRoot, canonical)) continue;
      if (basename(canonical).toLowerCase() !== `${candidate.threadId}.jsonl`.toLowerCase()) continue;
      rows.push({
        threadId: candidate.threadId, desktopSessionId: null, transcriptPath: canonical,
        title: null, cwd: null, archiveState: 'unknown',
        transcriptActivityAt: candidateActivityAt,
        lastActivityAt: candidateActivityAt, observedAt
      });
    } catch { /* inaccessible transcript */ }
  }
  return rows;
};

export const scanClaudeTranscriptInventory = async (
  projectsRoot: string | null, observedAt = Date.now(),
  page: { offset: number; limit: number } | null = null
): Promise<EyesOnAgentsClaudeInventoryThread[]> => {
  const candidates = await discoverClaudeTranscriptCandidates(projectsRoot);
  return await scanClaudeTranscriptCandidates(
    projectsRoot,
    page === null ? candidates : candidates.slice(page.offset, page.offset + page.limit),
    observedAt
  );
};

export const mergeClaudeInventory = (
  desktop: readonly EyesOnAgentsClaudeInventoryThread[],
  transcripts: readonly EyesOnAgentsClaudeInventoryThread[]
): EyesOnAgentsClaudeInventoryThread[] => {
  const rows = new Map<string, EyesOnAgentsClaudeInventoryThread>();
  for (const row of transcripts) rows.set(row.threadId, { ...row });
  const threadCounts = new Map<string, number>();
  const desktopCounts = new Map<string, number>();
  for (const row of desktop) {
    threadCounts.set(row.threadId, (threadCounts.get(row.threadId) ?? 0) + 1);
    if (row.desktopSessionId !== null) {
      desktopCounts.set(row.desktopSessionId, (desktopCounts.get(row.desktopSessionId) ?? 0) + 1);
    }
  }
  const ambiguousThreads = new Set(desktop.filter((row) =>
    (threadCounts.get(row.threadId) ?? 0) > 1 ||
    (row.desktopSessionId !== null && (desktopCounts.get(row.desktopSessionId) ?? 0) > 1)
  ).map((row) => row.threadId));
  for (const threadId of ambiguousThreads) {
    const representative = desktop.find((item) => item.threadId === threadId);
    if (!representative) continue;
    const transcript = rows.get(threadId);
    rows.set(threadId, {
      ...representative,
      desktopSessionId: null,
      clearDesktopSessionId: true,
      transcriptPath: transcript?.transcriptPath ?? null,
      clearTranscriptPath: transcript?.clearTranscriptPath,
      archiveState: 'unknown',
      title: transcript?.title ?? null,
      cwd: transcript?.cwd ?? null,
      transcriptActivityAt: transcript?.transcriptActivityAt ?? null,
      lastActivityAt: Math.max(
        ...desktop.filter((item) => item.threadId === threadId).map((item) => item.lastActivityAt ?? 0),
        transcript?.lastActivityAt ?? 0
      ) || null
    });
  }
  for (const row of desktop.filter((item) => !ambiguousThreads.has(item.threadId))) {
    const transcript = rows.get(row.threadId);
    rows.set(row.threadId, {
      ...row,
      transcriptPath: transcript?.transcriptPath ?? null,
      clearTranscriptPath: transcript?.clearTranscriptPath,
      title: row.title ?? transcript?.title ?? null,
      cwd: row.cwd ?? transcript?.cwd ?? null,
      transcriptActivityAt: transcript?.transcriptActivityAt ?? null,
      lastActivityAt: Math.max(row.lastActivityAt ?? 0, transcript?.lastActivityAt ?? 0) || null
    });
  }
  return [...rows.values()];
};
