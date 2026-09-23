import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { runtime } from './onlyPreviewCoreTest.helper.mjs';

const fixture = (t, stored = null) => {
  const temp = mkdtempSync(join(tmpdir(), 'indipreview-scope-'));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const base = realpathSync(temp), root = join(base, 'work'), outside = join(base, 'work-other');
  mkdirSync(root); mkdirSync(outside);
  writeFileSync(join(root, 'inside.md'), 'inside'); writeFileSync(join(outside, 'outside.md'), 'outside');
  const hosts = new runtime.OnlyPreviewHostRegistry();
  const workspaces = new runtime.OnlyPreviewWorkspaceRegistry(hosts);
  let writes = 0;
  const storage = {
    getStored: async () => ({ exists: !!stored, valid: !!stored, value: stored, serializedValue: stored && JSON.stringify(stored) }),
    compareAndSet: async () => { writes++; return true; }, insertIfAbsent: async () => { writes++; return true; }
  };
  const service = new runtime.OnlyPreviewRecentDirectoryService(hosts, workspaces, storage,
    runtime.inspectOnlyPreviewProjectTarget, async () => { throw new Error('Scope must not bind an index'); }, () => root);
  const scope = async path => runtime.resolveOnlyPreviewTargetScope(
    await runtime.inspectOnlyPreviewProjectTarget(path), () => service.resolveWorkspaceRoot());
  return { root, outside, hosts, workspaces, service, scope, writes: () => writes };
};

test('cold scope waits for settings then uses default work without creating hosts or indexes', async t => {
  const f = fixture(t);
  let settled = false;
  const opening = f.scope(join(f.root, 'inside.md')).then(value => { settled = true; return value; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false);
  f.service.markStorageReady();
  assert.deepEqual(await opening, { kind: 'inside', rootRealPath: f.root });
  assert.equal(f.workspaces.currentProjectRoot(), null);
  assert.equal(f.writes(), 0);
});

test('pending authority still supplies active scope without waiting for index or settings', async t => {
  const f = fixture(t); const host = f.hosts.issue('standalone', 'content');
  f.workspaces.registerValidatedTarget(host.hostToken, await runtime.inspectOnlyPreviewProjectTarget(f.outside));
  assert.equal(f.workspaces.restore(host.hostToken), null, 'authority remains pending');
  assert.equal((await f.scope(join(f.outside, 'outside.md'))).kind, 'inside');
  assert.equal((await f.scope(join(f.root, 'inside.md'))).kind, 'outside');
  assert.equal(f.writes(), 0);
});

test('canonical containment rejects sibling prefixes and symlink escapes while accepting symlink aliases', async t => {
  const f = fixture(t); f.service.markStorageReady();
  symlinkSync(f.root, join(f.outside, 'alias'), 'dir');
  symlinkSync(join(f.outside, 'outside.md'), join(f.root, 'escape.md'));
  assert.equal((await f.scope(join(f.outside, 'outside.md'))).kind, 'outside');
  assert.equal((await f.scope(join(f.outside, 'alias', 'inside.md'))).kind, 'inside');
  await assert.rejects(f.scope(join(f.root, 'escape.md')), { code: 'PATH_NOT_REGULAR_FILE' });
  assert.equal(runtime.isOnlyPreviewPathWithinWorkspace(f.root, realpathSync(join(f.root, 'escape.md'))), false);
  assert.equal((await f.scope(f.outside)).kind, 'directory');
});

test('valid remembered root wins; deleted remembered root falls back without overwriting history', async t => {
  const f = fixture(t); const storage = f.service.storage;
  let selected = f.outside;
  storage.getStored = async () => ({ exists: true, valid: true, value: { version: 1, directoryPath: selected }, serializedValue: 'saved' });
  f.service.markStorageReady();
  assert.equal((await f.scope(join(f.outside, 'outside.md'))).kind, 'inside');
  selected = join(f.outside, 'deleted');
  assert.equal((await f.scope(join(f.root, 'inside.md'))).kind, 'inside');
  assert.equal(f.writes(), 0);
});
