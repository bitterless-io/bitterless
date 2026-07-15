import { isAbsolute, normalize, resolve } from 'node:path';
import { statSync } from 'node:fs';
import type {
  CodingAgentCommandTarget,
  CodingAgentSessionRecord,
  OpenCodingAgentSessionResult
} from '@shared/codingAgent/codingAgentSession.type';
import {
  parseClaudeJobId,
  parsePathText,
  parseUuid
} from '@shared/codingAgent/codingAgentSession.contract';

export interface DirectoryInspector {
  isDirectory(path: string): boolean;
}

const defaultDirectoryInspector: DirectoryInspector = {
  isDirectory: (path: string): boolean => {
    try {
      return statSync(path).isDirectory();
    } catch {
      return false;
    }
  }
};

export const requireExistingAbsoluteDirectory = (
  value: unknown,
  inspector: DirectoryInspector = defaultDirectoryInspector
): string => {
  const path = parsePathText(value);
  if (path === null || !isAbsolute(path)) {
    throw new Error('cwd must be an absolute directory path');
  }
  const canonical = normalize(resolve(path));
  if (!inspector.isDirectory(canonical)) {
    throw new Error('cwd must reference an existing directory');
  }
  return canonical;
};

export const buildCodexThreadDeepLink = (threadId: unknown): string => {
  return `codex://threads/${parseUuid(threadId, 'Codex thread id')}`;
};

export const buildClaudeCommandTarget = (
  record: CodingAgentSessionRecord,
  inspector: DirectoryInspector = defaultDirectoryInspector
): OpenCodingAgentSessionResult => {
  if (record.surface === 'claude-code-background') {
    if (record.runtimeJobId === null) {
      return { kind: 'unavailable', reason: 'Claude background job id is unavailable' };
    }
    const target: CodingAgentCommandTarget = {
      kind: 'claude-attach',
      executable: 'claude',
      args: ['attach', parseClaudeJobId(record.runtimeJobId)],
      cwd: requireExistingAbsoluteDirectory(record.cwd, inspector)
    };
    return { kind: 'terminal-command', target };
  }

  if (record.surface !== 'claude-code-cli') {
    return { kind: 'unavailable', reason: 'This Claude surface has no CLI attach target' };
  }
  if (record.isProcessAlive === true) {
    return {
      kind: 'already-open',
      message: 'The Claude Code session is already open in another terminal'
    };
  }
  if (record.isProcessAlive !== false) {
    return {
      kind: 'unavailable',
      reason: 'The Claude Code process state is unknown; automatic resume is disabled'
    };
  }
  const target: CodingAgentCommandTarget = {
    kind: 'claude-resume',
    executable: 'claude',
    args: ['--resume', parseUuid(record.externalSessionId, 'Claude session id')],
    cwd: requireExistingAbsoluteDirectory(record.cwd, inspector)
  };
  return { kind: 'terminal-command', target };
};
