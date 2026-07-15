import { isAbsolute, normalize, resolve } from 'node:path';
import { statSync } from 'node:fs';
import type {
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

export type CodingAgentTerminalTarget =
  | {
      kind: 'claude-attach';
      jobId: string;
      cwd: string;
    }
  | {
      kind: 'claude-resume';
      sessionId: string;
      cwd: string;
    };

export type ClaudeCommandTargetResult =
  | { kind: 'terminal-target'; target: CodingAgentTerminalTarget }
  | Extract<OpenCodingAgentSessionResult, { kind: 'already-open' | 'unavailable' }>;

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
): ClaudeCommandTargetResult => {
  if (record.surface === 'claude-code-background') {
    if (record.runtimeJobId === null) {
      return { kind: 'unavailable', reason: 'Claude background job id is unavailable' };
    }
    const target: CodingAgentTerminalTarget = {
      kind: 'claude-attach',
      jobId: parseClaudeJobId(record.runtimeJobId),
      cwd: requireExistingAbsoluteDirectory(record.cwd, inspector)
    };
    return { kind: 'terminal-target', target };
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
  const target: CodingAgentTerminalTarget = {
    kind: 'claude-resume',
    sessionId: parseUuid(record.externalSessionId, 'Claude session id'),
    cwd: requireExistingAbsoluteDirectory(record.cwd, inspector)
  };
  return { kind: 'terminal-target', target };
};
