/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { basename, resolve } from 'node:path';
import { setImmediate as tick } from 'node:timers/promises';
import { after, test } from 'node:test';
import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '../..');
const boundary = globalThis.__onlyPreviewClearWorkspaceTest = {
  host: null, broadcasts: [], urls: [], revocations: [],
  async revoke(value) { this.revocations.push(value); }
};
const bundle = await build({
  stdin: {
    contents: `
      export { clearOnlyPreviewWorkspace } from './src/main/miniapps/onlypreview/onlyPreviewClearWorkspace.service';
      export { onlyPreviewHostRegistry as hosts } from './src/main/miniapps/onlypreview/onlyPreviewHost.registry';
      export { onlyPreviewWorkspaceRegistry as workspaces } from './src/main/miniapps/onlypreview/onlyPreviewWorkspace.registry';
      export { onlyPreviewRecentDirectoryService as recent } from './src/main/miniapps/onlypreview/onlyPreviewRecentDirectory.service';
      export { onlyPreviewSelectionCoordinator as selections } from './src/main/miniapps/onlypreview/onlyPreviewSelectionCoordinator.service';
      export { onlyPreviewTargetMutations as targets } from './src/main/miniapps/onlypreview/onlyPreviewExplicitOpen.service';
    `,
    resolveDir: root, loader: 'ts'
  },
  write: false, bundle: true, platform: 'node', format: 'esm', target: 'node22',
  tsconfig: resolve(root, 'tsconfig.node.json'),
  plugins: [{ name: 'native-host-boundary', setup(context) {
    const stubs = {
      'electron-xpc/main': 'export const xpcMain = { broadcast: (...args) => b.broadcasts.push(args) };',
      '@main/windows/onlyPreviewWindow.helper': `export const onlyPreviewWindowHelper = {
        getStandaloneHost: () => b.host,
        getMountKind: () => b.mount,
        reportDisplayUrl: (...args) => b.urls.push(args),
        destroyStandalone: () => { throw new Error('Clearing must retain the native host'); },
        ensureStandalone: () => { throw new Error('Clearing must not create a native host'); }
      };`,
      '@main/fileSearch/fileSearchWindow.service': 'export const fileSearchWindowService = { revokeProjectWorkspace: value => b.revoke(value) };'
    };
    context.onResolve({ filter: /.*/ }, (args) => {
      if (args.path in stubs) return { path: args.path, namespace: 'clear-workspace-boundary' };
      if (args.path.endsWith('/onlyPreviewExplicitOpen.service')) return { path: 'targets', namespace: 'clear-workspace-boundary' };
    });
    context.onLoad({ filter: /.*/, namespace: 'clear-workspace-boundary' }, (args) => ({
      contents: args.path === 'targets'
        ? `import { OnlyPreviewTargetMutationQueue } from ${JSON.stringify(resolve(root, 'src/main/miniapps/onlypreview/onlyPreviewOpenRouter.service.ts'))}; export const onlyPreviewTargetMutations = new OnlyPreviewTargetMutationQueue();`
        : 'const b = globalThis.__onlyPreviewClearWorkspaceTest;\n' + stubs[args.path],
      resolveDir: root, loader: 'ts'
    }));
  } }]
});
const { clearOnlyPreviewWorkspace: clear, hosts, workspaces, recent, selections, targets } =
  await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
after(() => { hosts.clear(); delete globalThis.__onlyPreviewClearWorkspaceTest; });
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const stored = new Map();
recent.configureStorage({
  async getStored({ sub_key }) {
    const serializedValue = stored.get(sub_key);
    return serializedValue === undefined
      ? { exists: false, valid: false, value: null, serializedValue: null }
      : { exists: true, valid: true, value: JSON.parse(serializedValue), serializedValue };
  },
  async insertIfAbsent({ sub_key, value }) {
    if (stored.has(sub_key)) return false;
    stored.set(sub_key, JSON.stringify(value)); return true;
  },
  async compareAndSet({ sub_key, expectedSerializedValue, value }) {
    if (stored.get(sub_key) !== expectedSerializedValue) return false;
    stored.set(sub_key, JSON.stringify(value)); return true;
  }
});
let authorityGeneration = 0;
let bindGate = null;
const target = (path) => ({ rootRealPath: path, displayPath: path, rootName: basename(path) });
recent.configureTargetRuntime({
  inspectTarget: async (path) => target(path),
  bindWorkspace: async (hostToken, workspace) => {
    if (bindGate) await bindGate.promise;
    workspaces.bindProjectAuthority(hostToken, workspace.workspaceId, ++authorityGeneration);
  }
});
recent.markStorageReady();
const fixture = (mount = 'window') => {
  boundary.mount = mount;
  hosts.clear(); recent.clearTransientState(); stored.clear(); bindGate = null;
  boundary.host = hosts.issue('standalone', 'content');
  boundary.broadcasts = []; boundary.urls = []; boundary.revocations = [];
  boundary.revoke = async (value) => { boundary.revocations.push(value); };
  return boundary.host;
};
const open = (host, path) => targets.run(async () => {
  const generation = recent.beginExplicitTarget(host.hostToken);
  try { return await recent.openExplicitTarget(host.hostToken, path, generation); }
  finally { recent.finishExplicitTarget(generation); }
});

