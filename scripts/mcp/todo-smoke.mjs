#!/usr/bin/env node

/* eslint-disable @typescript-eslint/explicit-function-return-type */

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_SETTLEMENT_WINDOW_MS = DEFAULT_TIMEOUT_MS + 1000;
const RECOVERY_POLL_INTERVAL_MS = 250;
const SHUTDOWN_TIMEOUT_MS = 1500;
const TERMINATE_TIMEOUT_MS = 1000;
const REQUIRED_TOOLS = [
  'domain.list',
  'todo.list',
  'todo.create',
  'todo.get',
  'todo.update',
  'todo.complete',
  'todo.status',
  'todo.uncomplete',
  'todo.delete'
];

const HELP = `Bitterless Todo MCP smoke test

Usage:
  yarn mcp:todo:smoke [options]

Options:
  --profile <name>     Standard helper profile: production (default) or debug.
                       Cannot be combined with --helper.
  --helper <path>      bitterless-mcp helper command. Defaults to
                       BITTERLESS_MCP_HELPER or the standard production path.
  --helper-arg <arg>   Pass an argument to the helper. Repeatable.
  --domain <id|title>  Existing domain ID or exact title (default: Others).
  --timeout <ms>       Per-request timeout in milliseconds (default: 10000).
  --read-only          Verify MCP handshake, tools, bridge, and domain only.
  --keep               Keep the smoke todo instead of deleting it.
  -h, --help           Show this help.

Examples:
  yarn mcp:todo:smoke
  yarn mcp:todo:smoke --profile debug --read-only
  yarn mcp:todo:smoke --domain Bitterless --keep
  yarn mcp:todo:smoke --helper "$HOME/Library/Application Support/Bitterless_DEBUG/bin/bitterless-mcp"
  yarn mcp:todo:smoke --read-only
`;

class InputError extends Error {}

class SmokeError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
}

class McpResponseError extends Error {
  constructor(label, error) {
    const code = typeof error?.code === 'number' ? ` (${error.code})` : '';
    const message = typeof error?.message === 'string' ? error.message : 'Unknown MCP error';
    super(`${label} failed${code}: ${message}`);
    this.remoteMessage = message;
  }
}

const isRecord = (value) => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

const getProfileHelper = (profile) => {
  const appName = profile === 'debug' ? 'Bitterless_DEBUG' : 'Bitterless';
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', appName, 'bin', 'bitterless-mcp');
  }
  if (process.platform === 'win32' && process.env.APPDATA) {
    return join(process.env.APPDATA, appName, 'bin', 'bitterless-mcp.cmd');
  }
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), appName, 'bin', 'bitterless-mcp');
};

const readValue = (argv, index, option) => {
  const value = argv[index + 1];
  if (value === undefined) throw new InputError(`${option} requires a value.`);
  return value;
};

