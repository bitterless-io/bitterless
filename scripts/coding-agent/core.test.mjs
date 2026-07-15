/* eslint-disable @typescript-eslint/explicit-function-return-type */

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const buildRoot = mkdtempSync(join(tmpdir(), 'bitterless-coding-agent-core-'));
const fixture = (name) => join(projectRoot, 'scripts', 'coding-agent', 'fixtures', name);

const loadTypeScriptModule = async (name, entry) => {
  const outfile = join(buildRoot, `${name}.mjs`);
  await build({
    entryPoints: [join(projectRoot, entry)],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    tsconfig: join(projectRoot, 'tsconfig.node.json'),
    external: ['better-sqlite3-multiple-ciphers']
  });
  return await import(`${pathToFileURL(outfile).href}?v=${Date.now()}-${name}`);
};

const ID_1 = '11111111-1111-4111-8111-111111111111';
const ID_2 = '22222222-2222-4222-8222-222222222222';
const ID_3 = '33333333-3333-4333-8333-333333333333';
const CODEX_ID = '019f653a-2ef7-7031-8f6b-c770bacffbb2';
const CLAUDE_ID = '44444444-4444-4444-8444-444444444444';

const makeRecord = (overrides = {}) => ({
  id: ID_1,
  provider: 'claude',
  surface: 'claude-code-cli',
  externalSessionId: CLAUDE_ID,
  runtimeJobId: null,
  title: null,
  titleIsCustom: false,
  cwd: projectRoot,
  state: 'unknown',
  lastTurnState: 'unknown',
  providerState: null,
  statusSource: 'none',
  statusObservedAt: null,
  statusFreshUntil: null,
  isProcessAlive: null,
  createdAt: 1,
  updatedAt: 1,
  ...overrides
});

