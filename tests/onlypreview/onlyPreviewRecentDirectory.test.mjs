/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
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
  tsconfig: join(projectRoot, 'tsconfig.node.json'),
  alias: { electron: join(projectRoot, 'tests/onlypreview/fixtures/electron.stub.mjs') }
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
      this.serializedValue = JSON.stringify({
        version: 1,
        directoryPath: resolve('/tmp/conflict')
      });
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

/**
 * 按 `sub_key` 分开的存储。
 *
 * 上面那个 `MemorySettingStorage` 所有子键共用一个值 —— 对只读「上次目录」的用例够用,但读不到
 * 「上次那个文件」(它在另一个子键上,而 `parseOnlyPreviewRecentFile` 要求三个键,拿到目录记录会
 * 直接判无效)。呈现那一支必须有真的文件记录才走得到,所以单开一个。
 */
class SubKeyedSettingStorage {
  constructor(values) {
    this.values = new Map(Object.entries(values).map(([key, value]) => [key, JSON.stringify(value)]));
  }

  async getStored(params) {
    const serializedValue = this.values.get(params.sub_key);
    if (serializedValue === undefined) {
      return { exists: false, valid: false, value: null, serializedValue: null };
    }
    return { exists: true, valid: true, value: JSON.parse(serializedValue), serializedValue };
  }

  async insertIfAbsent(params) {
    if (this.values.has(params.sub_key)) return false;
    this.values.set(params.sub_key, JSON.stringify(params.value));
    return true;
  }

  async compareAndSet(params) {
    if (this.values.get(params.sub_key) !== params.expectedSerializedValue) return false;
    this.values.set(params.sub_key, JSON.stringify(params.value));
    return true;
  }
}

