import { randomUUID } from 'node:crypto';
import { chmodSync, lstatSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { posix, win32 } from 'node:path';
import { parseClaudeJobId, parseUuid } from '@shared/codingAgent/codingAgentSession.contract';
import type { CodingAgentTerminalAction } from '@shared/codingAgent/codingAgentSession.type';
import {
  requireExistingAbsoluteDirectory,
  type CodingAgentTerminalTarget
} from './codingAgentTarget';
import {
  unavailableClaudeExecutableProvider,
  validateClaudeExecutableForTarget,
  type ClaudeExecutableProvider
} from './claudeExecutable.resolver';

interface ResolvedTerminalTarget {
  action: CodingAgentTerminalAction;
  args: readonly string[];
  cwd: string;
}

export interface CodingAgentTerminalLauncherDependencies {
  userDataPath: string;
  appPath: string;
  openPath: (path: string) => Promise<string>;
  platform?: NodeJS.Platform;
  idFactory?: () => string;
  executableProvider?: ClaudeExecutableProvider;
  now?: () => number;
}

const MAX_LAUNCH_FILES = 16;
const MAX_LAUNCH_FILE_AGE_MS = 24 * 60 * 60 * 1000;
const LAUNCH_FILE_PATTERN =
  /^claude-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:command|cmd)$/i;

const assertSingleLine = (value: string, label: string): string => {
  if (!value || /[\0\r\n]/.test(value)) {
    throw new Error(`${label} must be a non-empty single-line string`);
  }
  return value;
};

const platformPath = (platform: NodeJS.Platform): typeof posix | typeof win32 => {
  return platform === 'win32' ? win32 : posix;
};

const normalizeTarget = (target: CodingAgentTerminalTarget): ResolvedTerminalTarget => {
  const cwd = requireExistingAbsoluteDirectory(target.cwd);
  if (target.kind === 'claude-attach') {
    return {
      action: 'attach',
      args: ['attach', parseClaudeJobId(target.jobId)],
      cwd
    };
  }
  return {
    action: 'resume',
    args: ['--resume', parseUuid(target.sessionId, 'Claude session id')],
    cwd
  };
};

const posixQuote = (value: string): string => {
  const safe = assertSingleLine(value, 'terminal argument');
  return `'${safe.replace(/'/g, `'\\''`)}'`;
};

const windowsQuote = (value: string): string => {
  const safe = assertSingleLine(value, 'terminal argument');
  if (safe.includes('"'))
    throw new Error('Windows terminal arguments cannot contain double quotes');
  return `"${safe.replace(/%/g, '%%')}"`;
};

export const createPosixClaudeTerminalScript = (params: {
  executable: string;
  target: ResolvedTerminalTarget;
}): string => {
  const command = [params.executable, ...params.target.args].map(posixQuote).join(' ');
  return [
    '#!/bin/sh',
    `cd ${posixQuote(params.target.cwd)} || exit 1`,
    'rm -f -- "$0" || exit 1',
    `exec ${command}`,
    ''
  ].join('\n');
};

export const createWindowsClaudeTerminalScript = (params: {
  executable: string;
  target: ResolvedTerminalTarget;
}): string => {
  // The provider command is last so .cmd/.bat can transfer control without CALL's second expansion.
  const command = [params.executable, ...params.target.args].map(windowsQuote).join(' ');
  return [
    '@echo off',
    'setlocal DisableDelayedExpansion',
    `cd /d ${windowsQuote(params.target.cwd)} || exit /b 1`,
    `del /f /q "%~f0" >nul 2>nul & if exist "%~f0" exit /b 1 & ${command}`,
    ''
  ].join('\r\n');
};

const cleanupLaunchFiles = (
  launchDirectory: string,
  platform: NodeJS.Platform,
  now: number
): void => {
  const candidates: Array<{ path: string; mtimeMs: number }> = [];
  try {
    for (const entry of readdirSync(launchDirectory, { withFileTypes: true })) {
      if (!entry.isFile() || !LAUNCH_FILE_PATTERN.test(entry.name)) continue;
      const filePath = platformPath(platform).join(launchDirectory, entry.name);
      try {
        const stat = lstatSync(filePath);
        if (stat.isFile()) candidates.push({ path: filePath, mtimeMs: stat.mtimeMs });
      } catch {
        // A concurrent launcher may have removed the file already.
      }
    }
  } catch {
    return;
  }
  candidates.sort((left, right) => right.mtimeMs - left.mtimeMs);
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    if (index < MAX_LAUNCH_FILES - 1 && now - candidate.mtimeMs <= MAX_LAUNCH_FILE_AGE_MS) {
      continue;
    }
    try {
      unlinkSync(candidate.path);
    } catch {
      // Cleanup is best-effort and a one-use script also removes itself on execution.
    }
  }
};

export class CodingAgentTerminalLauncher {
  private readonly platform: NodeJS.Platform;
  private readonly idFactory: () => string;

  constructor(private readonly dependencies: CodingAgentTerminalLauncherDependencies) {
    this.platform = dependencies.platform ?? process.platform;
    this.idFactory = dependencies.idFactory ?? randomUUID;
  }

  async launch(targetValue: CodingAgentTerminalTarget): Promise<CodingAgentTerminalAction> {
    if (this.platform !== 'darwin' && this.platform !== 'win32') {
      throw new Error('Claude terminal launching is supported only on macOS and Windows');
    }
    const target = normalizeTarget(targetValue);
    const executablePath = validateClaudeExecutableForTarget({
      executable: (
        this.dependencies.executableProvider ?? unavailableClaudeExecutableProvider
      ).resolve(),
      platform: this.platform,
      appPath: this.dependencies.appPath,
      cwd: target.cwd
    });
    const path = platformPath(this.platform);

    const launchDirectory = path.join(this.dependencies.userDataPath, 'coding-agent', 'launch');
    mkdirSync(launchDirectory, { recursive: true, mode: 0o700 });
    if (this.platform !== 'win32') chmodSync(launchDirectory, 0o700);
    cleanupLaunchFiles(launchDirectory, this.platform, this.dependencies.now?.() ?? Date.now());
    const launchId = parseUuid(this.idFactory(), 'terminal launch id');
    const extension = this.platform === 'win32' ? '.cmd' : '.command';
    const launchPath = path.join(launchDirectory, `claude-${launchId}${extension}`);
    const script =
      this.platform === 'win32'
        ? createWindowsClaudeTerminalScript({ executable: executablePath, target })
        : createPosixClaudeTerminalScript({ executable: executablePath, target });
    // Windows inherits the current user's userData ACL; POSIX permissions are enforced below.
    writeFileSync(launchPath, script, {
      flag: 'wx',
      mode: this.platform === 'win32' ? 0o600 : 0o700
    });
    if (this.platform !== 'win32') chmodSync(launchPath, 0o700);

    try {
      const error = await this.dependencies.openPath(launchPath);
      if (error) throw new Error('The operating system could not open the terminal launcher');
      return target.action;
    } catch (error) {
      try {
        unlinkSync(launchPath);
      } catch {
        // The launch file may already have been accepted or removed by the operating system.
      }
      throw error;
    }
  }
}