for (const mount of ['window', 'cowork']) test(`${mount}: clear retains host/external authority, invalidates Project selection, and broadcasts a non-restorable empty Project`, async () => {
  const host = fixture(mount);
  const project = await open(host, '/project-one');
  const external = workspaces.registerExternalPreview(host.hostToken, { ...target('/external'), selectedRelativePath: 'note.md' });
  const selected = selections.beginSelection(host.hostToken, { workspaceId: project.workspaceId, relativePath: 'old.md' });
  const generation = workspaces.getProjectAuthorityRootRef(host.hostToken, project.workspaceId).workspaceGeneration;
  await clear(host.hostToken, '/project-one');
  assert.equal(boundary.host, host);
  assert.equal(hosts.require(host.hostToken), host);
  assert.equal(selections.isCurrent(host.hostToken, selected), false);
  assert.equal(await recent.restoreWorkspace(host.hostToken), null);
  assert.equal(stored.get('last_directory'), 'null');
  assert.equal(workspaces.requireWorkspace(host.hostToken, external.workspaceId).kind, 'external-preview');
  assert.deepEqual(boundary.revocations, [{ workspaceId: project.workspaceId, workspaceGeneration: generation }]);
  assert.deepEqual(boundary.broadcasts, [['onlypreview/workspaceChanged', { hostId: host.hostId }]]);
  assert.deepEqual(boundary.urls, [[host.hostToken, 'file:///external/note.md']]);
});

test('other or pending Project roots and stale native hosts are left alone', async () => {
  const host = fixture();
  const project = await open(host, '/project-two');
  await clear(host.hostToken, '/project-one');
  assert.equal(workspaces.restore(host.hostToken).workspaceId, project.workspaceId);
  const pending = workspaces.registerValidatedTarget(host.hostToken, target('/pending-other'));
  await clear(host.hostToken, '/project-one');
  assert.equal(workspaces.requireWorkspace(host.hostToken, pending.workspaceId).rootRealPath, '/pending-other');
  boundary.host = hosts.issue('standalone', 'content');
  await clear(host.hostToken, '/pending-other');
  assert.equal(workspaces.requireWorkspace(host.hostToken, pending.workspaceId).rootRealPath, '/pending-other');
  assert.equal(boundary.broadcasts.length, 0);
});

test('queued clear rechecks the Project after a preceding replacement', async () => {
  const host = fixture();
  await open(host, '/project-one');
  const replacement = open(host, '/project-two');
  const clearing = clear(host.hostToken, '/project-one');
  const project = await replacement;
  await clearing;
  assert.equal(workspaces.restore(host.hostToken).workspaceId, project.workspaceId);
  assert.equal(boundary.broadcasts.length, 0);
});

test('clear waits for Project runtime revocation before same/different-root reopen on the retained host', async () => {
  const host = fixture();
  const old = await open(host, '/project-one');
  const release = deferred();
  boundary.revoke = async (value) => { boundary.revocations.push(value); await release.promise; };
  const clearing = clear(host.hostToken, '/project-one');
  let reopened = false;
  const opening = open(host, '/project-one').then((value) => { reopened = true; return value; });
  await tick();
  assert.equal(reopened, false);
  assert.equal(boundary.revocations.length, 1);
  release.resolve(); await clearing;
  const same = await opening;
  assert.notEqual(same.workspaceId, old.workspaceId);
  assert.equal(same.displayPath, old.displayPath);
  await clear(host.hostToken, '/project-one');
  const different = await open(host, '/project-two');
  assert.equal(different.displayPath, '/project-two');
  assert.equal(boundary.host, host);
});

test('clear drains an in-flight restore bind and revokes the authority assigned after clear began', async () => {
  const host = fixture();
  stored.set('last_directory', JSON.stringify({ version: 1, directoryPath: '/project-one' }));
  bindGate = deferred();
  const restoring = recent.restoreWorkspace(host.hostToken);
  await tick();
  const clearing = clear(host.hostToken, '/project-one');
  await tick();
  bindGate.resolve();
  assert.equal(await restoring, null);
  await clearing;
  assert.equal(boundary.revocations.length, 1);
  assert.equal(await recent.restoreWorkspace(host.hostToken), null);
  assert.equal(stored.get('last_directory'), 'null');
});

test('empty clear suppresses an unbound restore and remains idempotent', async () => {
  const host = fixture();
  stored.set('last_directory', JSON.stringify({ version: 1, directoryPath: '/project-one' }));
  await clear(host.hostToken, '/project-one');
  await clear(host.hostToken, '/project-one');
  assert.equal(await recent.restoreWorkspace(host.hostToken), null);
  assert.equal(boundary.revocations.length, 0);
  assert.equal(boundary.host, host);
});

test('failed Project runtime revocation reports failure while the Project stays cleared and later opens remain possible', async () => {
  const host = fixture();
  await open(host, '/project-one');
  boundary.revoke = async () => { throw new Error('runtime disconnected'); };
  await assert.rejects(clear(host.hostToken, '/project-one'), /runtime disconnected/);
  assert.equal(await recent.restoreWorkspace(host.hostToken), null);
  assert.equal(boundary.broadcasts.length, 1);
  assert.equal((await open(host, '/project-two')).displayPath, '/project-two');
});
