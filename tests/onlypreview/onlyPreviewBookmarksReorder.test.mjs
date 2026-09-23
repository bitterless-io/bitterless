/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { build, transformSync } from 'esbuild';
import ts from 'typescript';

const root = resolve(import.meta.dirname, '../..');
const compiled = await build({
  stdin: { contents: [
    "export { OnlyPreviewBookmarkStorageService as Store } from './src/preload/onlypreview/onlyPreviewBookmarkStorage.service.ts';",
    "export { OnlyPreviewBookmarksService as Service } from './src/main/miniapps/onlypreview/onlyPreviewBookmarks.service.ts';",
    "export { OnlyPreviewHostRegistry as Hosts } from './src/main/miniapps/onlypreview/onlyPreviewHost.registry.ts';",
    "export { OnlyPreviewWorkspaceRegistry as Workspaces } from './src/main/miniapps/onlypreview/onlyPreviewWorkspace.registry.ts';",
    "export { parseOnlyPreviewBookmarksReorderRequest as parseRequest } from './src/shared/onlypreview/onlyPreview.contract.ts';"
  ].join('\n'), resolveDir: root },
  bundle: true, write: false, platform: 'node', format: 'esm', tsconfig: join(root, 'tsconfig.node.json')
});
const { Store, Service, Hosts, Workspaces, parseRequest } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const rootA = '/project/A', rootB = '/project/B';
const paths = (state) => state.entries.map((entry) => entry.relativePath);
const fixture = async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'onlypreview-bookmarks-reorder-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new Store(directory, async () => null);
  const add = (relativePath, project = rootA) => store.execute({ rootRealPath: project, action: 'add',
    entry: { relativePath, nodeKind: relativePath.includes('.') ? 'file' : 'directory' } });
  const snapshot = (project = rootA) => store.execute({ rootRealPath: project, action: 'snapshot' });
  const reorder = (relativePaths, project = rootA) => store.execute({ rootRealPath: project, action: 'reorder', relativePaths });
  return { directory, store, add, snapshot, reorder };
};
const harness = (store, ready = true) => {
  const hosts = new Hosts(), workspaces = new Workspaces(hosts), events = [];
  const service = new Service(workspaces, async ({ relativePath }) => ({ nodeKind: relativePath.includes('.') ? 'file' : 'directory' }),
    (hostId, snapshot) => events.push({ hostId, ...snapshot }));
  service.configureStorage(store);
  if (ready) service.markStorageReady();
  const host = hosts.issue('standalone', 'content');
  const bind = (path = rootA, owner = host) => {
    const workspace = workspaces.registerValidatedTarget(owner.hostToken, {
      rootRealPath: path, rootName: basename(path), displayPath: path
    });
    workspaces.bindProjectAuthority(owner.hostToken, workspace.workspaceId, 1);
    return { hostToken: owner.hostToken, workspaceId: workspace.workspaceId };
  };
  return { hosts, host, workspaces, service, events, bind };
};

test('reorder persists exact mixed file/folder order across restart and keeps other workspaces unchanged', async (t) => {
  const h = await fixture(t);
  await h.add('one.md'); await h.add('docs'); await h.add('three.pdf');
  const other = await h.add('other.md', rootB);
  const result = await h.reorder(['three.pdf', 'one.md', 'docs']);
  assert.equal(result.changed, true);
  assert.equal(result.revision, 4);
  assert.deepEqual(paths(result), ['three.pdf', 'one.md', 'docs']);
  assert.deepEqual(result.entries.map(entry => entry.nodeKind), ['file', 'file', 'directory']);
  const reopened = new Store(h.directory, async () => { throw Error('Existing data must not remigrate'); });
  assert.deepEqual(await reopened.execute({ rootRealPath: rootA, action: 'snapshot' }), { revision: 4, entries: result.entries });
  assert.deepEqual(await h.snapshot(rootB), other);
  assert.equal((await h.reorder(paths(result))).revision, 4);
  assert.equal((await h.reorder(paths(result))).changed, false);
});

test('duplicate, omitted, unknown, malformed and excessive orders reject without changing committed data', async (t) => {
  const h = await fixture(t);
  await h.add('one.md'); await h.add('docs');
  const before = await h.snapshot();
  for (const order of [[], ['one.md'], ['one.md', 'one.md'], ['docs', 'other.md'], ['docs', '../one.md'],
    ['docs', '/one.md'], ['docs', 'a\0.md'], ['docs', 'x'.repeat(16385)], Array(2), null, {},
    Array.from({ length: 1001 }, (_, index) => `entry-${index}`)]) {
    await assert.rejects(h.reorder(order), (error) => error.code === 'INVALID_INPUT');
    assert.deepEqual(await h.snapshot(), before);
  }
  const empty = await h.reorder([], rootB);
  assert.deepEqual(empty, { revision: 0, entries: [], changed: false });
});

test('overlapping additions/removals cannot be silently overwritten by stale full-order requests', async (t) => {
  const h = await fixture(t);
  await h.add('one.md'); await h.add('docs');
  const added = h.add('new.md');
  const staleAdd = assert.rejects(h.reorder(['docs', 'one.md']), /Bookmarks changed/);
  await Promise.all([added, staleAdd]);
  assert.deepEqual(paths(await h.snapshot()), ['one.md', 'docs', 'new.md']);
  const removed = h.store.execute({ rootRealPath: rootA, action: 'remove', relativePath: 'docs' });
  const staleRemove = assert.rejects(h.reorder(['new.md', 'docs', 'one.md']), /Bookmarks changed/);
  await Promise.all([removed, staleRemove]);
  const sorted = h.reorder(['new.md', 'one.md']);
  const appended = h.add('last.md');
  await Promise.all([sorted, appended]);
  assert.deepEqual(paths(await h.snapshot()), ['new.md', 'one.md', 'last.md']);
});

