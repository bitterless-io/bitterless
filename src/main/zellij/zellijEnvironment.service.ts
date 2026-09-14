import { lstatSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from '@bgotink/kdl/v1-compat';
import type { ApplicationRuntimeProfileId } from '@shared/diagnostics/applicationDiagnostics.contract';

export const resolveZellijChildEnvironment = (
  profile: ApplicationRuntimeProfileId,
  options: { platform: NodeJS.Platform; env: NodeJS.ProcessEnv; uid?: number }
): NodeJS.ProcessEnv => {
  const env = { ...options.env };
  // This is an interactive GUI terminal, even when its launcher is a noninteractive build/agent.
  // User KDL env and shell startup files are applied later and remain the explicit override points.
  env.TERM = 'xterm-256color';
  env.COLORTERM = 'truecolor';
  env.CLICOLOR = '1';
  for (const key of ['NO_COLOR', 'NODE_DISABLE_COLORS', 'FORCE_COLOR', 'CLICOLOR_FORCE'])
    delete env[key];
  if (options.platform !== 'darwin' || env.ZELLIJ_SOCKET_DIR) return env;
  const uid = options.uid;
  if (typeof uid !== 'number' || !Number.isInteger(uid) || uid < 0 || uid > 0xffffffff) {
    throw new Error('operation-failed');
  }
  // Darwin allows 103 socket-path bytes. A 32-bit uid in base 36 + our longest profile id +
  // /contract_version_1/ + the longest session name uses at most 101 bytes.
  return { ...env, ZELLIJ_SOCKET_DIR: `/tmp/bz${uid.toString(36)}-${profile}` };
};

export const resolveZellijShellAssetDirectory = (options: {
  packaged: boolean;
  appPath: string;
  resourcesPath: string;
}): string =>
  options.packaged
    ? join(options.resourcesPath, 'zellij-shell')
    : join(options.appPath, 'resources', 'zellij');

export const resolveZellijSessionEnvironment = (
  env: NodeJS.ProcessEnv,
  source: string
): {
  env: NodeJS.ProcessEnv;
  explicitDefaultShell: boolean;
  explicitZdotdir: boolean;
} => {
  const config = parse(source);
  const configured = config.nodes.find((node) => node.getName() === 'env');
  const result = { ...env };
  for (const node of configured?.children?.nodes ?? []) {
    const value = node.getArguments()[0];
    if (typeof value === 'string' || typeof value === 'number')
      result[node.getName()] = String(value);
  }
  return {
    env: result,
    explicitDefaultShell: config.nodes.some((node) => node.getName() === 'default_shell'),
    explicitZdotdir:
      configured?.children?.nodes.some((node) => node.getName() === 'ZDOTDIR') ?? false
  };
};

export const ensureZellijSocketDirectory = (directory: string, uid: number): void => {
  try {
    mkdirSync(directory, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  const status = lstatSync(directory);
  if (
    !status.isDirectory() ||
    status.isSymbolicLink() ||
    status.uid !== uid ||
    status.mode & 0o077
  ) {
    throw new Error('Zellij socket directory must be private and owned by the current user');
  }
};

export const prepareZellijChildEnvironment = (
  profile: ApplicationRuntimeProfileId
): NodeJS.ProcessEnv => {
  const uid = process.getuid?.();
  const env = resolveZellijChildEnvironment(profile, {
    platform: process.platform,
    env: process.env,
    uid
  });
  // Explicit user overrides remain under their control. Never change global TMPDIR or env,
  // remove existing sockets, or repair another process's directory.
  if (process.platform === 'darwin' && !process.env.ZELLIJ_SOCKET_DIR) {
    try {
      const directory = env.ZELLIJ_SOCKET_DIR;
      if (!directory || uid === undefined) throw new Error('operation-failed');
      ensureZellijSocketDirectory(directory, uid);
    } catch {
      console.error('[zellij] managed socket directory is unavailable or unsafe');
      throw new Error('operation-failed');
    }
  }
  return env;
};
