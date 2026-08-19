// Reads a superproject's submodule inventory straight from the filesystem. No `git` process is
// spawned: `.gitmodules` declares the members, and each member's Git directory carries HEAD plus
// the refs HEAD points at. Every read is defensive because a working copy can change mid-scan.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, isAbsolute, join, resolve } from 'node:path';
import type {
  SubmoduleEntry,
  SubmoduleEntryErrorCode,
  SubmodulesSnapshot
} from '@shared/submodules/submodules.type';

interface GitmodulesSection {
  name: string;
  path: string | null;
  url: string | null;
  branch: string | null;
}

export interface SubmoduleWatchTarget {
  path: string;
  recursive: boolean;
}

const SECTION_PATTERN = /^\[submodule\s+"(.+)"\]$/;
const PROPERTY_PATTERN = /^([A-Za-z0-9_.-]+)\s*=\s*(.*)$/;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/i;
const HEAD_REF_PATTERN = /^ref:\s*(\S+)$/;

const readTextFile = (path: string): string | null => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
};

const isDirectory = (path: string): boolean => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

const isFile = (path: string): boolean => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

export const parseGitmodules = (content: string): GitmodulesSection[] => {
  const sections: GitmodulesSection[] = [];
  let current: GitmodulesSection | null = null;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;

    const section = SECTION_PATTERN.exec(line);
    if (section) {
      current = { name: section[1], path: null, url: null, branch: null };
      sections.push(current);
      continue;
    }
    if (!current) continue;

    const property = PROPERTY_PATTERN.exec(line);
    if (!property) continue;
    const key = property[1].toLowerCase();
    const value = property[2].trim();
    if (key === 'path') current.path = value;
    else if (key === 'url') current.url = value;
    else if (key === 'branch') current.branch = value;
  }

  return sections.filter((section) => Boolean(section.path));
};

/**
 * An initialized submodule keeps a `.git` pointer file (`gitdir: ../../.git/modules/<name>`); an
 * independently cloned one keeps a real `.git` directory. Both shapes are accepted.
 */
export const resolveGitDirectory = (submodulePath: string): string | null => {
  const gitPath = join(submodulePath, '.git');
  if (isDirectory(gitPath)) return gitPath;
  if (!isFile(gitPath)) return null;

  const pointer = readTextFile(gitPath);
  if (!pointer) return null;
  const match = /^gitdir:\s*(.+)$/m.exec(pointer.trim());
  if (!match) return null;
  const target = match[1].trim();
  const resolved = isAbsolute(target) ? target : resolve(submodulePath, target);
  return isDirectory(resolved) ? resolved : null;
};

/** Linked worktrees keep their refs in the common directory instead of their own Git directory. */
const resolveCommonDirectory = (gitDirectory: string): string => {
  const commonDirPath = join(gitDirectory, 'commondir');
  if (!isFile(commonDirPath)) return gitDirectory;
  const target = readTextFile(commonDirPath)?.trim();
  if (!target) return gitDirectory;
  const resolved = isAbsolute(target) ? target : resolve(gitDirectory, target);
  return isDirectory(resolved) ? resolved : gitDirectory;
};

const readPackedRef = (commonDirectory: string, ref: string): string | null => {
  const packed = readTextFile(join(commonDirectory, 'packed-refs'));
  if (!packed) return null;
  for (const rawLine of packed.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('^')) continue;
    const separator = line.indexOf(' ');
    if (separator < 0) continue;
    if (line.slice(separator + 1).trim() !== ref) continue;
    const commit = line.slice(0, separator).trim();
    return COMMIT_PATTERN.test(commit) ? commit : null;
  }
  return null;
};

const readRef = (gitDirectory: string, ref: string): string | null => {
  const commonDirectory = resolveCommonDirectory(gitDirectory);
  for (const directory of new Set([gitDirectory, commonDirectory])) {
    const loose = readTextFile(join(directory, ref))?.trim();
    if (loose && COMMIT_PATTERN.test(loose)) return loose;
  }
  return readPackedRef(commonDirectory, ref);
};

interface HeadReading {
  branch: string | null;
  commit: string | null;
  errorCode: SubmoduleEntryErrorCode | null;
}

