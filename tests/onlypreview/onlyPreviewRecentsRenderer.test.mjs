/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, test } from 'node:test';
import { build } from 'esbuild';

const projectRoot = resolve(import.meta.dirname, '../..');
const buildRoot = mkdtempSync(join(tmpdir(), 'onlypreview-recents-renderer-'));
const modulePath = join(buildRoot, 'recents.mjs');
globalThis.__onlyPreviewRecentsSubscriptions = new Map();
await build({
  entryPoints: [
    join(projectRoot, 'src/renderer/onlypreview/shell/src/onlyPreviewRecents.store.ts')
  ],
  outfile: modulePath,
  bundle: true,
  format: 'esm',
  platform: 'node',
  tsconfig: join(projectRoot, 'tsconfig.node.json'),
  plugins: [
    {
      name: 'renderer-boundaries',
      setup(context) {
        context.onResolve(
          {
            filter:
              /electron-xpc\/renderer|onlyPreviewClient$|onlyPreviewEnv\.bridge$|onlyPreviewErrorDetail\.store$/
          },
          ({ path }) => ({ path, namespace: 'stub' })
        );
        context.onLoad({ filter: /.*/, namespace: 'stub' }, ({ path }) => ({
          loader: 'js',
          contents:
            path === 'electron-xpc/renderer'
              ? `export const xpcRenderer={subscribe:(name,callback)=>globalThis.__onlyPreviewRecentsSubscriptions.set(name,callback)};`
              : path.endsWith('onlyPreviewClient')
                ? 'export const onlyPreviewClient={};'
                : path.endsWith('onlyPreviewEnv.bridge')
                  ? 'export const onlyPreviewEnv={hostId:"host",hostToken:"token"};'
                  : 'export const describeOnlyPreviewError=(error)=>error.message;'
        }));
      }
    }
  ]
});
const { OnlyPreviewRecentsStore } = await import(pathToFileURL(modulePath).href);
after(() => {
  rmSync(buildRoot, { recursive: true, force: true });
  delete globalThis.__onlyPreviewRecentsSubscriptions;
});
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const ok = (value) => ({ ok: true, value });
const entry = (id) => ({ id, name: `${id}.md`, relativePath: `../other/${id}.md` });
const snapshot = (revision = 1, ids = ['new', 'old']) => ({
  hostId: 'host',
  revision,
  entries: ids.map(entry),
  activeEntryId: ids[0] ?? null,
  canBack: ids.length > 1,
  canForward: false,
  canReload: ids.length > 0,
  canLocate: false
});
const harness = () => {
  const calls = [];
  let current = snapshot();
  const client = {
    getRecents: async (args) => {
      calls.push(['get', args]);
      return ok(current);
    },
    openRecent: async (args) => {
      calls.push(['open', args]);
      return ok();
    },
    navigateRecent: async (args) => {
      calls.push(['navigate', args]);
      return ok();
    },
    reloadPreview: async (args) => {
      calls.push(['reload', args]);
      return ok();
    }
  };
  return {
    store: new OnlyPreviewRecentsStore(client, { hostId: 'host', hostToken: 'token' }),
    client,
    calls,
    setSnapshot: (value) => {
      current = value;
    }
  };
};

test('selecting a recent or changing panels performs no open, sorting, or Project operation', async () => {
  const { store, calls } = harness();
  await store.refresh();
  const original = store.snapshot;
  calls.length = 0;
  store.activePanel = 'recents';
  store.select('old');
  store.activePanel = 'project';
  assert.equal(store.selectedEntryId, 'old');
  assert.equal(store.snapshot, original);
  assert.deepEqual(calls, []);
});

test('explicit recent open sends only its opaque identity and accepted list revision', async () => {
  const { store, calls } = harness();
  await store.refresh();
  store.select('old');
  await store.openSelected();
  assert.deepEqual(
    calls.find(([name]) => name === 'open'),
    ['open', { hostToken: 'token', entryId: 'old', revision: 1 }]
  );
  assert.deepEqual(
    store.entries.map(({ id }) => id),
    ['new', 'old']
  );
});

test('navigation preserves backend order and reload uses only the preview API', async () => {
  const { store, calls, setSnapshot } = harness();
  await store.refresh();
  const older = { ...snapshot(2), activeEntryId: 'old', canBack: false, canForward: true };
  setSnapshot(older);
  await store.navigate('back');
  assert.deepEqual(
    store.entries.map(({ id }) => id),
    ['new', 'old']
  );
  assert.deepEqual(
    calls.find(([name]) => name === 'navigate'),
    ['navigate', { hostToken: 'token', direction: 'back', revision: 1 }]
  );
  assert.equal(store.canBack, false);
  assert.equal(store.canForward, true);
  await store.reload();
  assert.deepEqual(
    calls.find(([name]) => name === 'reload'),
    ['reload', { hostToken: 'token' }]
  );
  assert.equal(store.snapshot, older);
  const count = calls.length;
  await store.navigate('back');
  assert.equal(calls.length, count);
});

