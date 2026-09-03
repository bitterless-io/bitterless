/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, test } from 'node:test';
import { build } from 'esbuild';

const projectRoot = resolve(dirname(new URL(import.meta.url).pathname), '..', '..');
const buildRoot = mkdtempSync(join(tmpdir(), 'onlypreview-global-search-view-'));
const bundlePath = join(buildRoot, 'runtime.mjs');

await build({
  entryPoints: [
    join(projectRoot, 'src/main/onlypreview/views/onlyPreviewGlobalSearchView.service.ts')
  ],
  outfile: bundlePath,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  tsconfig: join(projectRoot, 'tsconfig.node.json')
});

const { OnlyPreviewGlobalSearchViewService } = await import(pathToFileURL(bundlePath).href);

after(() => rmSync(buildRoot, { recursive: true, force: true }));

const host = {
  kind: 'standalone',
  role: 'content',
  hostId: 'global-search-host',
  hostToken: 'global-search-host-token-000000'
};
const bounds = { x: 265, y: 75, width: 800, height: 620 };
const viewBounds = { x: 0, y: 0, width: 1280, height: 800 };
const visibilityEvent = 'onlypreview/globalSearchVisibility';

const visibilityStates = (broadcasts) =>
  broadcasts
    .filter(({ eventName }) => eventName === visibilityEvent)
    .map(({ params }) => params.active);

const visibilityRevisions = (broadcasts) =>
  broadcasts
    .filter(({ eventName }) => eventName === visibilityEvent)
    .map(({ params }) => params.revision);