const parseArgs = (argv) => {
  const options = {
    domain: 'Others',
    helper: '',
    helperArgs: [],
    keep: false,
    profile: 'production',
    readOnly: false,
    target: 'production',
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };
  let helperExplicit = false;
  let profileExplicit = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--keep') {
      options.keep = true;
      continue;
    }
    if (arg === '--read-only') {
      options.readOnly = true;
      continue;
    }
    if (arg === '--helper') {
      options.helper = readValue(argv, index, arg);
      helperExplicit = true;
      index += 1;
      continue;
    }
    if (arg === '--profile') {
      const profile = readValue(argv, index, arg);
      if (profile !== 'production' && profile !== 'debug') {
        throw new InputError('--profile must be production or debug.');
      }
      options.profile = profile;
      profileExplicit = true;
      index += 1;
      continue;
    }
    if (arg === '--helper-arg') {
      options.helperArgs.push(readValue(argv, index, arg));
      index += 1;
      continue;
    }
    if (arg === '--domain') {
      options.domain = readValue(argv, index, arg).trim();
      index += 1;
      continue;
    }
    if (arg === '--timeout') {
      const rawTimeout = readValue(argv, index, arg);
      const timeoutMs = Number(rawTimeout);
      if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120000) {
        throw new InputError('--timeout must be an integer from 100 to 120000 milliseconds.');
      }
      options.timeoutMs = timeoutMs;
      index += 1;
      continue;
    }
    throw new InputError(`Unknown option: ${arg}`);
  }

  if (helperExplicit && profileExplicit) {
    throw new InputError('--profile cannot be combined with --helper.');
  }
  if (helperExplicit) {
    options.target = 'custom (--helper)';
  } else if (profileExplicit) {
    options.helper = getProfileHelper(options.profile);
    options.target = options.profile;
  } else if (process.env.BITTERLESS_MCP_HELPER) {
    options.helper = process.env.BITTERLESS_MCP_HELPER;
    options.target = 'custom (BITTERLESS_MCP_HELPER)';
  } else {
    options.helper = getProfileHelper('production');
  }
  if (!options.helper.trim()) throw new InputError('--helper cannot be empty.');
  if (!options.domain) throw new InputError('--domain cannot be empty.');
  return options;
};

const commandUsesPath = (command) => {
  return command.includes('/') || command.includes('\\');
};

const quoteWindowsCommandArg = (value) => {
  return `"${value.replace(/"/g, '\\"')}"`;
};

const spawnHelper = (helper, helperArgs) => {
  if (process.platform === 'win32' && helper.toLowerCase().endsWith('.cmd')) {
    const command = [helper, ...helperArgs].map(quoteWindowsCommandArg).join(' ');
    return spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', command], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    });
  }
  return spawn(helper, helperArgs, {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true
  });
};

class McpClient {
  constructor(helper, helperArgs, timeoutMs) {
    this.helper = helper;
    this.helperArgs = helperArgs;
    this.timeoutMs = timeoutMs;
    this.child = null;
    this.nextId = 1;
    this.pending = new Map();
    this.stdoutBuffer = '';
    this.stderrBuffer = '';
    this.exitStatus = null;
    this.exitPromise = Promise.resolve({ code: null, signal: null });
    this.started = false;
  }

  async start() {
    if (commandUsesPath(this.helper) && !existsSync(this.helper)) {
      throw new SmokeError('helper', `Helper not found: ${this.helper}`);
    }

    const child = spawnHelper(this.helper, this.helperArgs);
    this.child = child;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => this.handleStdout(chunk));
    child.stderr.on('data', (chunk) => {
      this.stderrBuffer = `${this.stderrBuffer}${chunk}`.slice(-16000);
    });
    this.exitPromise = new Promise((resolve) => {
      child.once('exit', (code, signal) => {
        this.exitStatus = { code, signal };
        this.rejectPending(
          new SmokeError(
            'helper',
            `Helper exited before completing a request (code=${code ?? 'null'}, signal=${signal ?? 'none'}).`
          )
        );
        resolve({ code, signal });
      });
    });