const createService = (storage) => {
  const hosts = new runtime.OnlyPreviewHostRegistry();
  const workspaces = new runtime.OnlyPreviewWorkspaceRegistry(hosts);
  const authority = new runtime.FileSearchProjectAuthority();
  const runtimeInstanceId = '123e4567-e89b-42d3-a456-426614174000';
  const presented = [];
  const service = new runtime.OnlyPreviewRecentDirectoryService(
    hosts,
    workspaces,
    storage,
    runtime.inspectOnlyPreviewProjectTarget,
    async (hostToken, workspace) => {
      const binding = await authority.bindWorkspace(
        runtimeInstanceId,
        workspace.workspaceId,
        workspace.displayPath
      );
      workspaces.bindProjectAuthority(
        hostToken,
        workspace.workspaceId,
        binding.workspaceGeneration
      );
    }
  );
  // `presentSelection` 只能经 `configureTargetRuntime` 注入,而构造器已经吃掉了 inspect/bind ——
  // 那个方法对重复配置会抛,所以这里直接写私有字段。测试要观察的正是"它有没有被调"。
  service.presentSelection = async (hostToken, workspace) => {
    presented.push({ hostToken, relativePath: workspace.selectedRelativePath });
  };
  return { hosts, workspaces, service, presented };
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

test('explicit open resolves while a ready storage read remains deferred', async () => {
  await withTempDirectory('onlypreview-recent-deferred-', async (root) => {
    const storage = new MemorySettingStorage();
    const originalGetStored = storage.getStored.bind(storage);
    let signalReadStarted;
    const readStarted = new Promise((resolveStarted) => {
      signalReadStarted = resolveStarted;
    });
    let releaseRead;
    const readGate = new Promise((resolveRead) => {
      releaseRead = resolveRead;
    });
    storage.getStored = async () => {
      signalReadStarted?.();
      signalReadStarted = null;
      await readGate;
      return await originalGetStored();
    };
    const { hosts, workspaces, service } = createService(storage);
    const host = hosts.issue('standalone', 'content');
    service.markStorageReady();
    const generation = service.beginExplicitTarget(host.hostToken);
    let openSettled = false;
    const opening = service
      .openExplicitTarget(host.hostToken, root, generation)
      .then((workspace) => {
        openSettled = true;
        return workspace;
      });

    await readStarted;
    await settle();
    const settledBeforeStorage = openSettled;
    releaseRead();
    const workspace = await opening;
    service.finishExplicitTarget(generation);

    assert.equal(settledBeforeStorage, true);
    assert.equal(workspace?.displayPath, realpathSync(root));
    assert.equal(workspaces.restore(host.hostToken)?.workspaceId, workspace?.workspaceId);
    await settle();
  });
});

test('a validated workspace stays unrestorable until every runtime binding is ready', async () => {
  await withTempDirectory('onlypreview-recent-atomic-bind-', async (root) => {
    const hosts = new runtime.OnlyPreviewHostRegistry();
    const workspaces = new runtime.OnlyPreviewWorkspaceRegistry(hosts);
    let releaseBinding;
    const bindingGate = new Promise((resolveBinding) => {
      releaseBinding = resolveBinding;
    });
    let signalBindingStarted;
    const bindingStarted = new Promise((resolveStarted) => {
      signalBindingStarted = resolveStarted;
    });
    const service = new runtime.OnlyPreviewRecentDirectoryService(
      hosts,
      workspaces,
      new MemorySettingStorage(),
      runtime.inspectOnlyPreviewProjectTarget,
      async (hostToken, workspace) => {
        signalBindingStarted?.();
        signalBindingStarted = null;
        await bindingGate;
        workspaces.bindProjectAuthority(hostToken, workspace.workspaceId, 17);
      }
    );
    const host = hosts.issue('standalone', 'content');
    const generation = service.beginExplicitTarget(host.hostToken);
    const opening = service.openExplicitTarget(host.hostToken, root, generation);

    await bindingStarted;
    assert.equal(workspaces.restore(host.hostToken), null);

    releaseBinding();
    const workspace = await opening;
    assert.equal(workspaces.restore(host.hostToken)?.workspaceId, workspace?.workspaceId);
  });
});

test('a failed runtime binding revokes the pending Main workspace', async () => {
  await withTempDirectory('onlypreview-recent-failed-bind-', async (root) => {
    const hosts = new runtime.OnlyPreviewHostRegistry();
    const workspaces = new runtime.OnlyPreviewWorkspaceRegistry(hosts);
    let pendingWorkspaceId = '';
    const service = new runtime.OnlyPreviewRecentDirectoryService(
      hosts,
      workspaces,
      new MemorySettingStorage(),
      runtime.inspectOnlyPreviewProjectTarget,
      async (_hostToken, workspace) => {
        pendingWorkspaceId = workspace.workspaceId;
        throw new Error('Office bind rejected');
      }
    );
    const host = hosts.issue('standalone', 'content');
    const generation = service.beginExplicitTarget(host.hostToken);

    await assert.rejects(() => service.openExplicitTarget(host.hostToken, root, generation));
    assert.equal(workspaces.restore(host.hostToken), null);
    assert.throws(
      () => workspaces.requireWorkspace(host.hostToken, pendingWorkspaceId),
      (error) => error?.code === 'WORKSPACE_NOT_FOUND'
    );
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

test('ordinary host revoke preserves pending history while teardown fences and clears it', async () => {
  await withTempDirectory('onlypreview-recent-clear-', async (root) => {
    const preservedStorage = new MemorySettingStorage();
    const preservedRuntime = createService(preservedStorage);
    const preservedHost = preservedRuntime.hosts.issue('standalone', 'content');
    const preservedGeneration = preservedRuntime.service.beginExplicitTarget(
      preservedHost.hostToken
    );
    await preservedRuntime.service.openExplicitTarget(
      preservedHost.hostToken,
      root,
      preservedGeneration
    );
    preservedRuntime.service.finishExplicitTarget(preservedGeneration);
    preservedRuntime.hosts.revoke(preservedHost.hostToken);
    preservedRuntime.service.markStorageReady();
    await settle();
    assert.deepEqual(preservedStorage.value(), {
      version: 1,
      directoryPath: realpathSync(root)
    });

    const clearedStorage = new MemorySettingStorage();
    const clearedRuntime = createService(clearedStorage);
    const clearedHost = clearedRuntime.hosts.issue('standalone', 'content');
    const clearedGeneration = clearedRuntime.service.beginExplicitTarget(clearedHost.hostToken);
    await clearedRuntime.service.openExplicitTarget(clearedHost.hostToken, root, clearedGeneration);
    clearedRuntime.service.finishExplicitTarget(clearedGeneration);
    clearedRuntime.hosts.revoke(clearedHost.hostToken);
    clearedRuntime.service.clearTransientState();
    clearedRuntime.service.markStorageReady();
    await settle();
    assert.equal(clearedStorage.value(), undefined);
    assert.equal(clearedStorage.getCount, 0);
    assert.equal(clearedStorage.insertCount, 0);
    assert.equal(clearedStorage.compareAndSetCalls.length, 0);
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
    const originalInspect = service.inspectTarget;
    let releaseFirst;
    const firstGate = new Promise((resolveGate) => {
      releaseFirst = resolveGate;
    });
    let firstCreated;
    const firstCreatedSignal = new Promise((resolveCreated) => {
      firstCreated = resolveCreated;
    });
    service.inspectTarget = async (target) => {
      const inspected = await originalInspect(target);
      if (target === first) {
        firstCreated();
        await firstGate;
      }
      return inspected;
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
    const { hosts, service } = createService(storage);
    const host = hosts.issue('standalone', 'content');
    const originalInspect = service.inspectTarget;
    let createCount = 0;
    service.inspectTarget = async (...args) => {
      createCount += 1;
      return await originalInspect(...args);
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
    await settle();
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

    const explicitGeneration = restoredRuntime.service.beginExplicitTarget(restoredHost.hostToken);
    const explicitWorkspace = await restoredRuntime.service.openExplicitTarget(
      restoredHost.hostToken,
      secondFile,
      explicitGeneration
    );
    restoredRuntime.service.finishExplicitTarget(explicitGeneration);
    assert.equal(explicitWorkspace?.selectedRelativePath, 'winner.txt');
    await settle();
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
  await settle();
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
    const { hosts, service } = createService(storage);
    const host = hosts.issue('standalone', 'content');
    const originalInspect = service.inspectTarget;
    let releaseCreate;
    const createGate = new Promise((resolveGate) => {
      releaseCreate = resolveGate;
    });
    let enteredCreate;
    const enteredCreateSignal = new Promise((resolveEntered) => {
      enteredCreate = resolveEntered;
    });
    service.inspectTarget = async (...args) => {
      enteredCreate();
      await createGate;
      return await originalInspect(...args);
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

test('the remembered file record is strict and is scoped to its own Project directory', () => {
  const directoryPath = process.platform === 'win32' ? 'C:\\projects\\overmind' : '/projects/overmind';
  assert.deepEqual(
    runtime.parseOnlyPreviewRecentFile({ version: 1, directoryPath, relativePath: 'docs/plan.md' }),
    { directoryPath, relativePath: 'docs/plan.md' }
  );
  for (const invalid of [
    null,
    undefined,
    'docs/plan.md',
    [],
    // The directory is part of the record precisely so a stale selection cannot be applied to a
    // different Project; a record without it is unusable, not merely incomplete.
    { version: 1, relativePath: 'docs/plan.md' },
    { version: 1, directoryPath },
    { version: 2, directoryPath, relativePath: 'docs/plan.md' },
    { version: 1, directoryPath, relativePath: '' },
    { version: 1, directoryPath: 'relative/path', relativePath: 'docs/plan.md' },
    { version: 1, directoryPath, relativePath: 'docs/pl\u0000an.md' },
    { version: 1, directoryPath: `${directoryPath}\u0000`, relativePath: 'docs/plan.md' },
    // An extra key means the record was written by something other than this service.
    { version: 1, directoryPath, relativePath: 'docs/plan.md', extra: true }
  ]) {
    assert.equal(
      runtime.parseOnlyPreviewRecentFile(invalid),
      null,
      `${JSON.stringify(invalid)} must be refused`
    );
  }
});

/**
 * 「别恢复上次目录」那道闸门必须只对**会自己绑项目**的 explicit 目标成立。
 *
 * 一个 explicit **文件** 目标根本不碰 `projectWorkspaceByHost`(外部预览住在另一个 map),却同样
 * 把恢复挡掉了 —— 于是在新窗口里 shell 挂载时问到 `null`,顶栏落成「No project open」,而文件那支
 * 结束时广播的是 `SELECTION_CHANGED` 不是 `WORKSPACE_CHANGED`,shell 再也不会问第二次。
 * `docs/issues/onlypreview-external-file-open-drops-the-project.md`
 *
 * 注:抑制在服务里写了**两处** —— `restoreWorkspace` 开头的快路径,与 `canRestore` 里的那一条。
 * 实测(变异)只拆快路径**行为不变**(`canRestore` 仍在挡),两处都拆才会让下面第一条断言变红。
 * 所以这条断言钉的是行为,不是某一行;别把快路径当成"没被测到"而删掉。
 */
test('an explicit FILE target must not suppress restoring the last project', async () => {
  await withTempDirectory('onlypreview-recent-claim-', async (root) => {
    const canonicalRoot = realpathSync(root);
    const storage = new MemorySettingStorage({ version: 1, directoryPath: canonicalRoot });
    const { hosts, service } = createService(storage);
    service.markStorageReady();
    const host = hosts.issue('standalone', 'content');

    // 闸门占着时:恢复被抑制 —— 这是**目录**目标要的行为,先钉住它还在
    const generation = service.beginExplicitTarget();
    assert.equal(await service.restoreWorkspace(host.hostToken), null);
    assert.equal(storage.getCount, 0, '被抑制时不该去读存储');

    // 文件目标放开闸门之后:上次的项目必须恢复得出来
    service.releaseProjectRestoreClaim(generation);
    const workspace = await service.restoreWorkspace(host.hostToken);
    assert.equal(workspace?.displayPath, canonicalRoot);
  });
});

test('releasing with a stale generation must not steal a newer claim', async () => {
  await withTempDirectory('onlypreview-recent-claim-stale-', async (root) => {
    const canonicalRoot = realpathSync(root);
    const storage = new MemorySettingStorage({ version: 1, directoryPath: canonicalRoot });
    const { hosts, service } = createService(storage);
    service.markStorageReady();
    const host = hosts.issue('standalone', 'content');

    const first = service.beginExplicitTarget();
    const second = service.beginExplicitTarget();
    // 旧 generation 来放闸门 —— 不许生效,否则后来那个目录打开会被恢复抢在前面
    service.releaseProjectRestoreClaim(first);
    assert.equal(await service.restoreWorkspace(host.hostToken), null);

    service.releaseProjectRestoreClaim(second);
    assert.equal((await service.restoreWorkspace(host.hostToken))?.displayPath, canonicalRoot);
  });
});

/** explicit-open 那一侧的接线 —— 三条都是「不这么写就静默退化」的地方。 */
test('the explicit FILE branch releases the claim and re-asks for the project', () => {
  const source = readFileSync(
    resolve(projectRoot, 'src/main/miniapps/onlypreview/onlyPreviewExplicitOpen.service.ts'),
    'utf8'
  );
  const fileBranch = source.slice(source.indexOf('onlyPreviewRecentDirectoryService.releaseProjectRestoreClaim(recentGeneration)'));
  assert.match(
    fileBranch,
    /releaseProjectRestoreClaim\(recentGeneration\)/,
    '文件那支没有放开闸门 —— 新窗口里会是 No project open'
  );
  // Workspace authority settles before selection; a restored file cannot replace the explicit target.
  assert.ok(fileBranch.indexOf('const workspace = await onlyPreviewRecentDirectoryService') < fileBranch.indexOf('const accepted = await presentOnlyPreviewExplicitFile'));
  assert.ok(fileBranch.indexOf('.restoreWorkspace(') < fileBranch.indexOf('await recordOnlyPreviewRecentFile('));
  assert.match(fileBranch, /if \(workspace && onlyPreviewHostRegistry\.isLive\(host\.hostToken\)\) \{[\s\S]{0,120}broadcast\(ONLY_PREVIEW_WORKSPACE_CHANGED_EVENT/);
});

/**
 * 恢复项目时**要不要顺手呈现那个项目记住的文件**。
 *
 * 启动恢复要(那正是「下次打开还在上次那个文件」);而「刚显式打开了一个项目外的文件、只是想让项目
 * 回到树里」那条路**不要** —— 呈现会把刚呈现的外部文件静默换掉,表现是「第一次打开没反应,第二次
 * 才行」(`docs/issues/onlypreview-first-external-open-is-replaced-by-the-restored-project.md`)。
 *
 * 这一条只能在服务层测:界面上的表现是"看起来没打开",而那正是它一直没被任何断言抓到的原因。
 */
test('restoring a project presents its remembered file by default, and not when asked not to', async () => {
  await withTempDirectory('onlypreview-restore-present-', async (root) => {
    const canonicalRoot = realpathSync(root);
    write(join(canonicalRoot, 'notes.md'), 'hello');

    // ① 缺省:呈现
    {
      const storage = new SubKeyedSettingStorage({
        last_directory: { version: 1, directoryPath: canonicalRoot },
        last_file: { version: 1, directoryPath: canonicalRoot, relativePath: 'notes.md' }
      });
      const { hosts, service, presented } = createService(storage);
      service.markStorageReady();
      const host = hosts.issue('standalone', 'content');
      const workspace = await service.restoreWorkspace(host.hostToken);
      assert.equal(workspace?.selectedRelativePath, 'notes.md');
      assert.deepEqual(
        presented.map((entry) => entry.relativePath),
        ['notes.md'],
        '启动恢复必须呈现那个记住的文件 —— 少了它「下次打开还在上次那个文件」就没了'
      );
    }

    // ② 明确不呈现:仍然把 selectedRelativePath 带回去(树里照样高亮),但预览区不动
    {
      const storage = new SubKeyedSettingStorage({
        last_directory: { version: 1, directoryPath: canonicalRoot },
        last_file: { version: 1, directoryPath: canonicalRoot, relativePath: 'notes.md' }
      });
      const { hosts, service, presented } = createService(storage);
      service.markStorageReady();
      const host = hosts.issue('standalone', 'content');
      const workspace = await service.restoreWorkspace(host.hostToken, {
        presentRestoredSelection: false
      });
      assert.equal(
        workspace?.selectedRelativePath,
        'notes.md',
        '不呈现 ≠ 不告诉调用方 —— 树里那一项照样要高亮'
      );
      assert.deepEqual(presented, [], '这一支呈现了任何东西 = 刚打开的外部文件被换掉');
    }
  });
});

/** 显式文件那一支必须用「不呈现」那个入口 —— 用错就是这条 issue 的成因。 */
test('the explicit FILE branch restores the project without presenting its remembered file', () => {
  const source = readFileSync(
    resolve(projectRoot, 'src/main/miniapps/onlypreview/onlyPreviewExplicitOpen.service.ts'),
    'utf8'
  );
  assert.match(
    source,
    /restoreWorkspace\(host\.hostToken, \{ presentRestoredSelection: false \}\)/,
    '缺了这个参数,恢复会把刚呈现的外部文件换掉'
  );
});

const openProjectAfterClear = async (service, hostToken, target) => {
  const generation = service.beginExplicitTarget(hostToken);
  try {
    return await service.openExplicitTarget(hostToken, target, generation);
  } finally {
    service.finishExplicitTarget(generation);
  }
};

const clearRaceGate = () => {
  let entered;
  let release;
  const started = new Promise((resolveStarted) => { entered = resolveStarted; });
  const wait = new Promise((resolveWait) => { release = resolveWait; });
  return { entered, release, started, wait };
};

test('clearing a Project preserves its host, external preview, and remembered file', async () => {
  await withTempDirectory('onlypreview-clear-project-', async (root) => {
    const project = realpathSync(root);
    const file = write(join(project, 'notes.md'), 'notes');
    const lastFile = { version: 1, directoryPath: project, relativePath: 'notes.md' };
    const storage = new SubKeyedSettingStorage({ last_file: lastFile });
    const { hosts, workspaces, service } = createService(storage);
    const host = hosts.issue('standalone', 'content');
    service.markStorageReady();
    const workspace = await openProjectAfterClear(service, host.hostToken, project);
    const external = workspaces.registerExternalPreview(
      host.hostToken, await runtime.inspectOnlyPreviewProjectTarget(file)
    );

    await service.clearWorkspace(host.hostToken);
    await service.clearWorkspace(host.hostToken);
    assert.equal(hosts.isLive(host.hostToken), true);
    assert.equal(workspaces.restore(host.hostToken), null);
    assert.equal(await service.restoreWorkspace(host.hostToken), null);
    assert.throws(() => workspaces.requireWorkspace(host.hostToken, workspace.workspaceId));
    assert.equal(workspaces.isExternalPreviewFileRef(host.hostToken, external), true);
    assert.equal(JSON.parse(storage.values.get('last_directory')), null);
    assert.deepEqual(JSON.parse(storage.values.get('last_file')), lastFile);

    const restarted = createService(storage);
    restarted.service.markStorageReady();
    const nextHost = restarted.hosts.issue('standalone', 'content');
    assert.equal(await restarted.service.restoreWorkspace(nextHost.hostToken), null);
  });
});

test('clearing before storage readiness survives a subsequent external-file intent', async () => {
  await withTempDirectory('onlypreview-clear-pre-ready-', async (root) => {
    const storage = new MemorySettingStorage({ version: 1, directoryPath: realpathSync(root) });
    const { hosts, service } = createService(storage);
    const host = hosts.issue('standalone', 'content');
    const restoring = service.restoreWorkspace(host.hostToken);
    await openProjectAfterClear(service, host.hostToken, root);
    await service.clearWorkspace(host.hostToken);
    assert.equal(await service.restoreWorkspace(host.hostToken), null);
    const externalGeneration = service.beginExplicitTarget(host.hostToken);
    service.releaseProjectRestoreClaim(externalGeneration);
    service.finishExplicitTarget(externalGeneration);

    service.markStorageReady();
    await service.flushPendingWrites();
    assert.equal(await restoring, null);
    assert.equal(storage.value(), null);
    assert.equal(await service.restoreWorkspace(host.hostToken), null);
  });
});

test('a history read captured before clear cannot restore the cleared Project', async () => {
  await withTempDirectory('onlypreview-clear-history-read-', async (root) => {
    const storage = new MemorySettingStorage({ version: 1, directoryPath: realpathSync(root) });
    const { hosts, workspaces, service } = createService(storage);
    const host = hosts.issue('standalone', 'content');
    const gate = clearRaceGate();
    const getStored = storage.getStored.bind(storage);
    let pause = true;
    storage.getStored = async (...args) => {
      const value = await getStored(...args);
      if (pause) {
        pause = false;
        gate.entered();
        await gate.wait;
      }
      return value;
    };
    service.markStorageReady();
    const restoring = service.restoreWorkspace(host.hostToken);
    await gate.started;
    await service.clearWorkspace(host.hostToken);
    gate.release();
    assert.equal(await restoring, null);
    assert.equal(workspaces.restore(host.hostToken), null);
    assert.equal(storage.value(), null);
  });
});

for (const source of ['restore', 'explicit']) {
  test(`clear fences and drains an in-flight ${source} binding`, async () => {
    await withTempDirectory(`onlypreview-clear-${source}-bind-`, async (root) => {
      const storage = new MemorySettingStorage({ version: 1, directoryPath: realpathSync(root) });
      const { hosts, workspaces, service, presented } = createService(storage);
      const host = hosts.issue('standalone', 'content');
      const gate = clearRaceGate();
      const bindWorkspace = service.bindWorkspace;
      let oldWorkspaceId;
      service.bindWorkspace = async (...args) => {
        await bindWorkspace(...args);
        oldWorkspaceId = args[1].workspaceId;
        gate.entered();
        await gate.wait;
      };
      service.markStorageReady();
      const opening = source === 'restore'
        ? service.restoreWorkspace(host.hostToken)
        : openProjectAfterClear(service, host.hostToken, root);
      await gate.started;
      let cleared = false;
      const clearing = service.clearWorkspace(host.hostToken).then(() => { cleared = true; });
      assert.equal(await service.restoreWorkspace(host.hostToken), null);
      assert.equal(cleared, false, 'clear must drain the old binding before completing');
      gate.release();
      assert.equal(await opening, null);
      await clearing;
      assert.equal(workspaces.restore(host.hostToken), null);
      assert.throws(() => workspaces.requireWorkspace(host.hostToken, oldWorkspaceId));
      assert.deepEqual(presented, []);
      assert.equal(storage.value(), null);
    });
  });
}

test('clear is persisted after an older directory write already in flight', async () => {
  await withTempDirectory('onlypreview-clear-old-write-', async (root) => {
    const storage = new MemorySettingStorage({ version: 1, directoryPath: realpathSync(root) });
    const { hosts, service } = createService(storage);
    const host = hosts.issue('standalone', 'content');
    const gate = clearRaceGate();
    const compareAndSet = storage.compareAndSet.bind(storage);
    let pause = true;
    storage.compareAndSet = async (params) => {
      if (pause) {
        pause = false;
        gate.entered();
        await gate.wait;
      }
      return await compareAndSet(params);
    };
    service.markStorageReady();
    await openProjectAfterClear(service, host.hostToken, root);
    await gate.started;
    const clearing = service.clearWorkspace(host.hostToken);
    gate.release();
    await clearing;
    assert.equal(storage.value(), null);
    assert.equal(storage.compareAndSetCalls.at(-1).value, null);
    assert.equal(await service.restoreWorkspace(host.hostToken), null);
  });
});

test('failed clear persistence cannot revive history, and successful rebind remembers a fresh Project', async () => {
  await withTempDirectory('onlypreview-clear-rebind-', async (root) => {
    const first = realpathSync(root);
    const second = join(first, 'second');
    mkdirSync(second);
    const storage = new MemorySettingStorage({ version: 1, directoryPath: first });
    const { hosts, workspaces, service } = createService(storage);
    const host = hosts.issue('standalone', 'content');
    service.markStorageReady();
    const before = await openProjectAfterClear(service, host.hostToken, first);
    await service.flushPendingWrites();
    storage.failReads = true;
    await service.clearWorkspace(host.hostToken);
    storage.failReads = false;
    assert.deepEqual(storage.value(), { version: 1, directoryPath: first });
    assert.equal(await service.restoreWorkspace(host.hostToken), null);
    await assert.rejects(() => openProjectAfterClear(service, host.hostToken, join(first, 'missing')));
    assert.equal(await service.restoreWorkspace(host.hostToken), null);

    const same = await openProjectAfterClear(service, host.hostToken, first);
    assert.notEqual(same.workspaceId, before.workspaceId);
    assert.equal((await service.restoreWorkspace(host.hostToken)).workspaceId, same.workspaceId);
    await service.clearWorkspace(host.hostToken);
    const different = await openProjectAfterClear(service, host.hostToken, second);
    assert.notEqual(different.workspaceId, same.workspaceId);
    assert.equal(workspaces.restore(host.hostToken).workspaceId, different.workspaceId);
    await service.flushPendingWrites();
    assert.deepEqual(storage.value(), { version: 1, directoryPath: second });
    const restarted = createService(storage);
    restarted.service.markStorageReady();
    const nextHost = restarted.hosts.issue('standalone', 'content');
    const restored = await restarted.service.restoreWorkspace(nextHost.hostToken);
    assert.equal(restored.displayPath, second);
    assert.notEqual(restored.workspaceId, different.workspaceId);
  });
});

test('unselected restores work without persisting a choice; choosing that same path removes default state', async () => {
  await withTempDirectory('onlypreview-default-work-', async root => {
    const work = realpathSync(root);
    const storage = new MemorySettingStorage();
    const { hosts, workspaces, service } = createService(storage);
    service.defaultWorkspace = () => work;
    service.markStorageReady();
    const host = hosts.issue('standalone', 'content');
    const initial = await service.restoreWorkspace(host.hostToken);
    assert.equal(initial.displayPath, work);
    assert.equal(initial.isDefault, true);
    assert.equal(storage.value(), undefined, 'automatic fallback must not become an explicit choice');
    const generation = service.beginExplicitTarget(host.hostToken);
    const chosen = await service.openExplicitTarget(host.hostToken, work, generation);
    service.finishExplicitTarget(generation);
    await service.flushPendingWrites();
    assert.equal(chosen.isDefault, undefined);
    assert.notEqual(chosen.workspaceId, initial.workspaceId, 'new identity fences old indexes');
    assert.equal(storage.value().directoryPath, work);
    await service.clearWorkspace(host.hostToken);
    const cleared = await service.restoreWorkspace(host.hostToken);
    assert.equal(cleared.isDefault, true);
    assert.equal(storage.value(), null);
    assert.equal(workspaces.restore(host.hostToken).workspaceId, cleared.workspaceId);
  });
});

test('remembered explicit workspace wins over work; missing remembered directory falls back to work', async () => {
  await withTempDirectory('onlypreview-default-restore-', async root => {
    const work = realpathSync(root);
    for (const selected of [work, join(work, 'missing')]) {
      const storage = new MemorySettingStorage({ version: 1, directoryPath: selected });
      const { hosts, service } = createService(storage);
      service.defaultWorkspace = () => work;
      service.markStorageReady();
      const host = hosts.issue('standalone', 'content');
      const restored = await service.restoreWorkspace(host.hostToken);
      assert.equal(restored.displayPath, work);
      assert.equal(restored.isDefault, selected === work ? undefined : true);
    }
  });
});

test('a rejected new binding restores the previous default selection', async () => {
  await withTempDirectory('onlypreview-default-failure-', async root => {
    const work = realpathSync(root);
    const other = join(work, 'other'); mkdirSync(other);
    const { hosts, workspaces, service } = createService(new MemorySettingStorage());
    service.defaultWorkspace = () => work;
    service.markStorageReady();
    const host = hosts.issue('standalone', 'content');
    await service.restoreWorkspace(host.hostToken);
    const bind = service.bindWorkspace;
    service.bindWorkspace = (token, workspace) => workspace.displayPath === other
      ? Promise.reject(new Error('cannot bind selected folder')) : bind(token, workspace);
    const generation = service.beginExplicitTarget(host.hostToken);
    await assert.rejects(service.openExplicitTarget(host.hostToken, other, generation), /cannot bind/);
    service.finishExplicitTarget(generation);
    assert.equal(workspaces.restore(host.hostToken).displayPath, work);
    assert.equal(workspaces.restore(host.hostToken).isDefault, true);
  });
});

test('storage unavailable still opens work without remembering it as a choice', async () => {
  await withTempDirectory('onlypreview-work-storage-', async root => {
    const { hosts, service } = createService(new MemorySettingStorage());
    service.defaultWorkspace = () => realpathSync(root);
    service.markStorageFailed();
    const host = hosts.issue('standalone', 'content');
    const workspace = await service.restoreWorkspace(host.hostToken);
    assert.equal(workspace.isDefault, true);
    assert.equal(workspace.displayPath, realpathSync(root));
  });
});