export const readHead = (gitDirectory: string): HeadReading => {
  const head = readTextFile(join(gitDirectory, 'HEAD'))?.trim();
  if (!head) return { branch: null, commit: null, errorCode: 'head-unreadable' };

  const symbolic = HEAD_REF_PATTERN.exec(head);
  if (symbolic) {
    const ref = symbolic[1];
    const branch = ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : ref;
    return { branch, commit: readRef(gitDirectory, ref), errorCode: null };
  }

  if (COMMIT_PATTERN.test(head)) return { branch: null, commit: head, errorCode: null };
  return { branch: null, commit: null, errorCode: 'head-malformed' };
};

const shortCommit = (commit: string | null): string | null => (commit ? commit.slice(0, 7) : null);

const describeSubmodule = (rootPath: string, section: GitmodulesSection): SubmoduleEntry => {
  const declaredPath = section.path as string;
  const absolutePath = resolve(rootPath, declaredPath);
  const base: Omit<SubmoduleEntry, 'state' | 'branch' | 'commit' | 'errorCode'> = {
    name: section.name,
    path: declaredPath,
    absolutePath,
    url: section.url,
    configuredBranch: section.branch
  };

  if (!isDirectory(absolutePath)) {
    return { ...base, state: 'missing', branch: null, commit: null, errorCode: null };
  }

  const gitDirectory = resolveGitDirectory(absolutePath);
  if (!gitDirectory) {
    const hasGitEntry = existsSync(join(absolutePath, '.git'));
    return {
      ...base,
      state: hasGitEntry ? 'error' : 'uninitialized',
      branch: null,
      commit: null,
      errorCode: hasGitEntry ? 'gitdir-unreadable' : null
    };
  }

  const head = readHead(gitDirectory);
  if (head.errorCode) {
    return { ...base, state: 'error', branch: null, commit: null, errorCode: head.errorCode };
  }
  return {
    ...base,
    state: head.branch ? 'ok' : 'detached',
    branch: head.branch,
    commit: shortCommit(head.commit),
    errorCode: null
  };
};

export const scanSubmodules = (rootPath: string): SubmodulesSnapshot => {
  const snapshot: SubmodulesSnapshot = {
    rootPath,
    rootName: basename(rootPath) || rootPath,
    scannedAt: Date.now(),
    watching: false,
    entries: [],
    error: null
  };

  if (!existsSync(rootPath)) return { ...snapshot, error: 'root-missing' };
  if (!isDirectory(rootPath)) return { ...snapshot, error: 'root-not-a-directory' };

  const gitmodulesPath = join(rootPath, '.gitmodules');
  if (!isFile(gitmodulesPath)) return { ...snapshot, error: 'gitmodules-missing' };

  const content = readTextFile(gitmodulesPath);
  if (content === null) return { ...snapshot, error: 'gitmodules-unreadable' };

  try {
    const entries = parseGitmodules(content)
      .map((section) => describeSubmodule(rootPath, section))
      .sort((left, right) => left.path.localeCompare(right.path));
    return { ...snapshot, entries };
  } catch {
    return { ...snapshot, error: 'scan-failed' };
  }
};

/**
 * Watch targets for one snapshot: the root (so `.gitmodules` edits are seen), every submodule Git
 * directory (HEAD, packed-refs), and every refs tree (nested branch names such as `dev/next`).
 */
export const collectWatchTargets = (snapshot: SubmodulesSnapshot): SubmoduleWatchTarget[] => {
  const targets: SubmoduleWatchTarget[] = [];
  if (!snapshot.rootPath) return targets;
  targets.push({ path: snapshot.rootPath, recursive: false });

  for (const entry of snapshot.entries) {
    if (entry.state === 'missing') continue;
    const gitDirectory = resolveGitDirectory(entry.absolutePath);
    if (!gitDirectory) {
      // An uninitialized submodule becomes interesting the moment its `.git` entry appears.
      if (isDirectory(entry.absolutePath)) {
        targets.push({ path: entry.absolutePath, recursive: false });
      }
      continue;
    }
    targets.push({ path: gitDirectory, recursive: false });

    const commonDirectory = resolveCommonDirectory(gitDirectory);
    for (const directory of new Set([gitDirectory, commonDirectory])) {
      const refsPath = join(directory, 'refs');
      if (isDirectory(refsPath)) targets.push({ path: refsPath, recursive: true });
    }
  }

  const seen = new Set<string>();
  return targets.filter((target) => {
    const key = `${target.recursive ? 'r' : 'f'}:${target.path}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};