    await new Promise((resolve, reject) => {
      const onSpawn = () => {
        this.started = true;
        child.off('error', onError);
        resolve();
      };
      const onError = (error) => {
        child.off('spawn', onSpawn);
        reject(
          new SmokeError('helper', `Could not start helper "${this.helper}": ${error.message}`)
        );
      };
      child.once('spawn', onSpawn);
      child.once('error', onError);
    });
  }

  handleStdout(chunk) {
    this.stdoutBuffer += chunk;
    let newlineIndex = this.stdoutBuffer.indexOf('\n');
    while (newlineIndex >= 0) {
      const line = this.stdoutBuffer.slice(0, newlineIndex).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
      if (line) this.handleLine(line);
      newlineIndex = this.stdoutBuffer.indexOf('\n');
    }
  }

  handleLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch (error) {
      this.failProtocol(`Helper wrote invalid JSON to stdout: ${error.message}`);
      return;
    }

    if (!isRecord(message) || message.jsonrpc !== '2.0') {
      this.failProtocol('Helper returned a response without jsonrpc="2.0".');
      return;
    }
    if (typeof message.method === 'string' && message.id === undefined) return;

    const pending = this.pending.get(message.id);
    if (!pending) {
      this.failProtocol(`Helper returned an unexpected response id: ${String(message.id)}.`);
      return;
    }

    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error !== undefined) {
      pending.reject(new McpResponseError(pending.label, message.error));
      return;
    }
    if (!Object.hasOwn(message, 'result')) {
      pending.reject(
        new SmokeError('protocol', `${pending.label} response has neither result nor error.`)
      );
      return;
    }
    pending.resolve(message.result);
  }

  failProtocol(message) {
    const error = new SmokeError('protocol', message);
    this.rejectPending(error);
    this.child?.kill();
  }

  rejectPending(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  request(method, params, label = method) {
    if (!this.child || !this.child.stdin.writable) {
      return Promise.reject(new SmokeError('helper', 'Helper stdin is not writable.'));
    }

    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new SmokeError('timeout', `Timed out after ${this.timeoutMs}ms waiting for ${label}.`)
        );
      }, this.timeoutMs);
      this.pending.set(id, { label, reject, resolve, timer });
      const line = `${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`;
      this.child.stdin.write(line, (error) => {
        if (!error || !this.pending.has(id)) return;
        clearTimeout(timer);
        this.pending.delete(id);
        reject(
          new SmokeError('helper', `Could not write ${label} to helper stdin: ${error.message}`)
        );
      });
    });
  }

  notify(method, params = {}) {
    if (!this.child || !this.child.stdin.writable) {
      throw new SmokeError('helper', 'Helper stdin is not writable.');
    }
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  }

  async initialize() {
    const result = await this.request('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: {
        name: 'bitterless-todo-smoke',
        version: '0.1.0'
      }
    });
    if (!isRecord(result) || !isRecord(result.serverInfo)) {
      throw new SmokeError('protocol', 'initialize response is missing serverInfo.');
    }
    this.notify('notifications/initialized');
    return result;
  }

  async listTools() {
    const result = await this.request('tools/list', {});
    if (!isRecord(result) || !Array.isArray(result.tools)) {
      throw new SmokeError('protocol', 'tools/list response is missing the tools array.');
    }
    return result.tools;
  }

  async callTool(name, args) {
    const result = await this.request('tools/call', { name, arguments: args }, `MCP tool ${name}`);
    if (!isRecord(result) || !Object.hasOwn(result, 'structuredContent')) {
      throw new SmokeError('protocol', `MCP tool ${name} response is missing structuredContent.`);
    }
    return result.structuredContent;
  }

  async close() {
    const child = this.child;
    if (!child || !this.started) return null;
    if (this.exitStatus) return { ...this.exitStatus, forced: false };
    if (child.stdin.writable) child.stdin.end();

    let status = await this.waitForExit(SHUTDOWN_TIMEOUT_MS);
    if (status) return { ...status, forced: false };

    child.kill();
    status = await this.waitForExit(TERMINATE_TIMEOUT_MS);
    if (!status) {
      child.kill('SIGKILL');
      status = await this.exitPromise;
    }
    return { ...status, forced: true };
  }

  async waitForExit(timeoutMs) {
    return Promise.race([
      this.exitPromise,
      new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs))
    ]);
  }
}

const assert = (condition, message) => {
  if (!condition) throw new SmokeError('assertion', message);
};

const requireRecord = (value, label) => {
  assert(isRecord(value), `${label} must be an object.`);
  return value;
};

const requireTodoResult = (value, label) => {
  const result = requireRecord(value, label);
  const todo = requireRecord(result.todo, `${label}.todo`);
  assert(Number.isInteger(todo.id) && todo.id > 0, `${label}.todo.id must be a positive integer.`);
  return todo;
};

