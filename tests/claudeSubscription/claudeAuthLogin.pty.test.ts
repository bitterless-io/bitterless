import assert from 'node:assert/strict';
import { chmod, mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  ScriptClaudeAuthLoginPtyFactory,
  type ClaudeAuthLoginPty,
  type ClaudeAuthLoginPtyExit
} from '../../src/main/claudeSubscription/claudeAuthLogin.pty';

const createContext = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'bitterless-auth-login-pty-'));
  const configDirectory = path.join(root, 'profile');
  const anthropicConfigDirectory = path.join(configDirectory, 'anthropic');
  await mkdir(anthropicConfigDirectory, { recursive: true });
  return {
    root,
    context: {
      configDirectory,
      secureStorageConfigDirectory: configDirectory,
      anthropicConfigDirectory
    }
  };
};

const waitForPid = async (pidPath: string): Promise<number> => {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      return Number(await readFile(pidPath, 'utf8'));
    } catch {
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
  }
  throw new Error('fake auth login child did not start');
};

const processExists = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

test('real expect/script adapter uses exact auth login isolation and awaits process-group teardown', async (context) => {
  if (process.platform !== 'darwin') {
    context.skip('macOS /usr/bin/expect and /usr/bin/script contract');
    return;
  }
  const fixture = await createContext();
  const executable = path.resolve(
    process.cwd(),
    'tests/claudeSubscription/fixtures/fake-auth-login-cli.mjs'
  );
  await chmod(executable, 0o755);
  let pty: ClaudeAuthLoginPty | null = null;
  try {
    pty = new ScriptClaudeAuthLoginPtyFactory({
      claudeExecutable: executable,
      parentEnvironment: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        CLAUDE_CODE_OAUTH_TOKEN: 'must-not-pass'
      }
    }).spawn({ context: fixture.context });
    const childPid = await waitForPid(
      path.join(fixture.context.configDirectory, 'fake-auth-login.pid')
    );
    assert.equal(processExists(childPid), true);
    const startedAt = Date.now();
    await pty.kill();
    assert.equal(Date.now() - startedAt < 2_500, true);
    assert.equal(processExists(childPid), false);
  } finally {
    if (pty) await pty.kill().catch(() => undefined);
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('real expect/script adapter propagates the inner auth login nonzero exit', async (context) => {
  if (process.platform !== 'darwin') {
    context.skip('macOS /usr/bin/expect and /usr/bin/script contract');
    return;
  }
  const fixture = await createContext();
  const executable = path.resolve(
    process.cwd(),
    'tests/claudeSubscription/fixtures/fake-auth-login-failure-cli.mjs'
  );
  await chmod(executable, 0o755);
  let pty: ClaudeAuthLoginPty | null = null;
  try {
    pty = new ScriptClaudeAuthLoginPtyFactory({ claudeExecutable: executable }).spawn({
      context: fixture.context
    });
    const result = await new Promise<ClaudeAuthLoginPtyExit>((resolve) => pty!.onExit(resolve));
    assert.equal(result.exitCode, 23);
  } finally {
    if (pty) await pty.kill().catch(() => undefined);
    await rm(fixture.root, { recursive: true, force: true });
  }
});
