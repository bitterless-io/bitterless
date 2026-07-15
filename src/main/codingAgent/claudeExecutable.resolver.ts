import { accessSync, constants, existsSync, realpathSync, statSync } from 'node:fs';
import { delimiter, posix, win32 } from 'node:path';
import { parsePathText } from '@shared/codingAgent/codingAgentSession.contract';

export interface ClaudeExecutableProvider {
  resolve(): string;
}

export interface ClaudeExecutableResolverOptions {
  appPath: string;
  homePath: string;
  configuredPath?: string | null;
  platform?: NodeJS.Platform;
  pathValue?: string;
  trustedCandidatePaths?: readonly string[];
}

export class ClaudeExecutableUnavailableError extends Error {
  constructor() {
    super('Claude Code CLI executable is unavailable');
    this.name = 'ClaudeExecutableUnavailableError';
  }
}

const platformPath = (platform: NodeJS.Platform): typeof posix | typeof win32 => {
  return platform === 'win32' ? win32 : posix;
};

const comparablePath = (value: string, platform: NodeJS.Platform): string => {
  const normalized = platformPath(platform).normalize(value);
  return platform === 'win32' ? normalized.toLowerCase() : normalized;
};

const isInside = (root: string, candidate: string, platform: NodeJS.Platform): boolean => {
  const path = platformPath(platform);
  const relative = path.relative(root, candidate);
  const escapesRoot =
    relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
  return !escapesRoot;
};

const resolveApplicationRoot = (appPath: string, platform: NodeJS.Platform): string => {
  const path = platformPath(platform);
  const resolved = realpathSync(appPath);
  const applicationPath = statSync(resolved).isDirectory() ? resolved : path.dirname(resolved);
  if (platform === 'darwin') {
    let directory = applicationPath;
    while (true) {
      if (path.basename(directory).toLowerCase().endsWith('.app')) return directory;
      const parent = path.dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
  }
  if (platform === 'win32' && path.basename(applicationPath).toLowerCase() === 'resources') {
    return path.dirname(applicationPath);
  }
  return applicationPath;
};

const isInsideGitWorktree = (candidate: string, platform: NodeJS.Platform): boolean => {
  const path = platformPath(platform);
  let directory = path.dirname(candidate);
  while (true) {
    if (existsSync(path.join(directory, '.git'))) return true;
    const parent = path.dirname(directory);
    if (parent === directory) return false;
    directory = parent;
  }
};

const defaultTrustedCandidates = (
  platform: NodeJS.Platform,
  homePath: string
): readonly string[] => {
  const path = platformPath(platform);
  if (platform === 'darwin') {
    return [
      '/opt/homebrew/bin/claude',
      '/usr/local/bin/claude',
      path.join(homePath, '.local', 'bin', 'claude')
    ];
  }
  if (platform === 'win32') {
    return [path.join(homePath, '.local', 'bin', 'claude.exe')];
  }
  return [];
};

const trustedCandidatesInOrder = (params: {
  candidates: readonly string[];
  pathValue: string;
  platform: NodeJS.Platform;
}): string[] => {
  const path = platformPath(params.platform);
  const separator = params.platform === 'win32' ? ';' : delimiter;
  const byDirectory = new Map<string, string>();
  for (const candidate of params.candidates) {
    byDirectory.set(comparablePath(path.dirname(candidate), params.platform), candidate);
  }

  const ordered: string[] = [];
  const seen = new Set<string>();
  for (const entry of params.pathValue.split(separator)) {
    const directory = entry.trim().replace(/^"|"$/g, '');
    if (!directory || !path.isAbsolute(directory)) continue;
    const candidate = byDirectory.get(comparablePath(directory, params.platform));
    if (!candidate || seen.has(candidate)) continue;
    ordered.push(candidate);
    seen.add(candidate);
  }
  for (const candidate of params.candidates) {
    if (seen.has(candidate)) continue;
    ordered.push(candidate);
    seen.add(candidate);
  }
  return ordered;
};

const validateCandidate = (params: {
  candidate: string;
  appPath: string;
  platform: NodeJS.Platform;
}): string => {
  const path = platformPath(params.platform);
  let candidate: string | null;
  try {
    candidate = parsePathText(params.candidate, 'Claude executable');
  } catch {
    throw new ClaudeExecutableUnavailableError();
  }
  if (candidate === null || !path.isAbsolute(candidate)) {
    throw new ClaudeExecutableUnavailableError();
  }
  try {
    if (!statSync(candidate).isFile()) throw new Error('not a file');
    accessSync(candidate, params.platform === 'win32' ? constants.F_OK : constants.X_OK);
    const canonical = realpathSync(candidate);
    const applicationRoot = resolveApplicationRoot(params.appPath, params.platform);
    if (
      isInside(applicationRoot, path.normalize(candidate), params.platform) ||
      isInside(applicationRoot, canonical, params.platform)
    ) {
      throw new Error('inside application path');
    }
    if (
      isInsideGitWorktree(path.normalize(candidate), params.platform) ||
      isInsideGitWorktree(canonical, params.platform)
    ) {
      throw new Error('inside git worktree');
    }
    return canonical;
  } catch {
    throw new ClaudeExecutableUnavailableError();
  }
};

export const validateClaudeExecutableForTarget = (params: {
  executable: string;
  cwd: string;
  appPath: string;
  platform: NodeJS.Platform;
}): string => {
  const canonical = validateCandidate({
    candidate: params.executable,
    appPath: params.appPath,
    platform: params.platform
  });
  try {
    const canonicalCwd = realpathSync(params.cwd);
    if (isInside(canonicalCwd, canonical, params.platform)) {
      throw new Error('inside target cwd');
    }
    return canonical;
  } catch {
    throw new ClaudeExecutableUnavailableError();
  }
};

export class CanonicalClaudeExecutableResolver implements ClaudeExecutableProvider {
  private readonly platform: NodeJS.Platform;
  private readonly candidates: readonly string[];
  private cachedPath: string | null = null;

  constructor(private readonly options: ClaudeExecutableResolverOptions) {
    this.platform = options.platform ?? process.platform;
    this.candidates =
      options.trustedCandidatePaths ?? defaultTrustedCandidates(this.platform, options.homePath);
  }

  resolve(): string {
    if (this.cachedPath !== null) return this.cachedPath;
    if (this.platform !== 'darwin' && this.platform !== 'win32') {
      throw new ClaudeExecutableUnavailableError();
    }

    const configuredPath = this.options.configuredPath;
    if (configuredPath != null && configuredPath.trim()) {
      this.cachedPath = validateCandidate({
        candidate: configuredPath,
        appPath: this.options.appPath,
        platform: this.platform
      });
      return this.cachedPath;
    }

    const candidates = trustedCandidatesInOrder({
      candidates: this.candidates,
      pathValue: this.options.pathValue ?? process.env.PATH ?? '',
      platform: this.platform
    });
    for (const candidate of candidates) {
      try {
        this.cachedPath = validateCandidate({
          candidate,
          appPath: this.options.appPath,
          platform: this.platform
        });
        return this.cachedPath;
      } catch {
        // Only fixed allowlisted candidates are tried; arbitrary PATH entries are never scanned.
      }
    }
    throw new ClaudeExecutableUnavailableError();
  }
}

export const unavailableClaudeExecutableProvider: ClaudeExecutableProvider = {
  resolve: (): string => {
    throw new ClaudeExecutableUnavailableError();
  }
};