const resolveDomain = (value, selector) => {
  const result = requireRecord(value, 'domain.list structuredContent');
  assert(Array.isArray(result.domains), 'domain.list structuredContent.domains must be an array.');
  const domains = result.domains.filter(isRecord);
  assert(
    domains.length > 0,
    'domain.list returned no active domains. Create one in the Bitterless UI first.'
  );

  let matches;
  if (/^[1-9]\d*$/.test(selector)) {
    const id = Number(selector);
    matches = domains.filter((domain) => domain.id === id);
  } else {
    const normalizedSelector = selector.trim().toLocaleLowerCase();
    matches = domains.filter((domain) => {
      return (
        typeof domain.title === 'string' &&
        domain.title.trim().toLocaleLowerCase() === normalizedSelector
      );
    });
  }

  const available = domains
    .map((domain) => `${String(domain.id)}:${String(domain.title)}`)
    .join(', ');
  assert(
    matches.length > 0,
    `No active domain matches "${selector}". Available domains: ${available}`
  );
  assert(
    matches.length === 1,
    `Domain selector "${selector}" is ambiguous. Matches: ${matches.map((domain) => domain.id).join(', ')}`
  );
  const domain = matches[0];
  assert(Number.isInteger(domain.id) && domain.id > 0, 'Selected domain has an invalid id.');
  return domain;
};

const getStatusState = (value, todoId, label) => {
  const result = requireRecord(value, label);
  assert(Array.isArray(result.items), `${label}.items must be an array.`);
  const matches = result.items.filter((item) => isRecord(item) && item.id === todoId);
  assert(matches.length === 1, `${label} must return exactly one item for todo ${todoId}.`);
  assert(typeof matches[0].state === 'string', `${label} item is missing state.`);
  return matches[0].state;
};

const isOwnedTodo = (value, domainId, state) => {
  if (!isRecord(value)) return false;
  const validTitle = value.title === state.originalTitle || value.title === state.updatedTitle;
  return (
    Number.isInteger(value.id) &&
    value.id > 0 &&
    value.domain_id === domainId &&
    value.source === 'ai' &&
    (value.important === 0 || value.important === false) &&
    validTitle &&
    value.title.includes(state.marker) &&
    typeof value.note === 'string' &&
    value.note.includes(state.marker)
  );
};

const assertOwnedTodo = (value, domainId, state, label) => {
  const todo = requireRecord(value, label);
  assert(
    isOwnedTodo(todo, domainId, state),
    `${label} does not match this smoke run's ownership marker, domain, source, importance, title, and note.`
  );
  return todo;
};

const deleteOwnedAndVerify = async (client, todoId, domainId, state) => {
  const current = await client.callTool('todo.get', { id: todoId });
  assertOwnedTodo(current, domainId, state, `todo.get before deleting ${todoId}`);
  const deleted = requireRecord(
    await client.callTool('todo.delete', { id: todoId }),
    'todo.delete'
  );
  assert(
    deleted.deleted === true && deleted.id === todoId,
    'todo.delete did not confirm the expected todo id.'
  );
  const status = await client.callTool('todo.status', { ids: [todoId] });
  assert(
    getStatusState(status, todoId, 'todo.status after delete') === 'deleted',
    'Deleted todo is not reported as deleted.'
  );
};

const createSmokeState = () => {
  const token = randomUUID();
  const marker = `bitterless-mcp-smoke:${token}`;
  const originalTitle = `[MCP smoke ${marker}]`;
  return {
    createAttempted: false,
    deleted: false,
    marker,
    originalTitle,
    responseCandidateId: null,
    token,
    updatedTitle: `${originalTitle} updated`,
    validatedOwnedId: null
  };
};

