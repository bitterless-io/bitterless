/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, test } from 'node:test';
import { build } from 'esbuild';

const projectRoot = resolve(dirname(new URL(import.meta.url).pathname), '..', '..');
const buildRoot = mkdtempSync(join(tmpdir(), 'bitterless-onlypreview-recent-directory-unit-'));
const bundlePath = join(buildRoot, 'runtime.mjs');

await build({
  entryPoints: [join(projectRoot, 'tests/onlypreview/runtime.entry.ts')],
  outfile: bundlePath,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: 'inline',
  tsconfig: join(projectRoot, 'tsconfig.node.json')
});

const runtime = await import(pathToFileURL(bundlePath).href);

after(() => rmSync(buildRoot, { recursive: true, force: true }));

const withTempDirectory = async (prefix, callback) => {
  const root = mkdtempSync(join(tmpdir(), prefix));
  try {
    return await callback(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

const write = (path, content = '') => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  return path;
};

class MemorySettingStorage {
  serializedValue = undefined;
  getCount = 0;
  insertCount = 0;
  compareAndSetCalls = [];
  failReads = false;
  conflictNextInsert = false;
  conflictNextCompareAndSet = false;

  constructor(value) {
    if (value !== undefined) this.serializedValue = JSON.stringify(value);
  }

  async getStored() {
    this.getCount += 1;
    if (this.failReads) throw new Error('/private/storage failure');
    if (this.serializedValue === undefined) {
      return { exists: false, valid: false, value: null, serializedValue: null };
    }
    try {
      return {
        exists: true,
        valid: true,
        value: JSON.parse(this.serializedValue),
        serializedValue: this.serializedValue
      };
    } catch {
      return {
        exists: true,
        valid: false,
        value: null,
        serializedValue: this.serializedValue
      };
    }
  }

  async insertIfAbsent(params) {
    this.insertCount += 1;
    if (this.conflictNextInsert) {
      this.conflictNextInsert = false;
      this.serializedValue = JSON.stringify({ version: 1, directoryPath: resolve('/tmp/conflict') });
      return false;
    }
    if (this.serializedValue !== undefined) return false;
    this.serializedValue = JSON.stringify(params.value);
    return true;
  }

  async compareAndSet(params) {
    this.compareAndSetCalls.push({ ...params });
    if (this.conflictNextCompareAndSet) {
      this.conflictNextCompareAndSet = false;
      this.serializedValue = JSON.stringify({ version: 1, directoryPath: resolve('/tmp/newer') });
      return false;
    }
    if (this.serializedValue !== params.expectedSerializedValue) return false;
    this.serializedValue = JSON.stringify(params.value);
    return true;
  }

  value() {
    return this.serializedValue === undefined ? undefined : JSON.parse(this.serializedValue);
  }
}

const createService = (storage) => {
  const hosts = new runtime.OnlyPreviewHostRegistry();
  const workspaces = new runtime.OnlyPreviewWorkspaceRegistry(hosts);
  const service = new runtime.OnlyPreviewRecentDirectoryService(hosts, workspaces, storage);
  return { hosts, workspaces, service };
};

const settle = async () => {
  for (let index = 0; index < 8; index += 1) {
    await new Promise((resolveWait) => setImmediate(resolveWait));
  }
};

test('recent-directory codec accepts only exact version-1 absolute directory candidates', () => {
  const directoryPath = resolve('/tmp/onlypreview-workspace');
  assert.equal(
    runtime.parseOnlyPreviewRecentDirectory({ version: 1, directoryPath }),
    directoryPath
  );
  for (const invalid of [
    null,
    {},
    { version: 2, directoryPath },
    { version: 1, directoryPath: 'relative' },
    { version: 1, directoryPath, selectedRelativePath: 'secret.txt' },
    { version: 1, directoryPath: `${directoryPath}\0suffix` }
  ]) {
    assert.equal(runtime.parseOnlyPreviewRecentDirectory(invalid), null);
  }
});

test('storage readiness gates restore while failure resolves the empty state', async () => {
  await withTempDirectory('onlypreview-recent-ready-', async (root) => {
    const canonicalRoot = realpathSync(root);
    const storage = new MemorySettingStorage({ version: 1, directoryPath: canonicalRoot });
    const readyRuntime = createService(storage);
    const host = readyRuntime.hosts.issue('standalone', 'content');
    let settled = false;
    const restore = readyRuntime.service.restoreWorkspace(host.hostToken).then((value) => {
      settled = true;
      return value;
    });
    await settle();
    assert.equal(settled, false);
    assert.equal(storage.getCount, 0);
    readyRuntime.service.markStorageReady();
    const workspace = await restore;
    assert.equal(workspace?.displayPath, canonicalRoot);
    assert.equal(workspace?.selectedRelativePath, undefined);

    const failedRuntime = createService(storage);
    const failedHost = failedRuntime.hosts.issue('standalone', 'content');
    const failedRestore = failedRuntime.service.restoreWorkspace(failedHost.hostToken);
    failedRuntime.service.markStorageFailed();
    assert.equal(await failedRestore, null);
  });
});

test('pre-ready explicit opens retain and flush only the latest canonical directory', async () => {
  await withTempDirectory('onlypreview-recent-latest-', async (root) => {
    const first = join(root, 'first');
    const second = join(root, 'second');
    mkdirSync(first);
    mkdirSync(second);
    const storage = new MemorySettingStorage();
    storage.conflictNextInsert = true;
    const { hosts, service } = createService(storage);
    const host = hosts.issue('standalone', 'content');

    const firstGeneration = service.beginExplicitTarget(host.hostToken);
    await service.openExplicitTarget(host.hostToken, first, firstGeneration);
    service.finishExplicitTarget(firstGeneration);
    const secondGeneration = service.beginExplicitTarget(host.hostToken);
    await service.openExplicitTarget(host.hostToken, second, secondGeneration);
    service.finishExplicitTarget(secondGeneration);
    assert.equal(storage.value(), undefined);

    service.markStorageReady();
    await settle();
    assert.deepEqual(storage.value(), { version: 1, directoryPath: realpathSync(second) });
    assert.equal(storage.insertCount, 1);
    assert.ok(storage.compareAndSetCalls.length >= 1);
  });
});

test('a stale explicit mutation cannot remain visible or overwrite the newer target', async () => {
  await withTempDirectory('onlypreview-recent-generation-', async (root) => {
    const first = join(root, 'first');
    const second = join(root, 'second');
    mkdirSync(first);
    mkdirSync(second);
    const storage = new MemorySettingStorage();
    const { hosts, workspaces, service } = createService(storage);
    const host = hosts.issue('standalone', 'content');
    const originalCreate = workspaces.createForTarget.bind(workspaces);
    let releaseFirst;
    const firstGate = new Promise((resolveGate) => {
      releaseFirst = resolveGate;
    });
    let firstCreated;
    const firstCreatedSignal = new Promise((resolveCreated) => {
      firstCreated = resolveCreated;
    });
    workspaces.createForTarget = async (...args) => {
      const workspace = await originalCreate(...args);
      if (args[1] === first) {
        firstCreated();
        await firstGate;
      }
      return workspace;
    };

    const firstGeneration = service.beginExplicitTarget(host.hostToken);
    const firstOpen = service.openExplicitTarget(host.hostToken, first, firstGeneration);
    await firstCreatedSignal;
    const secondGeneration = service.beginExplicitTarget(host.hostToken);
    const secondOpen = service.openExplicitTarget(host.hostToken, second, secondGeneration);
    releaseFirst();
    assert.equal(await firstOpen, null);
    service.finishExplicitTarget(firstGeneration);
    const secondWorkspace = await secondOpen;
    service.finishExplicitTarget(secondGeneration);
    assert.equal(secondWorkspace?.displayPath, realpathSync(second));
    assert.equal(workspaces.restore(host.hostToken)?.workspaceId, secondWorkspace?.workspaceId);

    service.markStorageReady();
    await settle();
    assert.deepEqual(storage.value(), {
      version: 1,
      directoryPath: realpathSync(second)
    });
  });
});

test('Shell and Preview restoration share one host flight and mint one fresh workspace', async () => {
  await withTempDirectory('onlypreview-recent-flight-', async (root) => {
    const storage = new MemorySettingStorage({ version: 1, directoryPath: root });
    const { hosts, workspaces, service } = createService(storage);
    const host = hosts.issue('standalone', 'content');
    const originalCreate = workspaces.createForTarget.bind(workspaces);
    let createCount = 0;
    workspaces.createForTarget = async (...args) => {
      createCount += 1;
      return await originalCreate(...args);
    };
    service.markStorageReady();

    const [shellWorkspace, previewWorkspace] = await Promise.all([
      service.restoreWorkspace(host.hostToken),
      service.restoreWorkspace(host.hostToken)
    ]);
    assert.equal(createCount, 1);
    assert.equal(shellWorkspace?.workspaceId, previewWorkspace?.workspaceId);
    assert.equal(shellWorkspace?.selectedRelativePath, undefined);
  });
});

test('a complete storage lifecycle restores a fresh directory capability and forgets selections', async () => {
  await withTempDirectory('onlypreview-recent-lifecycle-', async (root) => {
    const firstRoot = join(root, 'first');
    const secondFile = write(join(root, 'second', 'winner.txt'), 'winner');
    mkdirSync(firstRoot);
    const storage = new MemorySettingStorage();

    const firstRuntime = createService(storage);
    const firstHost = firstRuntime.hosts.issue('standalone', 'content');
    firstRuntime.service.markStorageReady();
    const firstGeneration = firstRuntime.service.beginExplicitTarget(firstHost.hostToken);
    const firstWorkspace = await firstRuntime.service.openExplicitTarget(
      firstHost.hostToken,
      firstRoot,
      firstGeneration
    );
    firstRuntime.service.finishExplicitTarget(firstGeneration);
    firstRuntime.workspaces.select(firstHost.hostToken, {
      workspaceId: firstWorkspace.workspaceId,
      relativePath: 'not-persisted.txt'
    });
    firstRuntime.hosts.clear();
    firstRuntime.service.clearTransientState();

    const restoredRuntime = createService(storage);
    const restoredHost = restoredRuntime.hosts.issue('standalone', 'content');
    restoredRuntime.service.markStorageReady();
    const restoredWorkspace = await restoredRuntime.service.restoreWorkspace(
      restoredHost.hostToken
    );
    assert.notEqual(restoredWorkspace?.workspaceId, firstWorkspace.workspaceId);
    assert.equal(restoredWorkspace?.displayPath, realpathSync(firstRoot));
    assert.equal(restoredWorkspace?.selectedRelativePath, undefined);

    const explicitGeneration = restoredRuntime.service.beginExplicitTarget(
      restoredHost.hostToken
    );
    const explicitWorkspace = await restoredRuntime.service.openExplicitTarget(
      restoredHost.hostToken,
      secondFile,
      explicitGeneration
    );
    restoredRuntime.service.finishExplicitTarget(explicitGeneration);
    assert.equal(explicitWorkspace?.selectedRelativePath, 'winner.txt');
    restoredRuntime.hosts.clear();
    restoredRuntime.service.clearTransientState();

    const finalRuntime = createService(storage);
    const finalHost = finalRuntime.hosts.issue('standalone', 'content');
    finalRuntime.service.markStorageReady();
    const finalWorkspace = await finalRuntime.service.restoreWorkspace(finalHost.hostToken);
    assert.notEqual(finalWorkspace?.workspaceId, explicitWorkspace?.workspaceId);
    assert.equal(finalWorkspace?.displayPath, realpathSync(dirname(secondFile)));
    assert.equal(finalWorkspace?.selectedRelativePath, undefined);
  });
});

test('invalid history CAS-clears only the exact observed value and preserves a concurrent replacement', async () => {
  const oldSerialized = '{"version":1,"directoryPath":"relative"}';
  const storage = new MemorySettingStorage();
  storage.serializedValue = oldSerialized;
  storage.conflictNextCompareAndSet = true;
  const { hosts, service } = createService(storage);
  const host = hosts.issue('standalone', 'content');
  service.markStorageReady();

  assert.equal(await service.restoreWorkspace(host.hostToken), null);
  assert.equal(storage.compareAndSetCalls.length, 1);
  assert.equal(storage.compareAndSetCalls[0].expectedSerializedValue, oldSerialized);
  assert.equal(storage.compareAndSetCalls[0].value, null);
  assert.deepEqual(storage.value(), {
    version: 1,
    directoryPath: resolve('/tmp/newer')
  });
});

test('host revoke clears a pending restore and explicit target wins a late history read', async () => {
  await withTempDirectory('onlypreview-recent-explicit-', async (root) => {
    const history = join(root, 'history');
    const explicit = write(join(root, 'explicit', 'chosen.txt'), 'chosen');
    mkdirSync(history);
    const storage = new MemorySettingStorage({
      version: 1,
      directoryPath: realpathSync(history)
    });
    const revokedRuntime = createService(storage);
    const revokedHost = revokedRuntime.hosts.issue('standalone', 'content');
    const revokedRestore = revokedRuntime.service.restoreWorkspace(revokedHost.hostToken);
    revokedRuntime.hosts.revoke(revokedHost.hostToken);
    revokedRuntime.service.markStorageReady();
    assert.equal(await revokedRestore, null);

    const currentRuntime = createService(storage);
    const host = currentRuntime.hosts.issue('standalone', 'content');
    const lateRestore = currentRuntime.service.restoreWorkspace(host.hostToken);
    const generation = currentRuntime.service.beginExplicitTarget(host.hostToken);
    const explicitWorkspace = await currentRuntime.service.openExplicitTarget(
      host.hostToken,
      explicit,
      generation
    );
    currentRuntime.service.markStorageReady();
    currentRuntime.service.finishExplicitTarget(generation);
    assert.equal(await lateRestore, null);
    assert.equal(explicitWorkspace?.displayPath, realpathSync(dirname(explicit)));
    assert.equal(explicitWorkspace?.selectedRelativePath, 'chosen.txt');
    assert.equal(
      currentRuntime.workspaces.restore(host.hostToken)?.workspaceId,
      explicitWorkspace?.workspaceId
    );
    await settle();
    assert.deepEqual(storage.value(), {
      version: 1,
      directoryPath: realpathSync(dirname(explicit))
    });
  });
});

test('host revoke during validation does not clear still-valid persisted history', async () => {
  await withTempDirectory('onlypreview-recent-revoke-', async (root) => {
    const canonicalRoot = realpathSync(root);
    const storage = new MemorySettingStorage({ version: 1, directoryPath: canonicalRoot });
    const { hosts, workspaces, service } = createService(storage);
    const host = hosts.issue('standalone', 'content');
    const originalCreate = workspaces.createForTarget.bind(workspaces);
    let releaseCreate;
    const createGate = new Promise((resolveGate) => {
      releaseCreate = resolveGate;
    });
    let enteredCreate;
    const enteredCreateSignal = new Promise((resolveEntered) => {
      enteredCreate = resolveEntered;
    });
    workspaces.createForTarget = async (...args) => {
      enteredCreate();
      await createGate;
      return await originalCreate(...args);
    };
    service.markStorageReady();
    const restore = service.restoreWorkspace(host.hostToken);
    await enteredCreateSignal;
    hosts.revoke(host.hostToken);
    releaseCreate();
    assert.equal(await restore, null);
    assert.equal(storage.compareAndSetCalls.length, 0);
    assert.deepEqual(storage.value(), { version: 1, directoryPath: canonicalRoot });
  });
});

test('storage failures never reject explicit opens or log private paths and error objects', async () => {
  await withTempDirectory('onlypreview-recent-private-', async (root) => {
    const target = write(join(root, 'private', 'file.txt'), 'private');
    const storage = new MemorySettingStorage();
    storage.failReads = true;
    const { hosts, service } = createService(storage);
    const host = hosts.issue('standalone', 'content');
    const captured = [];
    const originalWarn = console.warn;
    const originalError = console.error;
    console.warn = (...args) => captured.push(args);
    console.error = (...args) => captured.push(args);
    try {
      service.markStorageReady();
      const generation = service.beginExplicitTarget(host.hostToken);
      const workspace = await service.openExplicitTarget(host.hostToken, target, generation);
      service.finishExplicitTarget(generation);
      assert.equal(workspace?.selectedRelativePath, 'file.txt');
      await settle();
    } finally {
      console.warn = originalWarn;
      console.error = originalError;
    }
    assert.deepEqual(captured, []);
  });
});