try {
  const contract = await loadTypeScriptModule(
    'contract',
    'src/shared/codingAgent/codingAgentSession.contract.ts'
  );
  assert.equal(contract.parseUuid(CODEX_ID.toUpperCase(), 'id'), CODEX_ID);
  assert.throws(() => contract.parseUuid('not-a-uuid', 'id'), /must be a UUID/);
  assert.throws(() => contract.parseClaudeJobId('--help'), /invalid/);
  assert.throws(() => contract.parseClaudeJobId('job/../../bad'), /invalid/);
  assert.equal(contract.parseClaudeJobId('job_A-12:child'), 'job_A-12:child');
  assert.throws(
    () =>
      contract.parseRegisterCodingAgentSessionParams({
        provider: 'codex',
        surface: 'claude-code-cli',
        externalSessionId: CODEX_ID
      }),
    /does not belong/
  );
  assert.throws(
    () =>
      contract.parseRegisterCodingAgentSessionParams({
        provider: 'codex',
        surface: 'codex-desktop',
        externalSessionId: CODEX_ID,
        url: 'file:///tmp/evil'
      }),
    /unsupported field/
  );
  assert.throws(
    () => contract.parseCodingAgentListParams({ includeUnknown: 'yes' }),
    /must be a boolean/
  );
  assert.throws(
    () => contract.parseCodingAgentIdParams({ id: ID_1, url: 'codex://threads/evil' }),
    /unsupported field/
  );
  assert.throws(() => contract.parsePathText(` ${projectRoot}`), /whitespace/);
  for (const state of [
    'working',
    'waiting_approval',
    'waiting_input',
    'idle',
    'failed',
    'stopped',
    'ended',
    'unknown'
  ]) {
    assert.equal(contract.parseRuntimeState(state), state);
  }
  for (const state of ['in_progress', 'completed', 'interrupted', 'failed', 'unknown']) {
    assert.equal(contract.parseTurnState(state), state);
  }
  assert.throws(() => contract.parseRuntimeState('future'), /unsupported/);
  assert.throws(() => contract.parseTurnState('future'), /unsupported/);

  assert.deepEqual(
    contract.normalizeCodexThreadStatus(
      { type: 'active', activeFlags: [] },
      { authoritative: true }
    ),
    {
      state: 'working',
      lastTurnState: 'in_progress',
      providerState: 'active',
      recognized: true
    }
  );
  assert.equal(
    contract.normalizeCodexThreadStatus(
      { type: 'active', activeFlags: ['waitingOnApproval'] },
      { authoritative: true }
    ).state,
    'waiting_approval'
  );
  assert.equal(
    contract.normalizeCodexThreadStatus(
      { type: 'active', activeFlags: ['waitingOnUserInput'] },
      { authoritative: true }
    ).state,
    'waiting_input'
  );
  assert.equal(
    contract.normalizeCodexThreadStatus(
      { type: 'idle' },
      { authoritative: true, lastTurnState: 'completed' }
    ).state,
    'idle'
  );
  assert.equal(
    contract.normalizeCodexThreadStatus({ type: 'systemError' }, { authoritative: true }).state,
    'failed'
  );
  assert.equal(
    contract.normalizeCodexThreadStatus({ type: 'notLoaded' }, { authoritative: true }).state,
    'unknown'
  );
  assert.equal(
    contract.normalizeCodexThreadStatus(
      { type: 'active', activeFlags: [] },
      { authoritative: false }
    ).state,
    'unknown',
    'a separate App Server must not claim Desktop live state'
  );
  assert.deepEqual(
    contract.normalizeCodexThreadStatus({ type: 'futureState' }, { authoritative: true }),
    {
      state: 'unknown',
      lastTurnState: 'unknown',
      providerState: 'futureState',
      recognized: false
    }
  );

  const claudeCases = [
    ['working', undefined, 'working', 'in_progress'],
    ['blocked', 'permission prompt', 'waiting_approval', 'in_progress'],
    ['blocked', 'input needed', 'waiting_input', 'in_progress'],
    ['done', undefined, 'idle', 'completed'],
    ['failed', undefined, 'failed', 'failed'],
    ['stopped', undefined, 'stopped', 'interrupted']
  ];
  for (const [providerState, waitingFor, state, lastTurnState] of claudeCases) {
    const normalized = contract.normalizeClaudeBackgroundState(providerState, waitingFor);
    assert.equal(normalized.state, state);
    assert.equal(normalized.lastTurnState, lastTurnState);
    assert.equal(normalized.recognized, true);
  }
  assert.deepEqual(contract.normalizeClaudeBackgroundState('future', null), {
    state: 'unknown',
    lastTurnState: 'unknown',
    providerState: 'future',
    recognized: false
  });
  assert.equal(
    contract.effectiveRuntimeState(
      { state: 'working', statusObservedAt: 100, statusFreshUntil: 200 },
      200,
      100,
      true
    ),
    'working'
  );
  assert.equal(
    contract.effectiveRuntimeState(
      { state: 'working', statusObservedAt: 100, statusFreshUntil: 200 },
      201,
      100,
      true
    ),
    'unknown'
  );
  assert.equal(
    contract.effectiveRuntimeState(
      { state: 'working', statusObservedAt: 100, statusFreshUntil: 200 },
      100,
      100
    ),
    'unknown',
    'a nonterminal observation from before this service instance must be unknown'
  );
  assert.equal(
    contract.effectiveRuntimeState(
      { state: 'failed', statusObservedAt: 99, statusFreshUntil: 200 },
      999,
      100
    ),
    'failed'
  );
  assert.equal(
    contract.effectiveRuntimeState(
      { state: 'ended', statusObservedAt: null, statusFreshUntil: null },
      999,
      100
    ),
    'ended'
  );
  assert.equal(
    contract.effectiveProcessLiveness(
      { isProcessAlive: true, statusObservedAt: 99, statusFreshUntil: 200 },
      100,
      100
    ),
    null
  );
  assert.equal(
    contract.effectiveProcessLiveness(
      { isProcessAlive: false, statusObservedAt: 100, statusFreshUntil: 200 },
      200,
      100,
      true
    ),
    false
  );

  const targets = await loadTypeScriptModule(
    'targets',
    'src/main/codingAgent/codingAgentTarget.ts'
  );
  const existingInspector = { isDirectory: (path) => path === projectRoot };
  assert.equal(targets.buildCodexThreadDeepLink(CODEX_ID), `codex://threads/${CODEX_ID}`);
  assert.throws(() => targets.buildCodexThreadDeepLink('bad'), /must be a UUID/);
  assert.throws(
    () => targets.requireExistingAbsoluteDirectory('relative/path', existingInspector),
    /absolute/
  );
  assert.throws(
    () => targets.requireExistingAbsoluteDirectory('/definitely/missing', existingInspector),
    /existing/
  );
  assert.throws(
    () => targets.requireExistingAbsoluteDirectory(`${projectRoot}\n--resume`, existingInspector),
    /control/
  );
  assert.deepEqual(
    targets.buildClaudeCommandTarget(
      makeRecord({
        surface: 'claude-code-background',
        runtimeJobId: 'job_A-12:child'
      }),
      existingInspector
    ),
    {
      kind: 'terminal-command',
      target: {
        kind: 'claude-attach',
        executable: 'claude',
        args: ['attach', 'job_A-12:child'],
        cwd: projectRoot
      }
    }
  );
  assert.deepEqual(
    targets.buildClaudeCommandTarget(
      makeRecord({
        isProcessAlive: false
      }),
      existingInspector
    ),
    {
      kind: 'terminal-command',
      target: {
        kind: 'claude-resume',
        executable: 'claude',
        args: ['--resume', CLAUDE_ID],
        cwd: projectRoot
      }
    }
  );
  assert.equal(
    targets.buildClaudeCommandTarget(makeRecord({ isProcessAlive: true })).kind,
    'already-open'
  );
  assert.equal(
    targets.buildClaudeCommandTarget(makeRecord({ isProcessAlive: null })).kind,
    'unavailable'
  );
  assert.throws(
    () =>
      targets.buildClaudeCommandTarget(
        makeRecord({
          surface: 'claude-code-background',
          runtimeJobId: '--dangerous'
        }),
        existingInspector
      ),
    /invalid/
  );

  const command = await loadTypeScriptModule(
    'command-runner',
    'src/main/codingAgent/commandRunner.ts'
  );
  assert.deepEqual(
    await command.runCommand({
      executable: process.execPath,
      args: [fixture('command.fixture.mjs'), 'ok'],
      timeoutMs: 1000,
      maxOutputBytes: 1024
    }),
    { stdout: 'ok', stderr: '' }
  );
  await assert.rejects(
    command.runCommand({
      executable: process.execPath,
      args: [fixture('command.fixture.mjs'), 'sleep'],
      timeoutMs: 50,
      maxOutputBytes: 1024
    }),
    (error) => error?.code === 'timeout'
  );
  await assert.rejects(
    command.runCommand({
      executable: process.execPath,
      args: [fixture('command.fixture.mjs'), 'output'],
      timeoutMs: 1000,
      maxOutputBytes: 128
    }),
    (error) => error?.code === 'output_limit'
  );

  const claude = await loadTypeScriptModule(
    'claude-discovery',
    'src/main/codingAgent/claudeDiscovery.adapter.ts'
  );
  const invocations = [];
  const claudeOutput = [
    {
      kind: 'interactive',
      pid: 71,
      cwd: projectRoot,
      startedAt: 100,
      sessionId: CLAUDE_ID,
      name: 'Foreground',
      state: 'working'
    },
    {
      kind: 'background',
      id: 'job-123',
      pid: null,
      cwd: projectRoot,
      startedAt: 101,
      sessionId: ID_3,
      name: 'Background',
      state: 'blocked',
      waitingFor: 'permission prompt'
    }
  ];
  const adapter = new claude.ClaudeDiscoveryAdapter({
    execute: async (params) => {
      invocations.push(params);
      return params.args[1] === '--help'
        ? { stdout: 'Usage: claude agents\n  --json Print JSON\n', stderr: '' }
        : { stdout: JSON.stringify(claudeOutput), stderr: '' };
    },
    now: () => 1000,
    freshnessMs: 500,
    idFactory: (() => {
      const ids = [ID_1, ID_2];
      return () => ids.shift();
    })()
  });
  const claudeDiscovery = await adapter.discover();
  assert.deepEqual(
    invocations.map((item) => item.args),
    [
      ['agents', '--help'],
      ['agents', '--json']
    ]
  );
  assert.equal(claudeDiscovery.sessions[0].surface, 'claude-code-cli');
  assert.equal(claudeDiscovery.sessions[0].state, 'unknown');
  assert.equal(claudeDiscovery.sessions[0].providerState, 'interactive');
  assert.equal(claudeDiscovery.sessions[0].statusSource, 'none');
  assert.equal(claudeDiscovery.sessions[0].isProcessAlive, true);
  assert.equal(claudeDiscovery.sessions[0].titleIsCustom, false);
  assert.equal(claudeDiscovery.sessions[1].surface, 'claude-code-background');
  assert.equal(claudeDiscovery.sessions[1].runtimeJobId, 'job-123');
  assert.equal(claudeDiscovery.sessions[1].state, 'waiting_approval');
  assert.equal(claudeDiscovery.sessions[1].statusFreshUntil, 1500);
  assert.equal(claudeDiscovery.sessions[1].isProcessAlive, false);
  assert.deepEqual(claudeDiscovery.snapshot, {
    status: 'success',
    observedAt: 1000,
    freshUntil: 1500
  });

  const allInvocations = [];
  await new claude.ClaudeDiscoveryAdapter({
    execute: async (params) => {
      allInvocations.push(params.args);
      return params.args[1] === '--help'
        ? { stdout: '--json\n--all\n', stderr: '' }
        : { stdout: '[]', stderr: '' };
    }
  }).discover();
  assert.deepEqual(allInvocations[1], ['agents', '--json', '--all']);
  const compatibilityDiscovery = await new claude.ClaudeDiscoveryAdapter({
    execute: async (params) =>
      params.args[1] === '--help'
        ? { stdout: '--json\n', stderr: '' }
        : {
            stdout: JSON.stringify([
              {
                kind: 'foreground',
                pid: 73,
                cwd: projectRoot,
                startedAt: 102,
                sessionId: CLAUDE_ID,
                name: 'Legacy foreground'
              },
              {
                kind: 'future-interactive-kind',
                pid: 74,
                cwd: projectRoot,
                startedAt: 103,
                sessionId: ID_2,
                name: 'Unknown kind'
              }
            ]),
            stderr: ''
          },
    idFactory: () => ID_1
  }).discover();
  assert.equal(compatibilityDiscovery.sessions.length, 1);
  assert.equal(compatibilityDiscovery.sessions[0].surface, 'claude-code-cli');
  assert.equal(compatibilityDiscovery.sessions[0].providerState, 'foreground');
  assert.ok(
    compatibilityDiscovery.issues.some(
      (issue) => issue.code === 'unsupported-entry' && issue.entryIndex === 1
    ),
    'unknown Claude agents kinds must be rejected explicitly'
  );
  assert.equal(compatibilityDiscovery.snapshot.status, 'failed');
  const invalidClaude = await new claude.ClaudeDiscoveryAdapter({
    execute: async (params) =>
      params.args[1] === '--help'
        ? { stdout: '--json\n', stderr: '' }
        : {
            stdout: JSON.stringify([
              {
                kind: 'background',
                id: '--help',
                cwd: projectRoot,
                startedAt: 1,
                sessionId: CLAUDE_ID,
                state: 'future'
              }
            ]),
            stderr: ''
          },
    idFactory: () => ID_1
  }).discover();
  assert.equal(invalidClaude.sessions[0].runtimeJobId, null);
  assert.equal(invalidClaude.sessions[0].state, 'unknown');
  assert.ok(invalidClaude.issues.some((issue) => issue.code === 'invalid-entry'));
  assert.ok(invalidClaude.issues.some((issue) => issue.code === 'unsupported-entry'));
  const invalidClaudeJson = await new claude.ClaudeDiscoveryAdapter({
    execute: async (params) =>
      params.args[1] === '--help' ? { stdout: '--json\n', stderr: '' } : { stdout: '{', stderr: '' }
  }).discover();
  assert.equal(invalidClaudeJson.issues[0].code, 'invalid-output');
  assert.equal(invalidClaudeJson.snapshot.status, 'failed');

  const codex = await loadTypeScriptModule(
    'codex-discovery',
    'src/main/codingAgent/codexDiscovery.adapter.ts'
  );
  const listedThreads = await codex.listCodexThreadsViaAppServer({
    executable: process.execPath,
    args: [fixture('codex-app-server.fixture.mjs'), 'normal'],
    timeoutMs: 1000,
    maxOutputBytes: 4096
  });
  assert.deepEqual(
    listedThreads.map((thread) => thread.id),
    [ID_1, ID_2]
  );
  await assert.rejects(
    codex.listCodexThreadsViaAppServer({
      executable: process.execPath,
      args: [fixture('codex-app-server.fixture.mjs'), 'timeout'],
      timeoutMs: 50,
      maxOutputBytes: 4096
    }),
    /timed out/
  );
  await assert.rejects(
    codex.listCodexThreadsViaAppServer({
      executable: process.execPath,
      args: [fixture('codex-app-server.fixture.mjs'), 'output'],
      timeoutMs: 1000,
      maxOutputBytes: 128
    }),
    /exceeded 128 bytes/
  );
  const codexDiscovery = await new codex.CodexDiscoveryAdapter({
    listThreads: async () => [
      { id: CODEX_ID, name: 'Stored task', cwd: projectRoot, status: { type: 'notLoaded' } },
      {
        id: ID_2,
        name: 'Misleading active',
        cwd: projectRoot,
        status: { type: 'active', activeFlags: [] }
      },
      { id: ID_3, name: 'Future', cwd: projectRoot, status: { type: 'future' } }
    ],
    idFactory: (() => {
      const ids = [ID_1, ID_2, ID_3];
      return () => ids.shift();
    })()
  }).discover();
  assert.deepEqual(
    codexDiscovery.sessions.map((session) => session.state),
    ['unknown', 'unknown', 'unknown']
  );
  assert.ok(codexDiscovery.sessions.every((session) => session.statusSource === 'none'));
  assert.ok(codexDiscovery.sessions.every((session) => session.titleIsCustom === false));
  assert.ok(codexDiscovery.issues.some((issue) => issue.code === 'unsupported-entry'));
  assert.equal(codexDiscovery.snapshot.status, 'failed');

  const tableModule = await loadTypeScriptModule(
    'table',
    'src/preload/sqlite/dao/codingAgentSession.table.ts'
  );
  const storeModule = await loadTypeScriptModule(
    'store',
    'src/preload/sqlite/dao/codingAgentSession.store.ts'
  );
  const database = new DatabaseSync(':memory:');
  database.exec(tableModule.codingAgentSessionTable.createSql);
  const sql = {
    get: async (sql, params = []) => database.prepare(sql).get(...params),
    all: async (sql, params = []) => database.prepare(sql).all(...params),
    run: async (sql, params = []) => database.prepare(sql).run(...params)
  };
  let now = 1000;
  const store = new storeModule.CodingAgentSessionStore(sql, () => now);
  const draft = {
    id: ID_1,
    provider: 'codex',
    surface: 'codex-desktop',
    externalSessionId: CODEX_ID,
    runtimeJobId: null,
    title: 'Task',
    titleIsCustom: false,
    cwd: projectRoot,
    state: 'unknown',
    lastTurnState: 'unknown',
    providerState: 'notLoaded',
    statusSource: 'none',
    statusObservedAt: null,
    statusFreshUntil: null,
    isProcessAlive: null
  };
  const created = await store.upsert(draft);
  assert.equal(created.id, ID_1);
  now = 1100;
  const updated = await store.upsert({ ...draft, id: ID_2, title: 'Updated task' });
  assert.equal(updated.id, ID_1, 'upsert must retain the active row identity');
  assert.equal(updated.title, 'Updated task');
  const manualWithoutTitle = await store.upsert({
    ...draft,
    id: ID_2,
    title: null,
    statusSource: 'manual'
  });
  assert.equal(manualWithoutTitle.title, 'Updated task');
  assert.equal((await store.list()).length, 1);
  const renamed = await store.rename({ id: ID_1, title: 'Renamed' });
  assert.equal(renamed.title, 'Renamed');
  assert.equal(renamed.titleIsCustom, true);
  const providerRefresh = await store.upsert({ ...draft, id: ID_2, title: 'Provider refresh' });
  assert.equal(providerRefresh.title, 'Renamed');
  assert.equal(providerRefresh.titleIsCustom, true);
  const clearedTitle = await store.rename({ id: ID_1, title: null });
  assert.equal(clearedTitle.title, null);
  assert.equal(clearedTitle.titleIsCustom, true);
  const afterClearRefresh = await store.upsert({ ...draft, id: ID_2, title: 'Provider again' });
  assert.equal(afterClearRefresh.title, null);
  assert.equal(afterClearRefresh.titleIsCustom, true);
  await store.updateStatus({
    id: ID_1,
    state: 'working',
    lastTurnState: 'in_progress',
    providerState: 'active',
    statusSource: 'codex-app-server',
    statusObservedAt: 1200,
    statusFreshUntil: 1500,
    isProcessAlive: true
  });
  const weakerRefresh = await store.upsert({ ...draft, id: ID_2, title: 'Weak refresh' });
  assert.equal(weakerRefresh.state, 'working', 'weak discovery must not override stronger status');
  assert.equal(weakerRefresh.statusSource, 'codex-app-server');
  assert.equal((await store.list({ includeUnknown: false })).length, 1);
  now = 2000;
  assert.equal(await store.softDelete({ id: ID_1 }), true);
  assert.equal((await store.list()).length, 0);
  now = 2100;
  const registeredAgain = await store.upsert({ ...draft, id: ID_2, title: 'Registered again' });
  assert.equal(registeredAgain.id, ID_2);
  const rawRows = database
    .prepare('SELECT is_deleted, delete_flag FROM coding_agent_session ORDER BY created_at ASC')
    .all();
  assert.equal(rawRows.length, 2);
  assert.deepEqual(
    rawRows.map((row) => row.is_deleted),
    [1, 0]
  );
  assert.notEqual(rawRows[0].delete_flag, '0');
  database.close();

  const serviceModule = await loadTypeScriptModule(
    'service',
    'src/main/codingAgent/codingAgentSession.service.ts'
  );
  const records = new Map();
  const changed = [];
  const opened = [];
  const repository = {
    upsert: async (value) => {
      const existing = [...records.values()].find(
        (record) =>
          record.provider === value.provider &&
          record.surface === value.surface &&
          record.externalSessionId === value.externalSessionId
      );
      const record = {
        ...(existing || value),
        ...value,
        id: existing?.id || value.id,
        createdAt: existing?.createdAt || 1,
        updatedAt: 1
      };
      records.set(record.id, record);
      return record;
    },
    list: async () => [...records.values()],
    getById: async ({ id }) => records.get(id),
    rename: async ({ id, title }) => {
      const record = { ...records.get(id), title, titleIsCustom: true };
      records.set(id, record);
      return record;
    },
    updateStatus: async () => {
      throw new Error('unused');
    },
    softDelete: async ({ id }) => records.delete(id)
  };
  const service = new serviceModule.CodingAgentSessionService({
    repository,
    codexDiscovery: {
      discover: async () => ({
        provider: 'codex',
        sessions: [],
        issues: [],
        snapshot: { status: 'failed' }
      })
    },
    claudeDiscovery: {
      discover: async () => ({
        provider: 'claude',
        sessions: [],
        issues: [],
        snapshot: { status: 'failed' }
      })
    },
    openExternal: async (url) => opened.push(url),
    broadcastChanged: (ids, revision) => changed.push({ ids, revision }),
    idFactory: () => ID_3,
    now: () => 9999
  });
  const registered = await service.register({
    provider: 'codex',
    surface: 'codex-desktop',
    externalSessionId: CODEX_ID,
    cwd: projectRoot
  });
  assert.equal(registered.statusSource, 'manual');
  assert.equal((await service.list({ includeUnknown: false })).length, 0);
  assert.equal((await service.open({ id: registered.id })).kind, 'opened-url');
  assert.deepEqual(opened, [`codex://threads/${CODEX_ID}`]);
  await service.rename({ id: registered.id, title: 'Core' });
  assert.equal(await service.remove({ id: registered.id }), true);
  assert.deepEqual(
    changed.map((event) => event.revision),
    [1, 2, 3]
  );

  const integrationDatabase = new DatabaseSync(':memory:');
  integrationDatabase.exec(tableModule.codingAgentSessionTable.createSql);
  const integrationSql = {
    get: async (sql, params = []) => integrationDatabase.prepare(sql).get(...params),
    all: async (sql, params = []) => integrationDatabase.prepare(sql).all(...params),
    run: async (sql, params = []) => integrationDatabase.prepare(sql).run(...params)
  };
  let integrationNow = 5000;
  const integrationStore = new storeModule.CodingAgentSessionStore(
    integrationSql,
    () => integrationNow
  );
  await integrationStore.upsert({
    id: ID_1,
    provider: 'claude',
    surface: 'claude-code-cli',
    externalSessionId: CLAUDE_ID,
    runtimeJobId: null,
    title: 'Persisted provider title',
    titleIsCustom: false,
    cwd: projectRoot,
    state: 'idle',
    lastTurnState: 'completed',
    providerState: 'idle',
    statusSource: 'claude-hook',
    statusObservedAt: 5000,
    statusFreshUntil: 9000,
    isProcessAlive: true
  });
  await integrationStore.upsert({
    id: ID_2,
    provider: 'codex',
    surface: 'codex-desktop',
    externalSessionId: CODEX_ID,
    runtimeJobId: null,
    title: 'Terminal task',
    titleIsCustom: false,
    cwd: projectRoot,
    state: 'failed',
    lastTurnState: 'failed',
    providerState: 'systemError',
    statusSource: 'codex-hook',
    statusObservedAt: 5000,
    statusFreshUntil: 9000,
    isProcessAlive: false
  });

  let integrationClaudeFails = false;
  let integrationClaudeOutput = [
    {
      kind: 'interactive',
      pid: 9001,
      cwd: projectRoot,
      startedAt: 5000,
      sessionId: CLAUDE_ID,
      name: 'Provider one'
    },
    {
      kind: 'background',
      id: 'same-millisecond-job',
      pid: null,
      cwd: projectRoot,
      startedAt: 5000,
      sessionId: ID_3,
      name: 'Same millisecond background',
      state: 'working'
    }
  ];
  const integrationClaudeAdapter = new claude.ClaudeDiscoveryAdapter({
    execute: async (params) => {
      if (params.args[1] === '--help') {
        return { stdout: '--json\n', stderr: '' };
      }
      if (integrationClaudeFails) throw new Error('Claude poll failed');
      return { stdout: JSON.stringify(integrationClaudeOutput), stderr: '' };
    },
    now: () => integrationNow,
    freshnessMs: 100
  });
  const integrationService = new serviceModule.CodingAgentSessionService({
    repository: integrationStore,
    codexDiscovery: {
      discover: async () => ({
        provider: 'codex',
        sessions: [],
        issues: [],
        snapshot: { status: 'failed' }
      })
    },
    claudeDiscovery: integrationClaudeAdapter,
    openExternal: async () => {},
    now: () => integrationNow,
    idFactory: () => ID_3
  });

  const startupRows = await integrationService.list();
  const startupCli = startupRows.find((row) => row.id === ID_1);
  const startupTerminal = startupRows.find((row) => row.id === ID_2);
  assert.equal(startupCli.state, 'unknown');
  assert.equal(startupCli.lastTurnState, 'completed');
  assert.equal(startupCli.isProcessAlive, null);
  assert.equal(startupTerminal.state, 'failed');
  assert.equal(startupTerminal.lastTurnState, 'failed');
  assert.equal((await integrationService.open({ id: ID_1 })).kind, 'unavailable');

  await integrationService.refresh({ provider: 'claude' });
  const sameMillisecondBackground = (await integrationService.list()).find(
    (row) => row.externalSessionId === ID_3
  );
  assert.equal(sameMillisecondBackground.state, 'working');
  assert.equal(sameMillisecondBackground.isProcessAlive, false);

  integrationNow = 5100;
  await integrationService.refresh({ provider: 'claude' });
  const liveCli = (await integrationService.list()).find((row) => row.id === ID_1);
  assert.equal(liveCli.state, 'unknown');
  assert.equal(liveCli.isProcessAlive, true);
  assert.equal(liveCli.title, 'Provider one');
  assert.equal((await integrationStore.getById({ id: ID_1 })).statusSource, 'claude-hook');
  assert.equal((await integrationService.open({ id: ID_1 })).kind, 'already-open');

  await integrationService.rename({ id: ID_1, title: 'Custom title' });
  integrationClaudeOutput = [
    {
      ...integrationClaudeOutput[0],
      name: 'Provider two'
    }
  ];
  integrationNow = 5110;
  await integrationService.refresh({ provider: 'claude' });
  const customTitleCli = (await integrationService.list()).find((row) => row.id === ID_1);
  assert.equal(customTitleCli.title, 'Custom title');
  assert.equal(customTitleCli.titleIsCustom, true);

  await integrationService.rename({ id: ID_1, title: null });
  integrationClaudeOutput = [
    {
      ...integrationClaudeOutput[0],
      name: 'Provider three'
    }
  ];
  integrationNow = 5120;
  await integrationService.refresh({ provider: 'claude' });
  const clearedTitleCli = (await integrationService.list()).find((row) => row.id === ID_1);
  assert.equal(clearedTitleCli.title, null);
  assert.equal(clearedTitleCli.titleIsCustom, true);
  const persistedTitles = integrationDatabase
    .prepare('SELECT title, provider_title, custom_title FROM coding_agent_session WHERE id = ?')
    .get(ID_1);
  assert.equal(persistedTitles.title, null);
  assert.equal(persistedTitles.provider_title, 'Provider three');
  assert.equal(persistedTitles.custom_title, 1);

  integrationClaudeOutput = [];
  integrationNow = 5130;
  await integrationService.refresh({ provider: 'claude' });
  const absentCli = (await integrationService.list()).find((row) => row.id === ID_1);
  assert.equal(absentCli.isProcessAlive, false);
  assert.deepEqual(await integrationService.open({ id: ID_1 }), {
    kind: 'terminal-command',
    target: {
      kind: 'claude-resume',
      executable: 'claude',
      args: ['--resume', CLAUDE_ID],
      cwd: projectRoot
    }
  });

  integrationClaudeFails = true;
  integrationNow = 5140;
  const failedRefresh = await integrationService.refresh({ provider: 'claude' });
  assert.ok(failedRefresh.issues.some((issue) => issue.code === 'command-failed'));
  assert.equal(
    (await integrationService.list()).find((row) => row.id === ID_1).isProcessAlive,
    null
  );
  assert.equal((await integrationService.open({ id: ID_1 })).kind, 'unavailable');

  integrationClaudeFails = false;
  integrationNow = 5150;
  await integrationService.refresh({ provider: 'claude' });
  assert.equal((await integrationService.open({ id: ID_1 })).kind, 'terminal-command');
  integrationNow = 5251;
  assert.equal(
    (await integrationService.list()).find((row) => row.id === ID_1).isProcessAlive,
    null
  );
  assert.equal((await integrationService.open({ id: ID_1 })).kind, 'unavailable');
  integrationDatabase.close();

  const handlerSource = readFileSync(
    join(projectRoot, 'src/main/xpc/codingAgentSession.handler.ts'),
    'utf8'
  );
  assert.match(handlerSource, /implements CodingAgentSessionApi/);
  for (const method of ['list', 'register', 'refresh', 'open', 'rename', 'remove']) {
    const match = handlerSource.match(new RegExp(`async ${method}\\(([^)]*)\\)`));
    assert.ok(match, `handler must implement ${method}`);
    const parameters = match[1].trim();
    assert.ok(!parameters.includes(','), `${method} must accept at most one parameter object`);
  }

  console.log('[coding-agent-core] ok');
} finally {
  rmSync(buildRoot, { recursive: true, force: true });
}