const runLifecycle = async (client, domain, keep, state) => {
  state.createAttempted = true;
  const created = requireTodoResult(
    await client.callTool('todo.create', {
      domainId: domain.id,
      title: state.originalTitle,
      important: false,
      note: `${state.marker} Created by the Bitterless Todo MCP smoke test.`
    }),
    'todo.create'
  );
  state.responseCandidateId = created.id;
  const fetched = await client.callTool('todo.get', { id: state.responseCandidateId });
  const owned = assertOwnedTodo(
    fetched,
    domain.id,
    state,
    `todo.get for create response candidate ${state.responseCandidateId}`
  );
  state.validatedOwnedId = owned.id;
  console.log(`[todo-smoke] create/get ownership ok (todo ${state.validatedOwnedId})`);

  const updated = requireTodoResult(
    await client.callTool('todo.update', {
      id: state.validatedOwnedId,
      title: state.updatedTitle,
      important: false,
      note: `${state.marker} Updated by the Bitterless Todo MCP smoke test.`
    }),
    'todo.update'
  );
  assert(updated.title === state.updatedTitle, 'todo.update did not persist the updated title.');
  console.log('[todo-smoke] update ok');

  const completed = requireTodoResult(
    await client.callTool('todo.complete', { id: state.validatedOwnedId }),
    'todo.complete'
  );
  assert(
    completed.status === 1 || completed.status === 'completed',
    'todo.complete did not return a completed todo.'
  );
  const completedStatus = await client.callTool('todo.status', { ids: [state.validatedOwnedId] });
  assert(
    getStatusState(completedStatus, state.validatedOwnedId, 'todo.status after complete') ===
      'completed',
    'todo.status did not report completed.'
  );
  console.log('[todo-smoke] complete/status ok');

  const active = requireTodoResult(
    await client.callTool('todo.uncomplete', { id: state.validatedOwnedId }),
    'todo.uncomplete'
  );
  assert(
    active.status === 0 || active.status === 'active',
    'todo.uncomplete did not return an active todo.'
  );
  const activeStatus = await client.callTool('todo.status', { ids: [state.validatedOwnedId] });
  assert(
    getStatusState(activeStatus, state.validatedOwnedId, 'todo.status after uncomplete') ===
      'active',
    'todo.status did not report active.'
  );
  console.log('[todo-smoke] uncomplete/status ok');

  if (keep) {
    console.log(`[todo-smoke] kept todo ${state.validatedOwnedId}: ${state.updatedTitle}`);
    return;
  }

  await deleteOwnedAndVerify(client, state.validatedOwnedId, domain.id, state);
  state.deleted = true;
  console.log('[todo-smoke] delete/status ok');
};

const assertCleanExit = (status) => {
  if (!status) return;
  if (status.forced) {
    throw new SmokeError(
      'helper',
      `Helper did not terminate after stdin closed and was killed (code=${status.code ?? 'null'}, signal=${status.signal ?? 'none'}).`
    );
  }
  if (status.code !== 0 || status.signal !== null) {
    throw new SmokeError(
      'helper',
      `Helper exited uncleanly (code=${status.code ?? 'null'}, signal=${status.signal ?? 'none'}).`
    );
  }
};

const appendFailure = (failure, error, prefix) => {
  if (!failure) return error;
  const first = failure instanceof Error ? failure.message : String(failure);
  const second = error instanceof Error ? error.message : String(error);
  return new SmokeError(failure.kind ?? 'assertion', `${first} ${prefix}: ${second}`);
};

const listOwnedCandidates = async (client, domainId, state) => {
  const result = requireRecord(
    await client.callTool('todo.list', { domainId }),
    'todo.list during cleanup'
  );
  assert(Array.isArray(result.todos), 'todo.list during cleanup must return todos.');
  const candidates = new Map();
  for (const todo of result.todos) {
    if (isOwnedTodo(todo, domainId, state)) candidates.set(todo.id, todo);
  }
  return candidates;
};

const delay = (ms) => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