const deferred = () => {
  let resolvePromise;
  let rejectPromise;
  const promise = new Promise((resolveValue, rejectValue) => {
    resolvePromise = resolveValue;
    rejectPromise = rejectValue;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
};

const tick = async () => {
  await new Promise((resolveTick) => setImmediate(resolveTick));
};

const createView = (name, operations) => {
  const webContents = new EventEmitter();
  webContents.destroyed = false;
  webContents.focusCount = 0;
  webContents.isDestroyed = () => webContents.destroyed;
  webContents.focus = () => {
    webContents.focusCount += 1;
  };
  webContents.close = () => {
    webContents.destroyed = true;
  };
  return {
    name,
    bounds: null,
    webContents,
    setBounds(nextBounds) {
      this.bounds = { ...nextBounds };
      operations.push({ kind: 'bounds', name, bounds: { ...nextBounds } });
    }
  };
};

const createHarness = (loadView = async () => undefined) => {
  const operations = [];
  const children = [];
  const views = [];
  const broadcasts = [];
  let projectFocuses = 0;
  let previewFocuses = 0;
  let openerRestores = 0;
  let openerClears = 0;
  const window = {
    destroyed: false,
    isDestroyed() {
      return this.destroyed;
    },
    contentView: {
      addChildView(view) {
        const current = children.indexOf(view);
        if (current >= 0) children.splice(current, 1);
        children.push(view);
        operations.push({ kind: 'add', name: view.name, bounds: view.bounds });
      },
      removeChildView(view) {
        const current = children.indexOf(view);
        if (current >= 0) children.splice(current, 1);
        operations.push({ kind: 'remove', name: view.name });
      }
    }
  };
  const service = new OnlyPreviewGlobalSearchViewService();
  service.start({
    window,
    host,
    createView: () => {
      const view = createView(`search-${views.length + 1}`, operations);
      views.push(view);
      return view;
    },
    loadView,
    broadcast: (eventName, params) => broadcasts.push({ eventName, params }),
    restoreOpener: () => {
      openerRestores += 1;
      return true;
    },
    clearOpener: () => {
      openerClears += 1;
    },
    focusProject: () => {
      projectFocuses += 1;
      return true;
    },
    focusPreview: () => {
      previewFocuses += 1;
      return true;
    }
  });
  return {
    service,
    window,
    operations,
    children,
    views,
    broadcasts,
    counts: () => ({ projectFocuses, previewFocuses, openerRestores, openerClears })
  };
};

const workspace = (generation = 8, currentDirectoryRelativePath = 'src') => ({
  workspaceId: 'workspace-global-search-000000',
  generation,
  ready: true,
  rootName: 'bitterless',
  currentDirectoryRelativePath
});

test('Search spans the BaseWindow, publishes exact Preview geometry, and stays topmost', async () => {
  const harness = createHarness();
  harness.service.updateBounds(host.hostToken, viewBounds, bounds);
  const view = harness.service.show(host.hostToken, 'chrome');
  assert.equal(harness.views.length, 1);
  // The overlay is transparent and full-window, so attaching it before it has loaded puts an
  // invisible click-and-keystroke sink over the shell and the preview for the whole cold boot.
  assert.deepEqual(harness.children, [], 'an unloaded overlay must not be in the child list');
  await tick();
  assert.deepEqual(view.bounds, viewBounds);
  assert.deepEqual(harness.service.getContext(host.hostToken).layout, {
    viewBounds,
    workspaceBounds: bounds
  });
  assert.deepEqual(
    harness.broadcasts.find(({ eventName }) => eventName === 'onlypreview/globalSearchLayout')
      ?.params,
    {
      hostId: host.hostId,
      revision: 1,
      layout: { viewBounds, workspaceBounds: bounds }
    }
  );
  // A raise is a real detach-then-attach: re-adding an attached child reorders the views tree, but
  // only the detach drives the native host path that restacks AppKit subviews on macOS.
  assert.deepEqual(harness.operations.slice(0, 3), [
    { kind: 'bounds', name: 'search-1', bounds: viewBounds },
    { kind: 'remove', name: 'search-1' },
    { kind: 'add', name: 'search-1', bounds: viewBounds }
  ]);

  const preview = createView('pdf-preview', harness.operations);
  harness.window.contentView.addChildView(preview);
  assert.deepEqual(
    harness.children.map(({ name }) => name),
    ['search-1', 'pdf-preview']
  );
  harness.service.raiseAfterPreviewAttach(host.hostToken);
  assert.deepEqual(
    harness.children.map(({ name }) => name),
    ['pdf-preview', 'search-1']
  );

  harness.service.close(host.hostToken, 'discard');
  assert.equal(harness.children.includes(view), false);
  assert.equal(view.webContents.destroyed, false);
  // Re-showing a warm overlay is synchronous: the renderer already exists, which is the whole point
  // of keeping it alive across close.
  assert.equal(harness.service.show(host.hostToken, 'shell'), view);
  assert.equal(harness.children.includes(view), true);
  assert.equal(harness.views.length, 1);
  harness.service.destroy();
  assert.equal(view.webContents.destroyed, true);
  assert.deepEqual(visibilityStates(harness.broadcasts), [true, false, true, false]);
  assert.deepEqual(visibilityRevisions(harness.broadcasts), [2, 3, 4, 5]);
});

test('Main owns monotonic context revisions across a Shell reload generation reset', () => {
  const harness = createHarness();
  harness.service.reportContext(host.hostToken, workspace(9, 'areas'));
  assert.deepEqual(harness.service.getContext(host.hostToken), {
    revision: 1,
    active: false,
    workspace: workspace(9, 'areas'),
    layout: null
  });
  harness.service.show(host.hostToken, 'shell');
  harness.service.reportContext(host.hostToken, workspace(1, 'src'));
  assert.deepEqual(harness.service.getContext(host.hostToken), {
    revision: 3,
    active: true,
    workspace: workspace(1, 'src'),
    layout: null
  });
  assert.deepEqual(
    harness.broadcasts
      .filter(({ eventName }) => eventName === 'onlypreview/globalSearchContextChanged')
      .map(({ params }) => params.revision),
    [1, 3]
  );
  assert.deepEqual(visibilityStates(harness.broadcasts), [false, true, true]);
  assert.deepEqual(visibilityRevisions(harness.broadcasts), [1, 2, 3]);
});

test('directory reveal is generation-fenced and resolves only an exact action completion', async () => {
  const harness = createHarness();
  harness.service.reportContext(host.hostToken, workspace());
  harness.service.updateBounds(host.hostToken, viewBounds, bounds);
  harness.service.show(host.hostToken, 'shell');
  const reveal = harness.service.requestDirectoryReveal(host.hostToken, {
    hostToken: host.hostToken,
    workspaceId: workspace().workspaceId,
    generation: 8,
    relativePath: 'areas/network'
  });
  const action = harness.broadcasts.at(-1).params;
  assert.equal(action.hostToken, undefined);
  assert.throws(
    () =>
      harness.service.completeDirectoryReveal(host.hostToken, {
        hostToken: host.hostToken,
        ...action,
        relativePath: 'areas/other',
        succeeded: true
      }),
    (error) => error.code === 'INVALID_INPUT'
  );
  harness.service.completeDirectoryReveal(host.hostToken, {
    hostToken: host.hostToken,
    ...action,
    succeeded: true
  });
  assert.equal(await reveal, true);
  assert.equal(harness.service.isActive(host.hostToken), true);
});

test('file/project close targets explicit surfaces and overlay failure stays isolated', async () => {
  const load = deferred();
  const harness = createHarness(async () => await load.promise);
  harness.service.updateBounds(host.hostToken, viewBounds, bounds);
  const first = harness.service.show(host.hostToken, 'vue');
  assert.equal(harness.service.close(host.hostToken, 'preview'), true);
  assert.equal(harness.counts().previewFocuses, 1);
  assert.equal(first.webContents.destroyed, false);

  harness.service.show(host.hostToken, 'shell');
  assert.equal(harness.service.close(host.hostToken, 'project'), true);
  assert.equal(harness.counts().projectFocuses, 1);
  assert.equal(harness.service.close(host.hostToken, 'project'), false);
  assert.equal(harness.counts().projectFocuses, 1);

  harness.service.show(host.hostToken, 'shell');
  load.reject(new Error('bundle failed'));
  await tick();
  assert.equal(first.webContents.destroyed, true);
  assert.equal(harness.service.getView(), null);
  assert.equal(harness.counts().projectFocuses, 2);
  assert.equal(harness.window.destroyed, false);
  assert.equal(visibilityStates(harness.broadcasts).at(-1), false);

  const replacement = harness.service.show(host.hostToken, 'shell');
  assert.notEqual(replacement, first);
  replacement.webContents.destroyed = true;
  replacement.webContents.emit('render-process-gone');
  assert.equal(harness.service.getView(), null);
  assert.equal(harness.counts().projectFocuses, 3);
  assert.equal(harness.window.destroyed, false);
  assert.equal(visibilityStates(harness.broadcasts).at(-1), false);
});

test('inactive overlay load failure never repeats focus restoration', async () => {
  const load = deferred();
  const harness = createHarness(async () => await load.promise);
  harness.service.updateBounds(host.hostToken, viewBounds, bounds);
  const view = harness.service.show(host.hostToken, 'vue');
  assert.equal(harness.service.close(host.hostToken, 'preview'), true);

  load.reject(new Error('closed before load finished'));
  await tick();

  assert.equal(view.webContents.destroyed, true);
  assert.equal(harness.service.getView(), null);
  assert.deepEqual(harness.counts(), {
    projectFocuses: 0,
    previewFocuses: 1,
    openerRestores: 0,
    openerClears: 1
  });
  assert.equal(visibilityStates(harness.broadcasts).at(-1), false);
});
