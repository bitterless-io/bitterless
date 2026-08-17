import { accessSync, constants, existsSync, realpathSync, statSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';

export const resolveClaudeExecutables = (params: {
  platform?: NodeJS.Platform;
  homePath: string;
  pathValue?: string;
}): string[] => {
  const platform = params.platform ?? process.platform;
  const candidates = platform === 'win32'
    ? [join(params.homePath, '.local', 'bin', 'claude.exe'), join(params.homePath, '.claude', 'local', 'claude.exe')]
    : [
        join(params.homePath, '.local', 'bin', 'claude'),
        join(params.homePath, '.claude', 'local', 'claude'),
        '/opt/homebrew/bin/claude',
        '/usr/local/bin/claude'
      ];
  const allowlistedDirectories = new Set(candidates.map(dirname));
  const pathOrdered = (params.pathValue ?? process.env.PATH ?? '')
    .split(delimiter)
    .filter((directory) => allowlistedDirectories.has(directory))
    .map((directory) => join(directory, platform === 'win32' ? 'claude.exe' : 'claude'));
  const resolved: string[] = [];
  for (const candidate of [...pathOrdered, ...candidates]) {
    try {
      if (!existsSync(candidate)) continue;
      const canonical = realpathSync.native(candidate);
      if (!statSync(canonical).isFile()) continue;
      if (platform !== 'win32') accessSync(canonical, constants.X_OK);
      if (!resolved.includes(canonical)) resolved.push(canonical);
    } catch {
      // Try the next fixed allowlisted installation location.
    }
  }
  return resolved;
};

export const resolveClaudeExecutable = (params: {
  platform?: NodeJS.Platform;
  homePath: string;
  pathValue?: string;
}): string | null => resolveClaudeExecutables(params)[0] ?? null;
