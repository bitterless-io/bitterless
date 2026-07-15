import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type {
  CodingAgentDiscoveryIssue,
  CodingAgentDiscoveryResult,
  CodingAgentSessionDraft
} from '@shared/codingAgent/codingAgentSession.type';
import {
  isPlainRecord,
  normalizeCodexThreadStatus,
  parseNullableText,
  parsePathText,
  parseUuid
} from '@shared/codingAgent/codingAgentSession.contract';

interface CodexAppServerOptions {
  executable?: string;
  args?: readonly string[];
  timeoutMs?: number;
  maxOutputBytes?: number;
}

export interface CodexDiscoveryOptions extends CodexAppServerOptions {
  listThreads?: () => Promise<unknown[]>;
  idFactory?: () => string;
}

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const MAX_PAGES = 100;

const assertPositiveInteger = (value: number, label: string): number => {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value;
};

export const listCodexThreadsViaAppServer = (
  options: CodexAppServerOptions = {}
): Promise<unknown[]> => {
  const executable = options.executable ?? 'codex';
  const args = options.args ? [...options.args] : ['app-server', '--stdio'];
  const timeoutMs = assertPositiveInteger(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 'timeoutMs');
  const maxOutputBytes = assertPositiveInteger(
    options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
    'maxOutputBytes'
  );

  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      env: process.env,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    });
    let settled = false;
    let stdoutBuffer = '';
    let stderrBuffer = '';
    let outputBytes = 0;
    let requestId = 2;
    let pageCount = 0;
    const threads: unknown[] = [];

    const stop = (): void => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill('SIGTERM');
      const forceKill = setTimeout(() => child.kill('SIGKILL'), 250);
      forceKill.unref();
    };
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      stop();
      reject(error);
    };
    const succeed = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      stop();
      resolve(threads);
    };
    const send = (message: Record<string, unknown>): void => {
      try {
        child.stdin.write(`${JSON.stringify(message)}\n`);
      } catch (error) {
        fail(new Error(`Unable to write to Codex App Server: ${String(error)}`));
      }
    };
    const requestPage = (cursor: string | null): void => {
      pageCount += 1;
      if (pageCount > MAX_PAGES) {
        fail(new Error(`Codex thread/list exceeded ${MAX_PAGES} pages`));
        return;
      }
      requestId += 1;
      send({
        method: 'thread/list',
        id: requestId,
        params: { cursor, limit: 100, useStateDbOnly: true }
      });
    };
    const handleMessage = (message: unknown): void => {
      if (!isPlainRecord(message)) {
        fail(new Error('Codex App Server returned a non-object JSON-RPC message'));
        return;
      }
      if (message.id === 1) {
        if (message.error !== undefined) {
          fail(new Error('Codex App Server rejected initialize'));
          return;
        }
        send({ method: 'initialized' });
        requestPage(null);
        return;
      }
      if (typeof message.id !== 'number' || message.id < 3) return;
      if (message.error !== undefined) {
        fail(new Error('Codex App Server rejected thread/list'));
        return;
      }
      if (!isPlainRecord(message.result) || !Array.isArray(message.result.data)) {
        fail(new Error('Codex thread/list response is invalid'));
        return;
      }
      const nextCursor = message.result.nextCursor;
      if (nextCursor !== null && nextCursor !== undefined && typeof nextCursor !== 'string') {
        fail(new Error('Codex thread/list nextCursor is invalid'));
        return;
      }
      threads.push(...message.result.data);
      if (threads.length > 10_000) {
        fail(new Error('Codex thread/list exceeded 10000 entries'));
        return;
      }
      if (typeof nextCursor === 'string' && nextCursor.length > 0) requestPage(nextCursor);
      else succeed();
    };
    const processLines = (): void => {
      let newline = stdoutBuffer.indexOf('\n');
      while (newline >= 0) {
        const line = stdoutBuffer.slice(0, newline).trim();
        stdoutBuffer = stdoutBuffer.slice(newline + 1);
        if (line) {
          let parsed: unknown;
          try {
            parsed = JSON.parse(line);
          } catch {
            fail(new Error('Codex App Server returned invalid JSON'));
            return;
          }
          handleMessage(parsed);
          if (settled) return;
        }
        newline = stdoutBuffer.indexOf('\n');
      }
    };
    const capture = (chunk: Buffer, isStdout: boolean): void => {
      if (settled) return;
      outputBytes += chunk.length;
      if (outputBytes > maxOutputBytes) {
        fail(new Error(`Codex App Server output exceeded ${maxOutputBytes} bytes`));
        return;
      }
      if (isStdout) {
        stdoutBuffer += chunk.toString('utf8');
        processLines();
      } else {
        stderrBuffer += chunk.toString('utf8');
      }
    };

    const timeout = setTimeout(() => {
      fail(new Error(`Codex App Server thread/list timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => capture(chunk, true));
    child.stderr.on('data', (chunk: Buffer) => capture(chunk, false));
    child.stdin.on('error', (error) =>
      fail(new Error(`Codex App Server stdin failed: ${error.message}`))
    );
    child.once('error', (error) =>
      fail(new Error(`Unable to start Codex App Server: ${error.message}`))
    );
    child.once('close', (code, signal) => {
      if (!settled) {
        fail(
          new Error(
            `Codex App Server exited before thread/list completed (${code ?? signal ?? 'unknown'}): ${stderrBuffer.trim()}`
          )
        );
      }
    });

    send({
      method: 'initialize',
      id: 1,
      params: {
        clientInfo: { name: 'bitterless', title: 'Bitterless', version: '1' },
        capabilities: null
      }
    });
  });
};

export class CodexDiscoveryAdapter {
  private readonly listThreads: () => Promise<unknown[]>;
  private readonly idFactory: () => string;

  constructor(options: CodexDiscoveryOptions = {}) {
    this.listThreads = options.listThreads ?? (() => listCodexThreadsViaAppServer(options));
    this.idFactory = options.idFactory ?? randomUUID;
  }

  async discover(): Promise<CodingAgentDiscoveryResult> {
    let entries: unknown[];
    try {
      entries = await this.listThreads();
    } catch (error) {
      return {
        provider: 'codex',
        sessions: [],
        issues: [
          {
            provider: 'codex',
            code: 'command-failed',
            message: error instanceof Error ? error.message : String(error)
          }
        ]
      };
    }
    const sessions: CodingAgentSessionDraft[] = [];
    const issues: CodingAgentDiscoveryIssue[] = [];
    for (const [entryIndex, entry] of entries.entries()) {
      if (!isPlainRecord(entry)) {
        issues.push({
          provider: 'codex',
          code: 'invalid-entry',
          message: 'Codex thread/list entry must be an object',
          entryIndex
        });
        continue;
      }
      try {
        const externalSessionId = parseUuid(entry.id, 'Codex thread id');
        const normalized = normalizeCodexThreadStatus(entry.status, { authoritative: false });
        if (!normalized.recognized) {
          issues.push({
            provider: 'codex',
            code: 'unsupported-entry',
            message: `Codex thread status is unsupported: ${normalized.providerState ?? 'missing'}`,
            entryIndex
          });
        }
        sessions.push({
          id: this.idFactory(),
          provider: 'codex',
          surface: 'codex-desktop',
          externalSessionId,
          runtimeJobId: null,
          title: parseNullableText(entry.name, 'Codex thread name', 300),
          cwd: parsePathText(entry.cwd),
          state: 'unknown',
          lastTurnState: 'unknown',
          providerState: normalized.providerState,
          statusSource: 'none',
          statusObservedAt: null,
          statusFreshUntil: null,
          isProcessAlive: null
        });
      } catch (error) {
        issues.push({
          provider: 'codex',
          code: 'invalid-entry',
          message: error instanceof Error ? error.message : String(error),
          entryIndex
        });
      }
    }
    return { provider: 'codex', sessions, issues };
  }
}
