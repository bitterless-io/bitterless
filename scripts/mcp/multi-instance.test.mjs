#!/usr/bin/env node

/* eslint-disable @typescript-eslint/explicit-function-return-type */

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { installMcpSourceHooks } from './fixtures/mcp-source-hooks.mjs';
import { OptionalStartupLifecycle } from '../../src/main/mcp/optionalStartupLifecycle.service.ts';
import {
  createMcpConfigJson,
  createPosixMcpShim,
  createWindowsMcpShim,
  getMcpBridgeEndpoint,
  getMcpServerName,
  parseMcpBridgeEndpointArg
} from '../../src/shared/mcp/mcpBridge.shared.ts';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(scriptDirectory, '..', '..');
const helperFixture = join(scriptDirectory, 'fixtures', 'mcp-production-stdio.fixture.mjs');
const captureFixture = join(scriptDirectory, 'fixtures', 'capture-argv.fixture.mjs');
const staleSocketFixture = join(scriptDirectory, 'fixtures', 'stale-unix-socket.fixture.mjs');
const tempDirectory = mkdtempSync(join(tmpdir(), 'blmi-'));
const wrongUserData = join(tempDirectory, 'wrong-user-data');
const broadcasts = [];
let domainResult = [];
let lastTodoUpdateParams = null;
const now = Date.now();
const DOMAIN_ID = '00000000000000000007';
const TODO_ID = '00000000000000000042';
const OTHER_TODO_ID = '00000000000000000099';
const MISSING_DOMAIN_ID = '00000000000000000999';
const validDomain = {
  id: DOMAIN_ID,
  customer_id: '1',
  title: 'Others',
  description: '',
  is_deleted: 0,
  archived: 0,
  position: 0,
  created_at: now,
  updated_at: now
};
const validTodo = {
  id: TODO_ID,
  customer_id: '1',
  domain_id: DOMAIN_ID,
  title: 'Fixture todo',
  status: 0,
  important: 0,
  due_at: null,
  repeat_type: null,
  repeat_interval: 1,
  remind_at: null,
  last_remind_at: null,
  last_complete_at: null,
  week_day: null,
  monthly_day: null,
  yearly_day: null,
  note: '',
  source: 'ai',
  is_deleted: 0,
  position: 0,
  created_at: now,
  updated_at: now
};
const validStatus = {
  items: [{
    id: TODO_ID,
    state: 'active',
    exists: true,
    completed: false,
    deleted: false,
    title: validTodo.title,
    domain_id: DOMAIN_ID,
    updated_at: now,
    completed_at: null,
    deleted_at: null,
    deleted_event_id: null
  }],
  summary: { active: 1, completed: 0, deleted: 0, missing: 0 }
};
const validEvents = { events: [], latestEventId: 0, hasMore: false };
const daoResults = {
  domainCreate: validDomain,
  todoCreate: validTodo,
  todoGet: validTodo,
  todoList: [validTodo],
  todoStatus: validStatus,
  todoUpdate: validTodo,
  todoComplete: { ...validTodo, status: 1, last_complete_at: now },
  todoUncomplete: validTodo,
  todoDelete: true,
  todoMove: validTodo,
  eventList: validEvents
};

installMcpSourceHooks({
  projectRoot,
  userDataPath: wrongUserData,
  broadcasts,
  normalizeUndefinedXpcResultsToNull: true,
  todoRepository: {
    completeTodo: async () => daoResults.todoComplete,
    createDomain: async () => daoResults.domainCreate,
    createTodo: async () => daoResults.todoCreate,
    deleteTodo: async () => daoResults.todoDelete,
    getDomains: async () => domainResult,
    getTodoById: async () => daoResults.todoGet,
    getTodosByDomain: async () => daoResults.todoList,
    getStatusByIds: async () => daoResults.todoStatus,
    listAfter: async () => daoResults.eventList,
    moveToDomain: async () => daoResults.todoMove,
    uncompleteTodo: async () => daoResults.todoUncomplete,
    updateTodo: async (params) => {
      lastTodoUpdateParams = params;
      return daoResults.todoUpdate;
    }
  }
});

const { McpBridgeServer } = await import('../../src/main/mcp/mcpBridge.server.ts');

