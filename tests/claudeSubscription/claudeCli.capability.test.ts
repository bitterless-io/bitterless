import assert from 'node:assert/strict';
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  CLAUDE_SECURE_STORAGE_CONFIG_MARKER,
  probeClaudeCliCapabilities
} from '../../src/main/claudeSubscription/claudeCli.capability';

const trustFixtureExecutable = async (): Promise<boolean> => true;

test('stream-scans a canonical regular CLI binary across chunk boundaries', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'bitterless-cli-capability-'));
  try {
    const executable = path.join(root, 'claude');
    await writeFile(
      executable,
      Buffer.concat([
        Buffer.from('1234567', 'ascii'),
        Buffer.from(CLAUDE_SECURE_STORAGE_CONFIG_MARKER, 'ascii'),
        Buffer.from('tail', 'ascii')
      ])
    );
    const result = await probeClaudeCliCapabilities(executable, {
      chunkBytes: 8,
      verifyOfficialExecutable: trustFixtureExecutable
    });
    assert.equal(result.canonicalExecutable, await realpath(executable));
    assert.equal(result.isolatedCredentialStorage, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('fails closed for a missing marker, non-file, missing, and relative path', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'bitterless-cli-capability-'));
  try {
    const executable = path.join(root, 'claude');
    await writeFile(executable, 'ordinary binary');
    assert.equal(
      (
        await probeClaudeCliCapabilities(executable, {
          verifyOfficialExecutable: trustFixtureExecutable
        })
      ).isolatedCredentialStorage,
      false
    );
    const directory = path.join(root, 'directory');
    await mkdir(directory);
    assert.equal(
      (
        await probeClaudeCliCapabilities(directory, {
          verifyOfficialExecutable: trustFixtureExecutable
        })
      ).isolatedCredentialStorage,
      false
    );
    assert.equal(
      (
        await probeClaudeCliCapabilities(path.join(root, 'missing'), {
          verifyOfficialExecutable: trustFixtureExecutable
        })
      ).isolatedCredentialStorage,
      false
    );
    assert.equal((await probeClaudeCliCapabilities('claude')).isolatedCredentialStorage, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects a marker-bearing executable when official provenance cannot be verified', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'bitterless-cli-capability-'));
  try {
    const executable = path.join(root, 'claude');
    await writeFile(executable, CLAUDE_SECURE_STORAGE_CONFIG_MARKER);
    const result = await probeClaudeCliCapabilities(executable, {
      verifyOfficialExecutable: async () => false
    });
    assert.equal(result.isolatedCredentialStorage, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
