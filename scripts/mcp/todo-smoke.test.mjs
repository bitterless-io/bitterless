#!/usr/bin/env node

/* eslint-disable @typescript-eslint/explicit-function-return-type */

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const cliPath = join(scriptDirectory, 'todo-smoke.mjs');
const fixturePath = join(scriptDirectory, 'fixtures', 'todo-mcp.fixture.mjs');
const tempDirectory = mkdtempSync(join(tmpdir(), 'bitterless-todo-smoke-'));
const FIXTURE_DOMAIN_ID = '00000000000000000007';

const runCli = (args, timeout = 10000, env = {}) => {
  return spawnSync(process.execPath, [cliPath, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
    timeout
  });
};

const runFixture = (name, options = {}) => {
  const stateFile = join(tempDirectory, `${name}.json`);
  const helperArgs = [fixturePath, '--mode', options.mode ?? 'normal', '--state-file', stateFile];
  const args = ['--helper', process.execPath];
  for (const helperArg of helperArgs) args.push('--helper-arg', helperArg);
  args.push('--domain', 'Others', '--timeout', String(options.timeoutMs ?? 2000));
  if (options.readOnly) args.push('--read-only');
  const startedAt = Date.now();
  const result = runCli(args, 10000, {
    BITTERLESS_MCP_SMOKE_TEST_SETTLEMENT_MS: '300',
    NODE_ENV: 'test'
  });
  return {
    durationMs: Date.now() - startedAt,
    result,
    state: JSON.parse(readFileSync(stateFile, 'utf8'))
  };
};

const assertNoSmokeTodoRemains = (state) => {
  const owned = state.todos.filter((todo) => todo.fixtureRole === 'owned');
  assert.equal(owned.length, 1);
  assert.equal(owned[0].deleted, true, JSON.stringify(state, null, 2));
};

const assertFreshSessionCleanup = (run, options) => {
  assert.equal(run.result.status, 1, `${run.result.stdout}\n${run.result.stderr}`);
  assert.doesNotMatch(run.result.stdout, /PASS/);
  assert.match(run.result.stderr, options.errorPattern);
  assert.match(
    run.result.stderr,
    /fresh-session settlement verified 1 owned todo deleted and zero remain/
  );
  assertNoSmokeTodoRemains(run.state);

  const createCall = run.state.calls.find((call) => call.name === 'todo.create');
  const deleteCall = run.state.calls.find((call) => call.name === 'todo.delete');
  const deleteStatusCall = run.state.calls.find((call) => {
    return call.name === 'todo.status' && call.sessionId === deleteCall.sessionId;
  });
  assert.ok(createCall);
  assert.ok(deleteCall);
  assert.ok(deleteStatusCall);
  assert.notEqual(createCall.sessionId, deleteCall.sessionId);

  const listCalls = run.state.calls.filter((call) => call.name === 'todo.list');
  assert.ok(listCalls.length >= 2);
  assert.ok(listCalls.every((call) => call.sessionId === deleteCall.sessionId));
  assert.ok(listCalls.every((call) => call.args.domainId === FIXTURE_DOMAIN_ID));

  const deleteIndex = run.state.calls.indexOf(deleteCall);
  const ownershipGet = run.state.calls.slice(0, deleteIndex).findLast((call) => {
    return call.name === 'todo.get' && call.args.id === deleteCall.args.id;
  });
  assert.ok(ownershipGet);
  assert.equal(ownershipGet.sessionId, deleteCall.sessionId);
};