class StdioClient {
  constructor(bridgePath) {
    this.child = spawn(process.execPath, [helperFixture, wrongUserData, bridgePath], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    this.child.stdout.setEncoding('utf8');
    this.child.stderr.setEncoding('utf8');
    this.buffer = '';
    this.nextId = 1;
    this.pending = new Map();
    this.stderr = '';
    this.child.stdout.on('data', (chunk) => this.handleData(chunk));
    this.child.stderr.on('data', (chunk) => {
      this.stderr += chunk;
    });
  }

  handleData(chunk) {
    this.buffer += chunk;
    let newlineIndex = this.buffer.indexOf('\n');
    while (newlineIndex >= 0) {
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (line) {
        const response = JSON.parse(line);
        const pending = this.pending.get(response.id);
        assert.ok(pending, `Unexpected helper response id: ${String(response.id)}`);
        this.pending.delete(response.id);
        clearTimeout(pending.timer);
        if (response.error) pending.reject(new Error(response.error.message));
        else pending.resolve(response.result);
      }
      newlineIndex = this.buffer.indexOf('\n');
    }
  }

  request(method, params) {
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for ${method}`));
      }, 5000);
      this.pending.set(id, { reject, resolve, timer });
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }

  async callTool(name, args = {}) {
    const result = await this.request('tools/call', { name, arguments: args });
    return result.structuredContent;
  }

  async close() {
    this.child.stdin.end();
    const status = await Promise.race([
      new Promise((resolve) => {
        this.child.once('exit', (code, signal) => resolve({ code, signal }));
      }),
      new Promise((resolve) => setTimeout(() => resolve(null), 3000))
    ]);
    if (!status) this.child.kill('SIGKILL');
    assert.deepEqual(status, { code: 0, signal: null }, this.stderr);
  }
}

const createMarkerBridge = async (socketPath, marker) => {
  mkdirSync(dirname(socketPath), { recursive: true });
  const server = net.createServer((socket) => {
    socket.setEncoding('utf8');
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk;
      const newlineIndex = buffer.indexOf('\n');
      if (newlineIndex < 0) return;
      const request = JSON.parse(buffer.slice(0, newlineIndex));
      socket.end(`${JSON.stringify({
        jsonrpc: '2.0',
        id: request.id,
        result: { marker }
      })}\n`);
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, resolve);
  });
  return server;
};

const closeServer = async (server) => {
  await new Promise((resolve) => server.close(resolve));
};

const createRealStaleSocket = async (socketPath) => {
  const child = spawn(process.execPath, [staleSocketFixture, socketPath], {
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Stale socket fixture timed out: ${stderr}`)), 3000);
    child.once('error', reject);
    child.stdout.once('data', (chunk) => {
      if (!String(chunk).includes('ready')) return;
      clearTimeout(timer);
      resolve();
    });
  });
  child.kill('SIGKILL');
  await new Promise((resolve) => child.once('exit', resolve));
  assert.equal(lstatSync(socketPath).isSocket(), true);
};

const endpoint = (name) => ({
  transport: 'unix',
  path: join(tempDirectory, `${name}.sock`)
});

