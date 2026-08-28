import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ClaudeAccountRepository } from '../../src/main/claudeSubscription/claudeAccount.repository';

const createRepository = async (available = true) => {
  const rootDirectory = await mkdtemp(path.join(os.tmpdir(), 'bitterless-claude-account-test-'));
  // Slots derive from the home directory, so tests inject a temporary one rather
  // than creating ~/.claude<N> on the machine running them.
  const homeDirectory = await mkdtemp(path.join(os.tmpdir(), 'bitterless-claude-home-test-'));
  let sequence = 1;
  const repository = new ClaudeAccountRepository({
    rootDirectory,
    homeDirectory,
    isolatedCredentialStorageAvailable: available,
    now: () => new Date('2026-08-24T08:00:00.000Z'),
    createId: () => `00000000-0000-4000-8000-${String(sequence++).padStart(12, '0')}`
  });
  await repository.initialize();
  return { repository, rootDirectory, homeDirectory };
};

const metadata = {
  email: 'ral@example.com',
  subscriptionType: 'max' as const
};

test('persists only registry v3 account metadata and exact slot paths', async () => {
  const { repository, rootDirectory, homeDirectory } = await createRepository();
  try {
    const identity = await repository.createIdentity();
    const account = await repository.saveAccount(identity, 'Personal Max', metadata);
    const registryPath = path.join(rootDirectory, 'accounts.json');
    const registryText = await readFile(registryPath, 'utf8');
    const registry = JSON.parse(registryText) as {
      version: number;
      accounts: Array<Record<string, unknown>>;
    };

    assert.equal((await stat(rootDirectory)).mode & 0o777, 0o700);
    assert.equal((await stat(registryPath)).mode & 0o777, 0o600);
    assert.equal((await stat(identity.configDirectory)).mode & 0o777, 0o700);
    assert.equal((await stat(identity.anthropicConfigDirectory)).mode & 0o777, 0o700);
    // Slots start at 2: ~/.claude is the interactive CLI's directory and is never
    // poolable. See docs/features/claude-subscription-account-slots.md.
    assert.equal(identity.slot, 2);
    assert.equal(identity.configDirectory, path.join(homeDirectory, '.claude2'));
    assert.equal(identity.secureStorageConfigDirectory, identity.configDirectory);
    assert.equal(
      identity.anthropicConfigDirectory,
      path.join(identity.configDirectory, 'anthropic')
    );
    assert.equal(registry.version, 3);
    assert.equal(registry.accounts[0]?.slot, 2);
    assert.equal(registry.accounts[0]?.subscriptionType, 'max');
    assert.equal(registry.accounts[0]?.email, 'ral@example.com');
    assert.doesNotMatch(registryText, /encryptedToken|oauthToken|refreshToken|sk-ant-oat/iu);
    assert.deepEqual(account, {
      id: identity.id,
      label: 'Personal Max',
      email: 'ral@example.com',
      subscriptionType: 'max',
      enabled: true,
      status: 'usable',
      activeRequests: 0,
      createdAt: '2026-08-24T08:00:00.000Z',
      updatedAt: '2026-08-24T08:00:00.000Z'
    });

    assert.deepEqual(await repository.getExecutionContext(identity.id), {
      configDirectory: identity.configDirectory,
      secureStorageConfigDirectory: identity.secureStorageConfigDirectory,
      anthropicConfigDirectory: identity.anthropicConfigDirectory
    });
  } finally {
    await rm(rootDirectory, { recursive: true, force: true });
  }
});

test('isolated storage capability gates saving and routing without a fallback', async () => {
  const { repository, rootDirectory } = await createRepository(false);
  try {
    const identity = await repository.createIdentity();
    await assert.rejects(repository.saveAccount(identity, 'Unavailable', metadata), /unavailable/u);
    assert.equal(repository.isolatedCredentialStorageAvailable(), false);
    assert.deepEqual(await repository.listAccounts(), []);
    assert.equal(await repository.getExecutionContext(identity.id), null);
  } finally {
    await rm(rootDirectory, { recursive: true, force: true });
  }
});

test('returns metadata-only status while tracking runtime readiness', async () => {
  const { repository, rootDirectory } = await createRepository();
  try {
    const identity = await repository.createIdentity();
    await repository.saveAccount(identity, 'Spare', {
      subscriptionType: 'team'
    });
    await repository.setEnabled(identity.id, false);
    repository.markCooldown(identity.id, Date.parse('2026-08-24T09:00:00.000Z'));
    repository.markNeedsLogin(identity.id);
    const [routing] = await repository.listRoutingAccounts();
    const [view] = await repository.listAccounts();

    assert.equal(routing?.enabled, false);
    assert.equal(routing?.needsLogin, true);
    assert.equal(view?.status, 'disabled');
    assert.equal(view?.subscriptionType, 'team');
    assert.doesNotMatch(
      JSON.stringify({ routing, view }),
      /configDirectory|partition|oauthToken|credential/iu
    );
  } finally {
    await rm(rootDirectory, { recursive: true, force: true });
  }
});

test('rejects forged and symlinked account profile paths', async () => {
  const { repository, rootDirectory } = await createRepository();
  const outside = await mkdtemp(path.join(os.tmpdir(), 'bitterless-claude-outside-'));
  try {
    const identity = await repository.createIdentity();
    await assert.rejects(
      repository.saveAccount({ ...identity, configDirectory: outside }, 'Forged', metadata),
      /managed account root/u
    );

    await rm(identity.configDirectory, { recursive: true, force: true });
    await symlink(outside, identity.configDirectory, 'dir');
    await assert.rejects(
      repository.saveAccount(identity, 'Symlink', metadata),
      /plain directory/u
    );
    assert.deepEqual(await repository.listAccounts(), []);
  } finally {
    await rm(rootDirectory, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test('fails closed on legacy token-bearing registries without reading credentials', async () => {
  const rootDirectory = await mkdtemp(path.join(os.tmpdir(), 'bitterless-claude-load-test-'));
  try {
    await mkdir(path.join(rootDirectory, 'accounts'), { mode: 0o700 });
    await writeFile(
      path.join(rootDirectory, 'accounts.json'),
      JSON.stringify({
        version: 1,
        accounts: [{ encryptedToken: 'must-not-be-read' }]
      }),
      { mode: 0o600 }
    );
    const repository = new ClaudeAccountRepository({
      rootDirectory,
      // Slots live under the home directory and removal deletes them, so tests
      // must never resolve a real one.
      homeDirectory: path.join(rootDirectory, 'home'),
      isolatedCredentialStorageAvailable: true
    });
    await assert.rejects(repository.initialize(), /Unsupported Claude subscription account registry/u);
  } finally {
    await rm(rootDirectory, { recursive: true, force: true });
  }
});