test('late fetch and prior-Project fetch cannot replace the latest scoped snapshot', async () => {
  const { store, client } = harness();
  const first = deferred();
  const second = deferred();
  let count = 0;
  client.getRecents = () => (++count === 1 ? first.promise : second.promise);
  const olderFetch = store.refresh();
  store.resetWorkspace();
  assert.equal(store.snapshot, null);
  second.resolve(ok(snapshot(3, ['project-b'])));
  await Promise.resolve();
  await Promise.resolve();
  first.resolve(ok(snapshot(2, ['project-a'])));
  await olderFetch;
  assert.deepEqual(
    store.entries.map(({ id }) => id),
    ['project-b']
  );
});

test('rapid activation keeps only latest action error/loading state', async () => {
  const { store, client } = harness();
  await store.refresh();
  const first = deferred();
  const second = deferred();
  let count = 0;
  client.openRecent = () => (++count === 1 ? first.promise : second.promise);
  store.select('new');
  const olderOpen = store.openSelected();
  store.select('old');
  const newerOpen = store.openSelected();
  second.resolve(ok());
  await newerOpen;
  first.reject(new Error('stale failed open'));
  await olderOpen;
  assert.equal(store.actionError, '');
  assert.equal(store.actionPending, false);
  assert.equal(store.selectedEntryId, 'old');
});

test('host nudges and disposal fence subscription fetches without promoting anything', async () => {
  const { store, calls } = harness();
  await store.initialize();
  const callback = globalThis.__onlyPreviewRecentsSubscriptions.get('onlypreview/recentsChanged');
  calls.length = 0;
  callback({ params: { hostId: 'other' } });
  assert.deepEqual(calls, []);
  callback({ params: { hostId: 'host' } });
  await Promise.resolve();
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'get');
  store.dispose();
  callback({ params: { hostId: 'host' } });
  assert.equal(calls.length, 1);
});

test('UI keeps the tree mounted, isolates recent selection, and places IconBtn navigation first', () => {
  const source = (path) =>
    readFileSync(join(projectRoot, 'src/renderer/onlypreview', path), 'utf8');
  const app = source('shell/src/App.vue');
  const panel = source('shell/src/components/Recents/RecentsPanel.vue');
  const toolbar = source('shell/src/components/PreviewToolbar/PreviewToolbar.vue');
  assert.match(app, /v-show="onlyPreviewRecentsStore\.activePanel === 'project'"/);
  assert.match(app, /<RecentsPanel v-show=/);
  assert.match(app, /if \(!canLocateCurrentPreview\.value\) return;/);
  assert.match(app, /fileRef\.workspaceId === onlyPreviewShellStore\.workspace\?\.workspaceId/);
  assert.match(panel, /@click="onlyPreviewRecentsStore\.select\(entry\.id\)"/);
  assert.match(panel, /@dblclick\.prevent="open\(entry\.id\)"/);
  assert.match(panel, /event\.key === 'Enter'/);
  assert.match(panel, /entry\.name[\s\S]*entry\.relativePath/);
  assert.ok(
    toolbar.indexOf('onlypreview__previewNavigation') <
      toolbar.indexOf('onlypreview__previewIdentity')
  );
  assert.equal((toolbar.match(/<IconBtn\b/g) ?? []).length, 3);
  assert.doesNotMatch(toolbar, /onlyPreviewShellStore\.refresh\(/);
  assert.ok(source('shell/src/onlyPreviewShell.store.ts').split('\n').length < 800);
});

test('a presentation nudge updates the current recent without changing keyboard selection', async () => {
  const { store, setSnapshot } = harness();
  await store.initialize();
  store.select('old');
  const callback = globalThis.__onlyPreviewRecentsSubscriptions.get('onlypreview/previewPresentation');
  setSnapshot({ ...snapshot(2), activeEntryId: 'new' });
  callback({ params: { hostId: 'host' } });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(store.snapshot.activeEntryId, 'new');
  assert.equal(store.selectedEntryId, 'old');
});

test('a slow earlier presentation response cannot overwrite the latest current file', async () => {
  const { store, client } = harness();
  await store.initialize();
  const older = deferred();
  const newer = deferred();
  let count = 0;
  client.getRecents = () => (++count === 1 ? older.promise : newer.promise);
  const callback = globalThis.__onlyPreviewRecentsSubscriptions.get('onlypreview/previewPresentation');
  callback({ params: { hostId: 'host' } });
  callback({ params: { hostId: 'host' } });
  newer.resolve(ok({ ...snapshot(3), activeEntryId: 'new' }));
  await Promise.resolve();
  await Promise.resolve();
  older.resolve(ok({ ...snapshot(2), activeEntryId: 'old' }));
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(store.snapshot.activeEntryId, 'new');
  assert.equal(store.snapshot.revision, 3);
});

test('the colored and accessible current recent use the live cursor, independently from keyboard selection', () => {
  const panel = readFileSync(join(projectRoot, 'src/renderer/onlypreview/shell/src/components/Recents/RecentsPanel.vue'), 'utf8');
  assert.match(panel, /'onlypreview-recents__row--selected': entry.id === onlyPreviewRecentsStore.snapshot\?\.activeEntryId/);
  assert.match(panel, /:aria-selected="entry.id === onlyPreviewRecentsStore.snapshot\?\.activeEntryId"/);
  assert.match(panel, /:tabindex="entry.id === onlyPreviewRecentsStore.selectedEntryId \? 0 : -1"/);
});
