import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  ClaudeCliAccountAuth,
  ClaudeLogoutError,
  buildClaudeAuthLogoutArguments
} from '../../src/main/claudeSubscription/claudeAuth.command';
import {
  buildClaudeAuthStatusArguments,
  buildClaudeIsolationArguments,
  type ClaudeProcessSpawner
} from '../../src/main/claudeSubscription/claudeCli.executor';
import { ClaudeAuthenticationError } from '../../src/main/claudeSubscription/claudeSubscription.errors';
import { fakeClaudeScript } from './claudeSubscriptionTest.helper';

const spawnProcess: ClaudeProcessSpawner = (command, arguments_, environment, cwd) =>
  spawn(command, [...arguments_], {
    cwd,
    env: { ...environment },
    stdio: ['pipe', 'pipe', 'pipe']
  });

const createFixture = async (mode: string) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'bitterless-auth-command-'));
  const configDirectory = path.join(root, 'profile');
  const anthropicConfigDirectory = path.join(configDirectory, 'anthropic');
  await mkdir(anthropicConfigDirectory, { recursive: true });
  const context = {
    configDirectory,
    secureStorageConfigDirectory: configDirectory,
    anthropicConfigDirectory
  };
  const cli = new ClaudeCliAccountAuth({
    claudeExecutable: process.execPath,
    commandPrefixArguments: [fakeClaudeScript, mode],
    parentEnvironment: {
      PATH: process.env.PATH,
      ANTHROPIC_API_KEY: 'must-not-pass',
      CLAUDE_CODE_OAUTH_TOKEN: 'must-not-pass'
    },
    spawnProcess
  });
  return { root, context, cli };
};

test('builds exact isolated status and logout argv', () => {
  assert.deepEqual(buildClaudeAuthStatusArguments(), [
    ...buildClaudeIsolationArguments(),
    'auth',
    'status',
    '--json'
  ]);
  assert.deepEqual(buildClaudeAuthLogoutArguments(), [
    ...buildClaudeIsolationArguments(),
    'auth',
    'logout'
  ]);
});

test('verifies paid first-party metadata without returning credential material', async () => {
  const fixture = await createFixture('final');
  try {
    assert.deepEqual(await fixture.cli.verify(fixture.context), {
      loggedIn: true,
      authMethod: 'claude.ai',
      apiProvider: 'firstParty',
      subscriptionType: 'max',
      email: 'fixture@example.com'
    });
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('rejects the CLI plaintext credential fallback without reading it', async () => {
  const fixture = await createFixture('final');
  try {
    await writeFile(path.join(fixture.context.configDirectory, '.credentials.json'), 'secret', {
      mode: 0o600
    });
    await assert.rejects(fixture.cli.verify(fixture.context), ClaudeAuthenticationError);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('logout requires exit zero then strict logged-out status exit one', async () => {
  const success = await createFixture('logout-ok');
  try {
    await success.cli.logout(success.context);
  } finally {
    await rm(success.root, { recursive: true, force: true });
  }

  for (const mode of ['logout-fail', 'logout-wrong-exit', 'logout-invalid-status']) {
    const fixture = await createFixture(mode);
    try {
      await assert.rejects(fixture.cli.logout(fixture.context), ClaudeLogoutError);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  }
});