const getSettlementWindowMs = (options) => {
  const testOverride = process.env.BITTERLESS_MCP_SMOKE_TEST_SETTLEMENT_MS;
  if (process.env.NODE_ENV === 'test' && testOverride) {
    const parsed = Number(testOverride);
    if (Number.isInteger(parsed) && parsed >= 50) return parsed;
  }
  return Math.max(DEFAULT_SETTLEMENT_WINDOW_MS, options.timeoutMs + 1000);
};

const collectOwnedCandidates = async (client, domainId, state) => {
  const candidates = await listOwnedCandidates(client, domainId, state);
  if (state.validatedOwnedId !== null) {
    const statusResult = await client.callTool('todo.status', { ids: [state.validatedOwnedId] });
    const lookupState = getStatusState(
      statusResult,
      state.validatedOwnedId,
      'todo.status during cleanup'
    );
    if (lookupState === 'active' || lookupState === 'completed') {
      const current = await client.callTool('todo.get', { id: state.validatedOwnedId });
      const owned = assertOwnedTodo(
        current,
        domainId,
        state,
        `todo.get for validated owned id ${state.validatedOwnedId}`
      );
      candidates.set(owned.id, owned);
    } else if (lookupState === 'deleted' || lookupState === 'missing') {
      state.validatedOwnedId = null;
    } else {
      throw new SmokeError('assertion', `Unexpected cleanup status: ${lookupState}`);
    }
  }
  assert(
    candidates.size <= 1,
    `Ownership recovery is ambiguous: found ${candidates.size} fully owned candidates; refusing to delete any.`
  );
  return [...candidates.values()];
};

const settleAndCleanupOwnedTodo = async (client, options, domainId, state) => {
  const settlementWindowMs = getSettlementWindowMs(options);
  const deadline = Date.now() + settlementWindowMs;
  const pollIntervalMs = Math.min(
    RECOVERY_POLL_INTERVAL_MS,
    Math.max(25, Math.floor(settlementWindowMs / 4))
  );
  const observedOwnedIds = new Set();

  while (Date.now() < deadline) {
    const candidates = await collectOwnedCandidates(client, domainId, state);
    for (const candidate of candidates) observedOwnedIds.add(candidate.id);
    assert(
      observedOwnedIds.size <= 1,
      `Ownership recovery observed ${observedOwnedIds.size} different fully owned candidates; refusing to delete any.`
    );
    const remainingMs = deadline - Date.now();
    if (remainingMs > 0) await delay(Math.min(pollIntervalMs, remainingMs));
  }

  const finalCandidates = await collectOwnedCandidates(client, domainId, state);
  for (const candidate of finalCandidates) observedOwnedIds.add(candidate.id);
  assert(
    observedOwnedIds.size <= 1,
    `Ownership recovery observed ${observedOwnedIds.size} different fully owned candidates; refusing to delete any.`
  );

  let deletedCount = 0;
  if (finalCandidates.length === 1) {
    const candidate = finalCandidates[0];
    await deleteOwnedAndVerify(client, candidate.id, domainId, state);
    if (state.validatedOwnedId === candidate.id) state.validatedOwnedId = null;
    deletedCount = 1;
  }
  const confirmedZero = await collectOwnedCandidates(client, domainId, state);
  assert(
    confirmedZero.length === 0,
    `Settlement ended with ${confirmedZero.length} fully owned candidate still present.`
  );
  return deletedCount;
};

const cleanupInFreshSession = async (options, domain, state) => {
  const client = new McpClient(options.helper, options.helperArgs, options.timeoutMs);
  let failure = null;
  let deletedCount = 0;
  try {
    await client.start();
    await client.initialize();
    deletedCount = await settleAndCleanupOwnedTodo(client, options, domain.id, state);
  } catch (error) {
    failure = error;
  }

  try {
    assertCleanExit(await client.close());
  } catch (error) {
    failure = appendFailure(failure, error, 'Fresh cleanup helper shutdown also failed');
  }

  if (failure) throw failure;
  state.deleted = true;
  console.error(
    `[todo-smoke] fresh-session settlement verified ${deletedCount} owned todo${deletedCount === 1 ? '' : 's'} deleted and zero remain.`
  );
};

