import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, isAbsolute, join, parse, resolve, sep } from 'node:path';

export interface ClaudeObservationRoots {
  desktopRoots: string[];
  projectsRoot: string | null;
}

export interface ClaudeDirectoryResolution {
  roots: ClaudeObservationRoots;
  effectiveDirectory: string;
  projectsDirectory: string;
  configDirectoryAvailable: boolean;
  projectsDirectoryAvailable: boolean;
}

export const canonicalClaudeDirectory = (path: string): string | null => {
  try {
    if (!isAbsolute(path) || !existsSync(path)) return null;
    const stat = lstatSync(path);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return null;
    const canonical = realpathSync.native(path);
    return lstatSync(canonical).isDirectory() ? canonical : null;
  } catch {
    return null;
  }
};

export const requireCanonicalClaudeConfigDirectory = (path: string): string => {
  if (typeof path !== 'string' || path.length === 0 || path.includes('\0')) {
    throw new Error('Claude config directory is invalid');
  }
  if (Buffer.byteLength(path, 'utf8') > 4_096 || !isAbsolute(path)) {
    throw new Error('Claude config directory must be a bounded absolute path');
  }
  const canonical = canonicalClaudeDirectory(path);
  if (canonical === null) {
    throw new Error('Claude config directory must be an existing non-symlink directory');
  }
  if (canonical === parse(canonical).root) {
    throw new Error('Claude config directory cannot be a filesystem root');
  }
  return canonical;
};

export const resolveClaudeDesktopRoots = (params: {
  platform?: NodeJS.Platform;
  homePath?: string;
  env?: NodeJS.ProcessEnv;
} = {}): string[] => {
  const platform = params.platform ?? process.platform;
  const homePath = params.homePath ?? homedir();
  const env = params.env ?? process.env;
  const desktopCandidates = platform === 'darwin'
    ? [join(homePath, 'Library', 'Application Support', 'Claude', 'claude-code-sessions')]
    : platform === 'win32'
      ? [env.APPDATA, env.LOCALAPPDATA]
          .filter((value): value is string => typeof value === 'string' && isAbsolute(value))
          .map((value) => join(value, 'Claude', 'claude-code-sessions'))
      : [join(homePath, '.config', 'Claude', 'claude-code-sessions')];
  return [...new Set(desktopCandidates
    .map(canonicalClaudeDirectory)
    .filter((value): value is string => value !== null))];
};

export const resolveAutomaticClaudeConfigDirectory = (params: {
  homePath?: string;
  env?: NodeJS.ProcessEnv;
} = {}): string => {
  const homePath = params.homePath ?? homedir();
  const env = params.env ?? process.env;
  const configured = env.CLAUDE_CONFIG_DIR;
  if (typeof configured === 'string' && configured.length > 0 && isAbsolute(configured)) {
    try {
      return requireCanonicalClaudeConfigDirectory(configured);
    } catch {
      // Invalid inherited configuration falls back to the platform default.
    }
  }
  return resolve(homePath, '.claude');
};

export const resolveClaudeDirectory = (params: {
  configDirectory: string;
  platform?: NodeJS.Platform;
  homePath?: string;
  env?: NodeJS.ProcessEnv;
}): ClaudeDirectoryResolution => {
  const effectiveDirectory = canonicalClaudeDirectory(params.configDirectory) ??
    resolve(params.configDirectory);
  const canonicalConfigDirectory = canonicalClaudeDirectory(params.configDirectory);
  const projectsDirectory = join(effectiveDirectory, 'projects');
  const projectsRoot = canonicalConfigDirectory === null
    ? null
    : canonicalClaudeDirectory(projectsDirectory);
  return {
    roots: {
      desktopRoots: resolveClaudeDesktopRoots(params),
      projectsRoot
    },
    effectiveDirectory,
    projectsDirectory,
    configDirectoryAvailable: canonicalConfigDirectory !== null,
    projectsDirectoryAvailable: projectsRoot !== null
  };
};

export const isPathInsideRoot = (root: string, candidate: string): boolean => {
  const normalizedRoot = resolve(root);
  const normalizedCandidate = resolve(candidate);
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}${sep}`);
};

export const resolveClaudeObservationRoots = (params: {
  platform?: NodeJS.Platform;
  homePath?: string;
  env?: NodeJS.ProcessEnv;
} = {}): ClaudeObservationRoots => {
  const homePath = params.homePath ?? homedir();
  const env = params.env ?? process.env;
  const configDirectory = resolveAutomaticClaudeConfigDirectory({ homePath, env });
  return resolveClaudeDirectory({
    configDirectory,
    platform: params.platform,
    homePath,
    env
  }).roots;
};

export const requireCanonicalClaudeTranscript = (params: {
  transcriptPath: string;
  projectsRoot: string;
  expectedThreadId: string;
}): string => {
  if (!isAbsolute(params.transcriptPath)) throw new Error('Claude transcript path must be absolute');
  const canonicalRoot = canonicalClaudeDirectory(params.projectsRoot);
  if (canonicalRoot === null) throw new Error('Claude projects root is unavailable');
  const stat = lstatSync(params.transcriptPath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Claude transcript must be a regular file');
  const canonical = realpathSync.native(params.transcriptPath);
  if (!isPathInsideRoot(canonicalRoot, canonical)) throw new Error('Claude transcript escaped its projects root');
  if (basename(canonical).toLowerCase() !== `${params.expectedThreadId}.jsonl`.toLowerCase()) {
    throw new Error('Claude transcript identity does not match its session');
  }
  const relative = canonical.slice(canonicalRoot.length + 1).split(sep);
  if (relative.length !== 2 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.jsonl$/i.test(relative[1])) {
    throw new Error('Claude transcript path shape is invalid');
  }
  const projectStat = lstatSync(join(canonicalRoot, relative[0]));
  if (!projectStat.isDirectory() || projectStat.isSymbolicLink()) {
    throw new Error('Claude transcript project directory is invalid');
  }
  return canonical;
};