try {
  const help = runCli(['--help']);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /--profile <name>/);
  assert.match(help.stdout, /--keep/);
  assert.match(help.stdout, /--read-only/);

  const invalidProfile = runCli(['--profile', 'staging']);
  assert.equal(invalidProfile.status, 2);
  assert.match(invalidProfile.stderr, /--profile must be production or debug/);

  const conflictingTarget = runCli([
    '--profile',
    'debug',
    '--helper',
    process.execPath
  ]);
  assert.equal(conflictingTarget.status, 2);
  assert.match(conflictingTarget.stderr, /--profile cannot be combined with --helper/);

  const isolatedProfileEnv = {
    APPDATA: join(tempDirectory, 'profile-appdata'),
    BITTERLESS_MCP_HELPER: '',
    HOME: join(tempDirectory, 'profile-home'),
    XDG_CONFIG_HOME: join(tempDirectory, 'profile-config')
  };
  const defaultProduction = runCli(['--read-only'], 10000, isolatedProfileEnv);
  assert.equal(defaultProduction.status, 1);
  assert.match(defaultProduction.stdout, /target: production/);
  assert.match(defaultProduction.stdout, /helper: .*Bitterless[\\/]bin[\\/]bitterless-mcp(?:\.cmd)?/);
  assert.doesNotMatch(defaultProduction.stdout, /Bitterless_DEBUG/);

  const explicitDebug = runCli(
    ['--profile', 'debug', '--read-only'],
    10000,
    isolatedProfileEnv
  );
  assert.equal(explicitDebug.status, 1);
  assert.match(explicitDebug.stdout, /target: debug/);
  assert.match(explicitDebug.stdout, /helper: .*Bitterless_DEBUG[\\/]bin[\\/]bitterless-mcp(?:\.cmd)?/);

  const legacyEnvHelper = runCli(['--read-only'], 10000, {
    BITTERLESS_MCP_HELPER: join(tempDirectory, 'missing-custom-helper')
  });
  assert.equal(legacyEnvHelper.status, 1);
  assert.match(legacyEnvHelper.stdout, /target: custom \(BITTERLESS_MCP_HELPER\)/);
  assert.match(legacyEnvHelper.stdout, /missing-custom-helper/);

  const invalidTimeout = runCli(['--timeout', '0']);
  assert.equal(invalidTimeout.status, 2);
  assert.match(invalidTimeout.stderr, /Input error/);

  const invalidOption = runCli(['--unknown']);
  assert.equal(invalidOption.status, 2);
  assert.match(invalidOption.stderr, /Unknown option/);

  const lifecycle = runFixture('lifecycle');
  assert.equal(
    lifecycle.result.status,
    0,
    `${lifecycle.result.stdout}\n${lifecycle.result.stderr}`
  );
  assert.match(lifecycle.result.stdout, /connected to bitterless-todo-fixture/);
  assert.match(lifecycle.result.stdout, /create\/get ownership ok/);
  assert.match(lifecycle.result.stdout, /complete\/status ok/);
  assert.match(lifecycle.result.stdout, /uncomplete\/status ok/);
  assert.match(lifecycle.result.stdout, /delete\/status ok/);
  assert.match(lifecycle.result.stdout, /PASS \(todo cleaned up\)/);
  assertNoSmokeTodoRemains(lifecycle.state);
  const lifecycleCreate = lifecycle.state.calls.find((call) => call.name === 'todo.create');
  const lifecycleUpdate = lifecycle.state.calls.find((call) => call.name === 'todo.update');
  const markerMatch = lifecycleCreate.args.title.match(
    /bitterless-mcp-smoke:([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/i
  );
  assert.ok(markerMatch, lifecycleCreate.args.title);
  const marker = `bitterless-mcp-smoke:${markerMatch[1]}`;
  assert.match(lifecycleCreate.args.note, new RegExp(marker));
  assert.match(lifecycleUpdate.args.title, new RegExp(marker));
  assert.match(lifecycleUpdate.args.note, new RegExp(marker));

  assertFreshSessionCleanup(
    runFixture('create-timeout', { mode: 'create-timeout', timeoutMs: 100 }),
    { errorPattern: /Timed out.*todo\.create/ }
  );
  assertFreshSessionCleanup(runFixture('create-malformed', { mode: 'create-malformed' }), {
    errorPattern: /invalid JSON/
  });
  assertFreshSessionCleanup(
    runFixture('post-create-assertion', { mode: 'post-create-assertion' }),
    { errorPattern: /did not persist the updated title/ }
  );

  const wrongId = runFixture('wrong-response-id', { mode: 'wrong-response-id' });
  assertFreshSessionCleanup(wrongId, { errorPattern: /does not match this smoke run's ownership/ });
  const wrongIdDecoy = wrongId.state.todos.find((todo) => todo.fixtureRole === 'wrong-id-decoy');
  assert.equal(wrongIdDecoy.deleted, false);
  assert.ok(
    wrongId.state.calls
      .filter((call) => call.name === 'todo.delete')
      .every((call) => call.args.id !== wrongIdDecoy.id)
  );

  const sameTitleDecoys = runFixture('same-title-decoys', {
    mode: 'same-title-decoys',
    timeoutMs: 100
  });
  assertFreshSessionCleanup(sameTitleDecoys, { errorPattern: /Timed out.*todo\.create/ });
  const decoys = sameTitleDecoys.state.todos.filter((todo) => todo.fixtureRole.endsWith('decoy'));
  assert.equal(decoys.length, 2);
  assert.ok(decoys.every((todo) => todo.deleted === false));

  const delayedCommit = runFixture('delayed-commit', {
    mode: 'delayed-commit',
    timeoutMs: 100
  });
  assertFreshSessionCleanup(delayedCommit, { errorPattern: /Timed out.*todo\.create/ });
  assert.equal(delayedCommit.state.delayedCommitReleasedAfterList, 1);
  assert.deepEqual(delayedCommit.state.listSnapshots[0].ids, []);
  assert.ok(delayedCommit.state.listSnapshots.length >= 2);

  const ambiguous = runFixture('ambiguous-owned', {
    mode: 'ambiguous-owned',
    timeoutMs: 100
  });
  assert.equal(
    ambiguous.result.status,
    1,
    `${ambiguous.result.stdout}\n${ambiguous.result.stderr}`
  );
  assert.doesNotMatch(ambiguous.result.stdout, /PASS/);
  assert.match(ambiguous.result.stderr, /ownership recovery is ambiguous.*refusing to delete/i);
  assert.equal(ambiguous.state.calls.filter((call) => call.name === 'todo.delete').length, 0);
  const ambiguousOwned = ambiguous.state.todos.filter((todo) => {
    return todo.fixtureRole === 'owned' || todo.fixtureRole === 'owned-duplicate';
  });
  assert.equal(ambiguousOwned.length, 2);
  assert.ok(ambiguousOwned.every((todo) => todo.deleted === false));

  const nonzero = runFixture('helper-nonzero', { mode: 'helper-nonzero', readOnly: true });
  assert.equal(nonzero.result.status, 1, `${nonzero.result.stdout}\n${nonzero.result.stderr}`);
  assert.doesNotMatch(nonzero.result.stdout, /PASS/);
  assert.match(nonzero.result.stderr, /Helper exited uncleanly \(code=7/);

  const nonTerminating = runFixture('non-terminating', {
    mode: 'non-terminating',
    readOnly: true
  });
  assert.equal(
    nonTerminating.result.status,
    1,
    `${nonTerminating.result.stdout}\n${nonTerminating.result.stderr}`
  );
  assert.doesNotMatch(nonTerminating.result.stdout, /PASS/);
  assert.match(nonTerminating.result.stderr, /did not terminate after stdin closed and was killed/);
  assert.ok(
    nonTerminating.durationMs < 8000,
    `forced shutdown took ${nonTerminating.durationMs}ms`
  );

  console.log(
    '[todo-smoke-test] lifecycle, ownership-safe settlement cleanup, ambiguity, and helper shutdown cases passed'
  );
} finally {
  rmSync(tempDirectory, { force: true, recursive: true });
}