test('failed reorder transaction rolls back and does not poison later storage operations', async (t) => {
  const h = await fixture(t);
  await h.add('one.md'); await h.add('docs');
  const before = await h.snapshot();
  const db = new DatabaseSync(join(h.directory, 'onlypreview/project-state', createHash('sha256').update(rootA).digest('hex') + '.sqlite'));
  try {
    db.exec("CREATE TRIGGER fail_reorder BEFORE UPDATE ON bookmarks BEGIN SELECT RAISE(ABORT, 'simulated write failure'); END");
    await assert.rejects(h.reorder(['docs', 'one.md']), /simulated write failure/);
    assert.deepEqual(await h.snapshot(), before);
    db.exec('DROP TRIGGER fail_reorder');
  } finally { db.close(); }
  assert.equal((await h.reorder(['docs', 'one.md'])).revision, before.revision + 1);
});

test('Main authorizes current Project, returns committed snapshot, and broadcasts once only for a changed order', async (t) => {
  const f = await fixture(t), h = harness(f.store), request = h.bind();
  await h.service.add({ ...request, relativePath: 'one.md' });
  await h.service.add({ ...request, relativePath: 'docs' });
  h.events.length = 0;
  const result = await h.service.reorder({ ...request, relativePaths: ['docs', 'one.md'] });
  assert.equal(result.revision, 3);
  assert.deepEqual(result.entries.map(entry => entry.name), ['docs', 'one.md']);
  assert.equal(Object.hasOwn(result, 'changed'), false);
  assert.equal(h.events.length, 1);
  assert.deepEqual(h.events[0], { hostId: h.host.hostId, ...result });
  assert.deepEqual(await h.service.reorder({ ...request, relativePaths: ['docs', 'one.md'] }), result);
  assert.equal(h.events.length, 1);
  await assert.rejects(h.service.reorder({ ...request, relativePaths: ['one.md'] }));
  assert.equal(h.events.length, 1);
  const outsider = h.hosts.issue('standalone', 'content');
  await assert.rejects(h.service.reorder({ ...request, hostToken: outsider.hostToken, relativePaths: ['one.md', 'docs'] }));
  h.bind(rootB);
  await assert.rejects(h.service.reorder({ ...request, relativePaths: ['one.md', 'docs'] }));
  assert.deepEqual(paths(await f.snapshot()), ['docs', 'one.md']);
});

test('a queued reorder captured before Project replacement cannot write after readiness settles', async (t) => {
  const f = await fixture(t);
  await f.add('one.md'); await f.add('docs');
  const h = harness(f.store, false), request = h.bind();
  const pending = assert.rejects(h.service.reorder({ ...request, relativePaths: ['docs', 'one.md'] }));
  h.bind(rootB);
  h.service.markStorageReady();
  await pending;
  assert.deepEqual(paths(await f.snapshot()), ['one.md', 'docs']);
  assert.equal(h.events.length, 0);
});

test('public reorder contract validates exact shape and bounded capabilities before Main work', async (t) => {
  const h = harness((await fixture(t)).store), request = h.bind();
  const valid = { ...request, relativePaths: ['docs', 'one.md'] };
  assert.deepEqual(parseRequest(valid), valid);
  for (const bad of [null, [], {}, { ...valid, rootRealPath: '/escape' }, { ...valid, hostToken: 'short' },
    { ...valid, workspaceId: 'x'.repeat(257) }, { ...request, relativePaths: ['one.md', 'one.md'] }]) {
    assert.throws(() => parseRequest(bad), error => error.code === 'INVALID_INPUT');
  }
});

test('public Main handler forwards to the same reorder service and generic client carries its typed API', async () => {
  const read = (path) => readFileSync(join(root, path), 'utf8');
  const source = read('src/main/xpc/onlyPreview.handler.ts');
  const ast = ts.createSourceFile('onlyPreview.handler.ts', source, ts.ScriptTarget.Latest, true);
  const owner = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'OnlyPreviewHandler');
  const method = owner.members.find(node => node.name?.getText(ast) === 'reorderBookmarks');
  assert.ok(method);
  const code = transformSync('export class Handler { ' + method.getText(ast) + ' }', { loader: 'ts', format: 'cjs' }).code;
  const calls = [], module = { exports: {} }, committed = { workspaceId: 'A', revision: 2, entries: [] };
  new Function('module', 'exports', 'runOperation', 'onlyPreviewBookmarksService', code)(module, module.exports,
    (operation, run) => { calls.push(operation); return run(); },
    { reorder: async (request) => { calls.push(request); return committed; } });
  const request = { hostToken: 'host', workspaceId: 'A', relativePaths: [] };
  assert.equal(await new module.exports.Handler().reorderBookmarks(request), committed);
  assert.deepEqual(calls, ['reorderBookmarks', request]);
  assert.match(read('src/shared/onlypreview/onlyPreview.types.ts'), /reorderBookmarks\(params:.*OnlyPreviewBookmarksReorderRequest/);
  assert.match(read('src/renderer/onlypreview/common/onlyPreviewClient.ts'), /createXpcRendererEmitter<OnlyPreviewApi>/);
  assert.match(read('src/preload/onlypreview/onlypreview.preload.ts'), /import 'electron-xpc\/preload'/);
});