const createDeferred = () => {
  let resolve;
  const promise = new Promise((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
};

try {
  const heldMcpStart = createDeferred();
  const mcpStartEntered = createDeferred();
  const lifecycleEvents = [];
  let overlapCleanupCompleted = false;
  const overlapLifecycle = new OptionalStartupLifecycle();
  const overlapStartup = overlapLifecycle.start(async (canStartNextStage) => {
    if (!canStartNextStage()) return;
    lifecycleEvents.push('mcp:start');
    mcpStartEntered.resolve();
    await heldMcpStart.promise;
    lifecycleEvents.push('mcp:started');
    if (!canStartNextStage()) return;
    lifecycleEvents.push('shim:start');
    if (!canStartNextStage()) return;
    lifecycleEvents.push('eyes:import');
    if (!canStartNextStage()) return;
    lifecycleEvents.push('eyes:start');
  });
  await mcpStartEntered.promise;
  const overlapCleanup = (async () => {
    await overlapLifecycle.fenceAndJoin();
    lifecycleEvents.push('mcp:stop');
    overlapCleanupCompleted = true;
    lifecycleEvents.push('cleanup:complete');
  })();
  await Promise.resolve();
  assert.equal(overlapCleanupCompleted, false);
  assert.deepEqual(lifecycleEvents, ['mcp:start']);
  heldMcpStart.resolve();
  await Promise.all([overlapStartup, overlapCleanup]);
  assert.deepEqual(lifecycleEvents, [
    'mcp:start',
    'mcp:started',
    'mcp:stop',
    'cleanup:complete'
  ]);

  const preFencedLifecycle = new OptionalStartupLifecycle();
  await preFencedLifecycle.fenceAndJoin();
  let postCleanupStartupCalled = false;
  await preFencedLifecycle.start(async () => {
    postCleanupStartupCalled = true;
  });
  assert.equal(postCleanupStartupCalled, false);

  assert.equal(getMcpServerName('Bitterless'), 'bitterless');
  assert.equal(getMcpServerName('Bitterless_DEBUG_PROD'), 'bitterless-debug-prod');
  assert.equal(getMcpServerName('Bitterless_DEV'), 'bitterless-dev');
  assert.equal(getMcpServerName('Bitterless_DEBUG_DEV'), 'bitterless-debug-dev');
  assert.throws(() => getMcpServerName('  '), /app name is required/);

  assert.deepEqual(JSON.parse(createMcpConfigJson('/tmp/prod helper')), {
    mcpServers: { bitterless: { command: '/tmp/prod helper' } }
  });
  assert.deepEqual(JSON.parse(createMcpConfigJson('/tmp/debug helper', 'bitterless-debug-prod')), {
    mcpServers: { 'bitterless-debug-prod': { command: '/tmp/debug helper' } }
  });
  assert.throws(() => createMcpConfigJson('/tmp/helper', '__proto__'), /Invalid MCP server name/);

  const unixPath = join(tempDirectory, "quoted bridge's route.sock");
  assert.deepEqual(
    parseMcpBridgeEndpointArg(['electron', 'mcpHelper.js', '--mcp-bridge-path', unixPath], 'darwin'),
    { transport: 'unix', path: unixPath }
  );
  assert.deepEqual(
    parseMcpBridgeEndpointArg(
      ['Bitterless.exe', 'mcpHelper.js', '--mcp-bridge-path', '\\\\.\\pipe\\bitterless-mcp-test'],
      'win32'
    ),
    { transport: 'win32-named-pipe', path: '\\\\.\\pipe\\bitterless-mcp-test' }
  );
  assert.equal(parseMcpBridgeEndpointArg(['electron', 'mcpHelper.js']), undefined);
  assert.throws(
    () => parseMcpBridgeEndpointArg(['--mcp-bridge-path=/tmp/bridge.sock']),
    /separate path argument/
  );
  assert.throws(
    () => parseMcpBridgeEndpointArg(['--mcp-bridge-path', 'relative.sock']),
    /absolute Unix socket path/
  );
  assert.throws(
    () => parseMcpBridgeEndpointArg([
      '--mcp-bridge-path',
      '/tmp/a.sock',
      '--mcp-bridge-path',
      '/tmp/b.sock'
    ]),
    /only once/
  );

  const capturePath = join(tempDirectory, 'captured-argv.json');
  const shimPath = join(tempDirectory, 'quoted helper.sh');
  writeFileSync(
    shimPath,
    createPosixMcpShim(process.execPath, captureFixture, unixPath),
    'utf8'
  );
  chmodSync(shimPath, 0o755);
  const captureRun = spawnSync(shimPath, ['extra value', "agent's arg"], {
    encoding: 'utf8',
    env: { ...process.env, BITTERLESS_MCP_CAPTURE_ARGV: capturePath }
  });
  assert.equal(captureRun.status, 0, captureRun.stderr);
  assert.deepEqual(JSON.parse(readFileSync(capturePath, 'utf8')), [
    '--mcp-bridge-path',
    unixPath,
    'extra value',
    "agent's arg"
  ]);

  const windowsShim = createWindowsMcpShim(
    'C:\\Program Files\\Bitterless 100%\\Bitterless.exe',
    'C:\\Program Files\\Bitterless 100%\\resources\\app.asar\\out\\main\\mcpHelper.js',
    '\\\\.\\pipe\\bitterless-mcp-test'
  );
  assert.match(windowsShim, /setlocal DisableDelayedExpansion/);
  assert.match(windowsShim, /set "ELECTRON_RUN_AS_NODE=1"/);
  assert.match(windowsShim, /Bitterless 100%%/);
  assert.match(windowsShim, /mcpHelper\.js" --mcp-bridge-path "\\\\\.\\pipe\\bitterless-mcp-test" %\*/);
  assert.doesNotMatch(windowsShim, /--mcp-helper|app\.main/);

  const generatedEndpoint = getMcpBridgeEndpoint(join(tempDirectory, 'profile'));
  assert.equal(generatedEndpoint.transport, 'unix');
  assert.match(generatedEndpoint.path, /profile\/mcp\/bridge\.sock$/);

  const productionEndpoint = endpoint('production');
  const debugEndpoint = endpoint('debug');
  const productionBridge = await createMarkerBridge(productionEndpoint.path, 'production');
  const debugBridge = await createMarkerBridge(debugEndpoint.path, 'debug');
  const productionClient = new StdioClient(productionEndpoint.path);
  const debugClient = new StdioClient(debugEndpoint.path);
  try {
    const [productionResult, debugResult] = await Promise.all([
      productionClient.callTool('domain.list'),
      debugClient.callTool('domain.list')
    ]);
    assert.deepEqual(productionResult, { marker: 'production' });
    assert.deepEqual(debugResult, { marker: 'debug' });
    assert.notEqual(getMcpBridgeEndpoint(wrongUserData).path, productionEndpoint.path);
    assert.notEqual(getMcpBridgeEndpoint(wrongUserData).path, debugEndpoint.path);
  } finally {
    await Promise.all([productionClient.close(), debugClient.close()]);
    await Promise.all([closeServer(productionBridge), closeServer(debugBridge)]);
  }

  const ownedEndpoint = endpoint('owned');
  const owner = new McpBridgeServer();
  const contender = new McpBridgeServer();
  await owner.start(ownedEndpoint);
  await assert.rejects(contender.start(ownedEndpoint), /already owned by a running process/);
  assert.ok(existsSync(ownedEndpoint.path));
  await owner.stop();

  const missingOwnerEndpoint = endpoint('missing-owner-lock');
  const missingOwnerLockPath = `${missingOwnerEndpoint.path}.start-lock`;
  mkdirSync(missingOwnerLockPath, { recursive: true });
  const missingOwnerServer = new McpBridgeServer();
  await missingOwnerServer.start(missingOwnerEndpoint);
  assert.equal(existsSync(missingOwnerLockPath), false);
  await missingOwnerServer.stop();

  const malformedOwnerEndpoint = endpoint('malformed-owner-lock');
  const malformedOwnerLockPath = `${malformedOwnerEndpoint.path}.start-lock`;
  mkdirSync(malformedOwnerLockPath, { recursive: true });
  writeFileSync(join(malformedOwnerLockPath, 'owner.json'), '{partial', 'utf8');
  const malformedContenders = [new McpBridgeServer(), new McpBridgeServer()];
  const malformedStarts = await Promise.allSettled(
    malformedContenders.map((server) => server.start(malformedOwnerEndpoint))
  );
  const malformedWinners = malformedStarts
    .map((result, index) => ({ result, index }))
    .filter(({ result }) => result.status === 'fulfilled');
  const malformedLosers = malformedStarts.filter((result) => result.status === 'rejected');
  assert.equal(malformedWinners.length, 1, JSON.stringify(malformedStarts));
  assert.equal(malformedLosers.length, 1, JSON.stringify(malformedStarts));
  assert.match(malformedLosers[0].reason.message, /already owned by a running process/);
  assert.equal(lstatSync(malformedOwnerEndpoint.path).isSocket(), true);
  assert.equal(existsSync(malformedOwnerLockPath), false);
  await malformedContenders[1 - malformedWinners[0].index].stop();
  assert.equal(lstatSync(malformedOwnerEndpoint.path).isSocket(), true);
  await malformedContenders[malformedWinners[0].index].stop();

  const staleEndpoint = endpoint('stale');
  await createRealStaleSocket(staleEndpoint.path);
  const staleContenders = [new McpBridgeServer(), new McpBridgeServer()];
  const staleStarts = await Promise.allSettled(
    staleContenders.map((server) => server.start(staleEndpoint))
  );
  const staleWinners = staleStarts
    .map((result, index) => ({ result, index }))
    .filter(({ result }) => result.status === 'fulfilled');
  const staleLosers = staleStarts.filter((result) => result.status === 'rejected');
  assert.equal(staleWinners.length, 1, JSON.stringify(staleStarts));
  assert.equal(staleLosers.length, 1, JSON.stringify(staleStarts));
  assert.match(staleLosers[0].reason.message, /already owned by a running process/);
  assert.equal(lstatSync(staleEndpoint.path).isSocket(), true);
  domainResult = [];
  daoResults.todoList = [];
  const staleClient = new StdioClient(staleEndpoint.path);
  try {
    const listed = await staleClient.callTool('domain.list');
    assert.deepEqual(listed.domains, []);
  } finally {
    await staleClient.close();
  }
  await staleContenders[1 - staleWinners[0].index].stop();
  assert.equal(lstatSync(staleEndpoint.path).isSocket(), true);
  await staleContenders[staleWinners[0].index].stop();

  const nonSocketEndpoint = endpoint('non-socket');
  const nonSocketContents = 'do-not-delete-this-file';
  writeFileSync(nonSocketEndpoint.path, nonSocketContents, 'utf8');
  const nonSocketServer = new McpBridgeServer();
  await assert.rejects(
    nonSocketServer.start(nonSocketEndpoint),
    /Refusing to replace non-socket path/
  );
  assert.equal(readFileSync(nonSocketEndpoint.path, 'utf8'), nonSocketContents);

  const replacedEndpoint = endpoint('replaced');
  const replacedOwner = new McpBridgeServer();
  await replacedOwner.start(replacedEndpoint);
  unlinkSync(replacedEndpoint.path);
  writeFileSync(replacedEndpoint.path, 'replacement-owner', 'utf8');
  await replacedOwner.stop();
  assert.equal(readFileSync(replacedEndpoint.path, 'utf8'), 'replacement-owner');

  const liveReplacementEndpoint = endpoint('live-replacement');
  const previousLiveOwner = new McpBridgeServer();
  await previousLiveOwner.start(liveReplacementEndpoint);
  const heldPreviousConnection = net.createConnection(liveReplacementEndpoint.path);
  await new Promise((resolve, reject) => {
    heldPreviousConnection.once('connect', resolve);
    heldPreviousConnection.once('error', reject);
  });
  unlinkSync(liveReplacementEndpoint.path);
  const liveReplacement = await createMarkerBridge(
    liveReplacementEndpoint.path,
    'live-replacement'
  );
  const previousStop = previousLiveOwner.stop();
  assert.equal(lstatSync(liveReplacementEndpoint.path).isSocket(), true);
  const liveReplacementClient = new StdioClient(liveReplacementEndpoint.path);
  try {
    const replacementResult = await liveReplacementClient.callTool('domain.list');
    assert.deepEqual(replacementResult, { marker: 'live-replacement' });
  } finally {
    await liveReplacementClient.close();
  }
  heldPreviousConnection.destroy();
  await previousStop;
  assert.equal(lstatSync(liveReplacementEndpoint.path).isSocket(), true);
  const restoredReplacementClient = new StdioClient(liveReplacementEndpoint.path);
  try {
    const restoredResult = await restoredReplacementClient.callTool('domain.list');
    assert.deepEqual(restoredResult, { marker: 'live-replacement' });
  } finally {
    await restoredReplacementClient.close();
    await closeServer(liveReplacement);
  }

  domainResult = null;
  const notReadyEndpoint = endpoint('not-ready');
  const notReadyServer = new McpBridgeServer();
  await notReadyServer.start(notReadyEndpoint);
  const notReadyClient = new StdioClient(notReadyEndpoint.path);
  try {
    await assert.rejects(
      notReadyClient.callTool('domain.list'),
      /TodoistSyncRepository\.getDomains is unavailable because the core SQLite store is not ready/
    );
    domainResult = [];
    const recovered = await notReadyClient.callTool('domain.list');
    assert.deepEqual(recovered.domains, []);
  } finally {
    await notReadyClient.close();
    await notReadyServer.stop();
  }

  domainResult = [validDomain];
  daoResults.todoList = [validTodo];
  const validationEndpoint = endpoint('dao-validation');
  const validationServer = new McpBridgeServer();
  await validationServer.start(validationEndpoint);
  const validationClient = new StdioClient(validationEndpoint.path);
  const expectDaoFailure = async (key, badValue, tool, args, pattern) => {
    const previous = daoResults[key];
    const beforeBroadcasts = broadcasts.length;
    daoResults[key] = badValue;
    try {
      await assert.rejects(validationClient.callTool(tool, args), pattern);
      assert.equal(broadcasts.length, beforeBroadcasts, `${tool} broadcast after DAO failure`);
    } finally {
      daoResults[key] = previous;
    }
  };
  try {
    lastTodoUpdateParams = null;
    const clearedTodo = await validationClient.callTool('todo.update', {
      id: TODO_ID,
      dueAt: null,
      remindAt: null
    });
    assert.equal(clearedTodo.todo.due_at, null);
    assert.equal(clearedTodo.todo.remind_at, null);
    assert.equal(lastTodoUpdateParams.due_at, null);
    assert.equal(lastTodoUpdateParams.remind_at, null);

    const aliasConflictBroadcasts = broadcasts.length;
    lastTodoUpdateParams = null;
    await assert.rejects(
      validationClient.callTool('todo.update', {
        id: TODO_ID,
        dueAt: null,
        due_at: now
      }),
      /dueAt and due_at must match when both are provided/
    );
    assert.equal(lastTodoUpdateParams, null);
    assert.equal(broadcasts.length, aliasConflictBroadcasts);

    await expectDaoFailure(
      'domainCreate',
      null,
      'domain.create',
      { title: 'New domain' },
      /TodoistSyncRepository\.createDomain is unavailable/
    );
    await expectDaoFailure(
      'eventList',
      null,
      'event.list',
      {},
      /TodoistSyncRepository\.listAfter is unavailable/
    );
    await expectDaoFailure(
      'eventList',
      { events: null, latestEventId: 0, hasMore: false },
      'event.wait',
      { timeoutMs: 1000 },
      /TodoistSyncRepository\.listAfter returned an invalid event list result/
    );
    await expectDaoFailure(
      'todoList',
      {},
      'todo.list',
      { domainId: DOMAIN_ID },
      /TodoistSyncRepository\.getTodosByDomain returned an invalid array result/
    );
    await expectDaoFailure(
      'todoGet',
      undefined,
      'todo.get',
      { id: TODO_ID },
      new RegExp(`Todo not found: ${TODO_ID}`)
    );
    await expectDaoFailure(
      'todoGet',
      { id: 'bad' },
      'todo.get',
      { id: TODO_ID },
      /TodoistSyncRepository\.getTodoById returned an invalid todo row/
    );
    await expectDaoFailure(
      'todoStatus',
      null,
      'todo.status',
      { ids: [TODO_ID] },
      /TodoistSyncRepository\.getStatusByIds is unavailable/
    );
    await expectDaoFailure(
      'todoStatus',
      { items: [], summary: { active: 0, completed: 0, deleted: 0, missing: 0 } },
      'todo.status',
      { ids: [TODO_ID] },
      /TodoistSyncRepository\.getStatusByIds returned an invalid todo status result/
    );
    await expectDaoFailure(
      'todoCreate',
      null,
      'todo.create',
      { domainId: DOMAIN_ID, title: 'Created' },
      /TodoistSyncRepository\.createTodo is unavailable/
    );

    const previousCreate = daoResults.todoCreate;
    daoResults.todoCreate = { ...validTodo, title: 'Created' };
    await expectDaoFailure(
      'todoUpdate',
      null,
      'todo.create',
      { domainId: DOMAIN_ID, title: 'Created', note: 'validated before insert' },
      /TodoistSyncRepository\.updateTodo after create is unavailable/
    );
    daoResults.todoCreate = previousCreate;

    await expectDaoFailure(
      'todoUpdate',
      null,
      'todo.update',
      { id: TODO_ID, title: 'Updated' },
      new RegExp(`Todo not found: ${TODO_ID}`)
    );
    await expectDaoFailure(
      'todoUpdate',
      { ...validTodo, id: OTHER_TODO_ID, title: 'Updated' },
      'todo.update',
      { id: TODO_ID, title: 'Updated' },
      /TodoistSyncRepository\.updateTodo returned an invalid todo row/
    );
    await expectDaoFailure(
      'todoComplete',
      null,
      'todo.complete',
      { id: TODO_ID },
      new RegExp(`Todo not found: ${TODO_ID}`)
    );
    await expectDaoFailure(
      'todoUncomplete',
      undefined,
      'todo.uncomplete',
      { id: TODO_ID },
      new RegExp(`Todo not found: ${TODO_ID}`)
    );
    await expectDaoFailure(
      'todoDelete',
      false,
      'todo.delete',
      { id: TODO_ID },
      new RegExp(`Todo not found or not deleted: ${TODO_ID}`)
    );
    await expectDaoFailure(
      'todoMove',
      null,
      'todo.move',
      { id: TODO_ID, domainId: DOMAIN_ID },
      new RegExp(`Todo not found: ${TODO_ID}`)
    );

    const invalidBefore = broadcasts.length;
    await assert.rejects(
      validationClient.callTool('todo.create', {
        domainId: DOMAIN_ID,
        title: 'Must not be inserted',
        note: 'x'.repeat(10001)
      }),
      /note can contain at most 10000 characters/
    );
    assert.equal(broadcasts.length, invalidBefore);
    await assert.rejects(
      validationClient.callTool('todo.list', { domainId: MISSING_DOMAIN_ID }),
      new RegExp(`Active domain not found: ${MISSING_DOMAIN_ID}`)
    );
    await assert.rejects(
      validationClient.callTool('todo.move', { id: TODO_ID, domainId: MISSING_DOMAIN_ID }),
      new RegExp(`Active domain not found: ${MISSING_DOMAIN_ID}`)
    );

    daoResults.todoStatus = validStatus;
    const recoveredStatus = await validationClient.callTool('todo.status', { ids: [TODO_ID] });
    assert.equal(recoveredStatus.items[0].state, 'active');
  } finally {
    await validationClient.close();
    await validationServer.stop();
  }

  const helperBuild = await build({
    entryPoints: [join(projectRoot, 'src', 'main', 'mcp', 'mcpHelper.main.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    tsconfig: join(projectRoot, 'tsconfig.node.json'),
    metafile: true,
    write: false
  });
  assert.equal(
    Object.keys(helperBuild.metafile.inputs).some((path) => path.endsWith('src/main/app.main.ts')),
    false,
    'the MCP helper bundle must not import the application entry'
  );
  const helperBundleText = helperBuild.outputFiles.map((file) => file.text).join('\n');
  assert.doesNotMatch(helperBundleText, /BrowserWindow|require\("electron"\)|from\("electron"\)/);

  const appMainSource = readFileSync(join(projectRoot, 'src', 'main', 'app.main.ts'), 'utf8');
  const guiStartupSource = readFileSync(
    join(projectRoot, 'src', 'main', 'startup', 'guiStartup.service.ts'),
    'utf8'
  );
  const stdioSource = readFileSync(
    join(projectRoot, 'src', 'main', 'mcp', 'mcpStdio.helper.ts'),
    'utf8'
  );
  const handlerSource = readFileSync(
    join(projectRoot, 'src', 'main', 'xpc', 'mcp.handler.ts'),
    'utf8'
  );
  const viteConfigSource = readFileSync(join(projectRoot, 'electron.vite.config.ts'), 'utf8');
  assert.doesNotMatch(stdioSource, /from ['"]electron['"]|BrowserWindow|app\.getPath/);
  assert.match(
    handlerSource,
    /join\(app\.getAppPath\(\), 'out', 'main', 'mcpHelper\.js'\)/
  );
  assert.doesNotMatch(handlerSource, /--mcp-helper|app\.main/);
  assert.match(viteConfigSource, /mcpHelper: resolve\('src\/main\/mcp\/mcpHelper\.main\.ts'\)/);
  assert.match(appMainSource, /process\.argv\.includes\('--coding-agent-hook-helper'\)/);
  assert.doesNotMatch(appMainSource, /CODEX_HOOK_HELPER_ARG|runCodexHookHelper/);
  assert.match(
    appMainSource,
    /const isHelperMode = isMcpHelperMode \|\| isLegacyCodingAgentHookHelperMode/
  );
  assert.match(
    appMainSource,
    /if \(isLegacyCodingAgentHookHelperMode\) \{[\s\S]*?app\.exit\(2\);[\s\S]*?\} else if \(isMcpHelperMode\)/
  );
  const activationPolicyIndex = appMainSource.indexOf("app.setActivationPolicy('prohibited')");
  const singleInstanceIndex = appMainSource.indexOf('app.requestSingleInstanceLock()');
  const readyIndex = appMainSource.indexOf('app.whenReady()');
  const optionalStartIndex = appMainSource.indexOf('optionalIntegrationsLifecycle.start(');
  const optionalFenceIndex = appMainSource.indexOf(
    'await optionalIntegrationsLifecycle.fenceAndJoin()'
  );
  const eyesStopIndex = appMainSource.indexOf('await stopEyesOnAgentsRuntime?.()');
  const mcpStopIndex = appMainSource.indexOf('await mcpBridgeServer.stop()');
  assert.ok(activationPolicyIndex >= 0 && activationPolicyIndex < readyIndex);
  assert.match(
    appMainSource,
    /const hasSingleInstanceLock = isHelperMode \|\| app\.requestSingleInstanceLock\(\)/
  );
  assert.match(appMainSource, /app\.on\('second-instance',[\s\S]*?mainWindowHelper\.show\(\)/);
  assert.ok(singleInstanceIndex >= 0 && singleInstanceIndex < readyIndex);
  assert.ok(optionalFenceIndex >= 0 && optionalFenceIndex < eyesStopIndex);
  assert.ok(optionalFenceIndex < mcpStopIndex);
  const sqliteCreateIndex = appMainSource.indexOf('sqliteWindowHelper.create(');
  const sqliteGuardIndex = appMainSource.indexOf('coreSqliteBoot.ready({ targetId })');
  const languageIndex = appMainSource.indexOf('applicationLanguageService.initialize()');
  const mainWindowIndex = appMainSource.indexOf('mainWindowHelper.create(');
  const ensureShimIndex = appMainSource.indexOf('await mcpHandler.ensureShim()');
  const trayIndex = appMainSource.indexOf('trayHelper.init(mainWindowHelper)');
  const bridgeStartIndex = appMainSource.indexOf('await mcpBridgeServer.start()');
  const eyesImportIndex = appMainSource.indexOf("await import('./xpc/eyesOnAgents.handler')");
  assert.ok(sqliteCreateIndex >= 0 && sqliteCreateIndex < sqliteGuardIndex);
  assert.ok(mainWindowIndex >= 0);
  assert.ok(languageIndex >= 0);
  assert.ok(mainWindowIndex < ensureShimIndex);
  assert.ok(mainWindowIndex < trayIndex);
  assert.ok(ensureShimIndex < optionalStartIndex);
  assert.ok(trayIndex < optionalStartIndex);
  assert.ok(optionalStartIndex < bridgeStartIndex);
  assert.ok(optionalStartIndex < eyesImportIndex);
  assert.equal(appMainSource.match(/mcpHandler\.ensureShim\(\)/g)?.length, 1);
  assert.equal(
    appMainSource.match(/if \(!canStartNextStage\(\)\) return;/g)?.length,
    3
  );
  assert.ok(
    guiStartupSource.indexOf('dependencies.startCoreSqlite()') <
      guiStartupSource.indexOf('dependencies.initializeLanguageFallback()')
  );
  assert.ok(
    guiStartupSource.indexOf('dependencies.initializeLanguageFallback()') <
      guiStartupSource.indexOf('dependencies.createHome()')
  );
  assert.match(guiStartupSource, /void coreSqliteResult/);
  assert.doesNotMatch(appMainSource, /withStartupTimeout|\bSQLITE_STARTUP_TIMEOUT_MS\b/);
  assert.doesNotMatch(appMainSource, /app\.exit\(1\)/);
  assert.match(appMainSource, /startupDiagnosticsService\.report\('core-sqlite', err\)/);
  assert.doesNotMatch(appMainSource, /did-finish-load|waitForWindowLoad/);
  assert.doesNotMatch(appMainSource, /degraded Home|isSqliteDocumentAvailable/);
  assert.match(appMainSource, /isShutdownStarted = true/);
  assert.match(appMainSource, /void optionalIntegrationsLifecycle\.start/);
  assert.match(
    appMainSource,
    /app\.whenReady\(\)\.then\(async \(\) => \{[\s\S]*await startGui\(\);[\s\S]*\}\)\.catch/
  );

  console.log(
    '[mcp-multi-instance-test] routing, Node-only helper isolation, lifecycle overlap, config, shim quoting, pinned helpers, socket ownership, stale recovery, and startup ordering passed'
  );
} finally {
  rmSync(tempDirectory, { force: true, recursive: true });
}
