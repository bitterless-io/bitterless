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
  const layerShows = [];
  const layerHides = [];
  let openerRestores = 0;
  let openerClears = 0;
  const window = {
    destroyed: false,
    isDestroyed() {
      return this.destroyed;
    },
    contentView: {
      children,
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
    },
    showInGlobalLayer: (view) => {
      layerShows.push(view.name);
      window.contentView.addChildView(view);
    },
    hideGlobalLayer: () => {
      layerHides.push(true);
      const current = views.at(-1);
      if (current) window.contentView.removeChildView(current);
    }
  });
  return {
    service,
    window,
    operations,
    children,
    views,
    broadcasts,
    layerShows,
    layerHides,
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
  assert.deepEqual(harness.operations.slice(0, 2), [
    { kind: 'bounds', name: 'search-1', bounds: viewBounds },
    { kind: 'add', name: 'search-1', bounds: viewBounds }
  ]);

  const preview = createView('pdf-preview', harness.operations);
  harness.window.contentView.addChildView(preview);
  assert.deepEqual(
    harness.children.map(({ name }) => name),
    ['search-1', 'pdf-preview']
  );
  // `raiseAfterPreviewAttach` is gone: the preview's own show re-sorts every layer, so nothing has
  // to call back here after it attaches. Re-showing re-asserts the order through the layer service.
  const beforeRaise = harness.operations.length;
  harness.service.show(host.hostToken, 'shell');
  assert.deepEqual(
    harness.children.map(({ name }) => name),
    ['pdf-preview', 'search-1']
  );
  assert.deepEqual(
    harness.operations.slice(beforeRaise).map(({ kind }) => kind),
    ['bounds', 'add'],
    'no detach — the documented reorder moves it'
  );

  // The overlay goes through the `global` layer; the layer service owns the order and the occlusion
  // of everything beneath it, so this view no longer raises or hides anything itself.
  // Shown once per raise — the load-settle re-raise counts — and never hidden while open.
  assert.equal(harness.layerShows.at(-1), 'search-1');
  assert.deepEqual(harness.layerHides, []);

  harness.service.close(host.hostToken, 'discard');
  assert.deepEqual(harness.layerHides, [true], 'closing releases the layer');
  assert.equal(harness.children.includes(view), false);
  assert.equal(view.webContents.destroyed, false);
  // Re-showing a warm overlay is synchronous: the renderer already exists, which is the whole point
  // of keeping it alive across close.
  assert.equal(harness.service.show(host.hostToken, 'shell'), view);
  assert.equal(harness.children.includes(view), true);
  assert.equal(harness.views.length, 1);
  harness.service.destroy();
  assert.equal(view.webContents.destroyed, true);
  // The extra `show` above re-broadcasts visibility; the ledger's shape is what matters — every
  // open is followed by exactly one close.
  assert.deepEqual(visibilityStates(harness.broadcasts), [true, true, false, true, false]);
  assert.deepEqual(visibilityRevisions(harness.broadcasts), [2, 2, 3, 4, 5]);
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