const explainError = (error, helper, stderr) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[todo-smoke] FAIL: ${message}`);

  if (
    error instanceof McpResponseError &&
    /bridge|not running|ECONNREFUSED|ENOENT/i.test(error.remoteMessage)
  ) {
    console.error(
      '[todo-smoke] Recovery: start Bitterless, keep the GUI running, and retry. The helper cannot access Todo without the local GUI bridge.'
    );
  } else if (error?.kind === 'helper') {
    console.error(
      `[todo-smoke] Recovery: open Bitterless Todo's agent integration dialog to generate the helper, or pass --helper <path>. Current helper: ${helper}`
    );
  } else if (error?.kind === 'timeout') {
    console.error(
      '[todo-smoke] Recovery: confirm the helper is responsive and Bitterless is running; increase --timeout only for a slow local startup.'
    );
  } else if (error?.kind === 'protocol') {
    console.error(
      '[todo-smoke] Recovery: rebuild/update Bitterless so the helper and this CLI use the same MCP protocol. Helper logs must go to stderr, never stdout.'
    );
  } else if (error?.kind === 'assertion') {
    console.error(
      '[todo-smoke] Recovery: inspect the returned Todo data; the public MCP behavior differs from the expected lifecycle.'
    );
  }

  const trimmedStderr = stderr.trim();
  if (trimmedStderr) console.error(`[todo-smoke] helper stderr:\n${trimmedStderr}`);
};

const main = async () => {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`[todo-smoke] Input error: ${error.message}`);
    console.error('[todo-smoke] Run with --help for usage.');
    return 2;
  }

  if (options.help) {
    process.stdout.write(HELP);
    return 0;
  }

  console.log(`[todo-smoke] target: ${options.target}`);
  console.log(`[todo-smoke] helper: ${options.helper}`);
  const client = new McpClient(options.helper, options.helperArgs, options.timeoutMs);
  const state = options.readOnly ? null : createSmokeState();
  let domain = null;
  let failure = null;
  let successMessage = null;
  try {
    await client.start();
    const initialized = await client.initialize();
    const serverName =
      typeof initialized.serverInfo.name === 'string' ? initialized.serverInfo.name : 'unknown';
    console.log(`[todo-smoke] connected to ${serverName}`);

    const tools = await client.listTools();
    const toolNames = new Set(
      tools.map((tool) => tool?.name).filter((name) => typeof name === 'string')
    );
    const missingTools = REQUIRED_TOOLS.filter((name) => !toolNames.has(name));
    assert(
      missingTools.length === 0,
      `MCP server is missing required tools: ${missingTools.join(', ')}`
    );
    console.log('[todo-smoke] required tools ok');

    const domainResult = await client.callTool('domain.list', {});
    domain = resolveDomain(domainResult, options.domain);
    console.log(`[todo-smoke] domain ok (${domain.id}:${domain.title})`);

    if (options.readOnly) {
      successMessage = '[todo-smoke] PASS (read-only)';
    } else {
      await runLifecycle(client, domain, options.keep, state);
      successMessage = options.keep
        ? '[todo-smoke] PASS (todo kept)'
        : '[todo-smoke] PASS (todo cleaned up)';
    }
  } catch (error) {
    failure = error;
  }

  try {
    assertCleanExit(await client.close());
  } catch (error) {
    failure = appendFailure(failure, error, 'Primary helper shutdown also failed');
  }

  if (failure && state?.createAttempted && !state.deleted && !options.keep && domain) {
    try {
      await cleanupInFreshSession(options, domain, state);
    } catch (error) {
      failure = appendFailure(failure, error, 'Fresh-session cleanup also failed');
    }
  }

  if (failure) {
    explainError(failure, options.helper, client.stderrBuffer);
    return 1;
  }

  console.log(successMessage);
  return 0;
};

process.exitCode = await main();
