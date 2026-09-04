/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, test } from 'node:test';
import { build } from 'esbuild';

const projectRoot = resolve(dirname(new URL(import.meta.url).pathname), '..', '..');
const buildRoot = mkdtempSync(join(tmpdir(), 'bitterless-onlypreview-view-layer-'));
const bundlePath = join(buildRoot, 'layers.mjs');

await build({
  entryPoints: [join(projectRoot, 'src/main/onlypreview/views/onlyPreviewViewLayer.service.ts')],
  outfile: bundlePath,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  tsconfig: join(projectRoot, 'tsconfig.node.json')
});

const { OnlyPreviewViewLayerService, ONLY_PREVIEW_VIEW_LAYER_ORDER } = await import(
  pathToFileURL(bundlePath).href
);

after(() => rmSync(buildRoot, { recursive: true, force: true }));

const createView = (name) => ({
  name,
  visible: true,
  destroyed: false,
  webContents: { isDestroyed: () => false },
  setVisible(visible) {
    this.visible = visible;
  }
});

// The layers are children of the composite's container `View`, not of the window: a plain `View`
// parents a `WebContentsView` and reorders a child it already contains exactly as a window's
// `contentView` does (measured on Electron 40.10.6), so the stub is the same shape one level down.
const createContainer = () => {
  const order = [];
  return {
    order,
    addChildView(view) {
      const current = order.indexOf(view);
      if (current >= 0) order.splice(current, 1);
      order.push(view);
    }
  };
};

const harness = () => {
  const service = new OnlyPreviewViewLayerService();
  const container = createContainer();
  service.start(container);
  return { service, container, names: () => container.order.map(({ name }) => name) };
};

test('the layer order is fixed and the sort re-adds every shown view lowest first', () => {
  assert.deepEqual([...ONLY_PREVIEW_VIEW_LAYER_ORDER], ['base', 'main', 'global', 'alert']);
  const { service, names } = harness();
  const shell = createView('shell');
  const preview = createView('preview');
  const search = createView('search');

  assert.equal(service.show('base', 'shell', shell), true);
  assert.equal(service.show('main', 'preview', preview), true);
  assert.deepEqual(names(), ['shell', 'preview']);

  assert.equal(service.show('global', 'globalSearch', search), true);
  assert.deepEqual(names(), ['shell', 'preview', 'search']);

  // The whole point: showing a lower layer while a higher one is up must NOT raise it above.
  // A single `addChildView` on the changed view would; a full re-sort does not.
  const nextPreview = createView('preview-2');
  assert.equal(service.show('main', 'preview', nextPreview), true);
  assert.deepEqual(names().slice(-3), ['shell', 'preview-2', 'search']);
  // The outgoing view stays attached until its own teardown closes it, so it is hidden — otherwise
  // the previous document would show through underneath the new one.
  assert.equal(preview.visible, false);
});

test('a layer is held by an owner, so an owner may swap its own view but not take another\'s', () => {
  const { service, names } = harness();
  const search = createView('search');
  const settings = createView('settings');
  service.show('base', 'shell', createView('shell'));

  // Switching from one PDF to the next, or from the Vue surface to the Chrome one, is the same
  // owner replacing its own view — it must never be refused, or the preview would stop updating.
  const pdfOne = createView('pdf-1');
  const pdfTwo = createView('pdf-2');
  assert.equal(service.show('main', 'preview', pdfOne), true);
  assert.equal(service.show('main', 'preview', pdfTwo), true);
  assert.deepEqual(names().slice(-2), ['shell', 'pdf-2']);
  assert.deepEqual([pdfOne.visible, pdfTwo.visible], [false, true]);

  assert.equal(service.show('global', 'globalSearch', search), true);
  // A different owner in an occupied layer is refused and changes nothing at all.
  assert.equal(service.show('global', 'settings', settings), false);
  assert.equal(service.ownerOf('global'), 'globalSearch');
  assert.deepEqual(names().slice(-3), ['shell', 'pdf-2', 'search']);
  assert.equal(settings.visible, true, 'a refused show must not touch the view it refused');

  // Releasing it lets the other owner in.
  service.hide('global', 'globalSearch');
  assert.equal(service.ownerOf('global'), null);
  assert.equal(service.show('global', 'settings', settings), true);
  assert.deepEqual(names().slice(-3), ['shell', 'pdf-2', 'settings']);
});

test('no layer hides another — the overlay is transparent by design', () => {
  const { service } = harness();
  const shell = createView('shell');
  const preview = createView('preview');
  const search = createView('search');
  service.show('base', 'shell', shell);
  service.show('main', 'preview', preview);

  // The Global Search view is created with `setBackgroundColor('#00000000')` and its panel floats
  // inside a transparent canvas with a gutter, so the project rail and the preview are *supposed*
  // to stay visible around it. An earlier version had `global` hide everything beneath it, which
  // turned the overlay into an opaque sheet that blanked the window — the owner caught it.
  service.show('global', 'globalSearch', search);
  assert.deepEqual([shell.visible, preview.visible, search.visible], [true, true, true]);

  service.hide('global', 'globalSearch');
  assert.deepEqual([shell.visible, preview.visible], [true, true]);
  assert.equal(search.visible, false, 'a released layer hides its own view');
});

test('hide is scoped to its owner, and a destroyed view is dropped rather than thrown on', () => {
  const { service, names } = harness();
  const search = createView('search');
  service.show('base', 'shell', createView('shell'));
  service.show('global', 'globalSearch', search);

  // Another owner cannot release a layer it does not hold.
  service.hide('global', 'settings');
  assert.equal(service.ownerOf('global'), 'globalSearch');

  const dead = createView('dead');
  dead.webContents.isDestroyed = () => true;
  service.show('main', 'preview', dead);
  assert.equal(service.ownerOf('main'), null, 'a destroyed view holds nothing');
  assert.deepEqual(names(), ['shell', 'search']);

  // A layer whose view dies after being shown is dropped on the next sort, not re-added.
  const preview = createView('preview');
  service.show('main', 'preview', preview);
  preview.webContents.isDestroyed = () => true;
  service.resort();
  assert.equal(service.ownerOf('main'), null);
});

test('the sort is idempotent and does nothing without a container', () => {
  const { service, container, names } = harness();
  service.show('base', 'shell', createView('shell'));
  service.show('main', 'preview', createView('preview'));
  const before = names();
  service.resort();
  service.resort();
  assert.deepEqual(names(), before);

  // `View` has no `isDestroyed()`, so teardown is expressed by the container going away rather than
  // by asking it whether it is still alive. After `stop()` the sort must touch nothing.
  service.stop();
  service.resort();
  assert.equal(service.ownerOf('base'), null);
  assert.deepEqual(container.order.map(({ name }) => name), before, 'a stopped sort re-adds nothing');
});

test('OnlyPreview child-view stacking lives in exactly one file', () => {
  const source = (path) => readFileSync(join(projectRoot, path), 'utf8');
  // A view that raises itself is what broke this three times: the correct order was maintained by
  // one service calling another back after the fact, and any attach path that missed the callback
  // left the overlay buried. Only the layer service may add a child view.
  assert.match(
    source('src/main/onlypreview/views/onlyPreviewViewLayer.service.ts'),
    /container\.addChildView\(occupant\.view\)/
  );
  for (const path of [
    'src/main/onlypreview/views/onlyPreviewPreviewView.service.ts',
    'src/main/onlypreview/views/onlyPreviewGlobalSearchView.service.ts'
  ]) {
    assert.doesNotMatch(source(path), /contentView\.addChildView\(/, `${path} must not raise views`);
  }
  // The window helper attaches the composite's container to its host — one call, and never a layer.
  // Attaching the whole surface is not raising a view inside it, which is what this file forbids.
  const helper = source('src/main/windows/onlyPreviewWindow.helper.ts');
  assert.deepEqual(
    helper.match(/contentView\.addChildView\([^)]*\)/g),
    ['contentView.addChildView(surfaceContainer)'],
    'the helper may attach only the surface container'
  );
  // And nothing may reach back into the overlay to re-raise it after a preview attach.
  for (const path of [
    'src/main/onlypreview/views/onlyPreviewPreviewView.service.ts',
    'src/main/onlypreview/views/onlyPreviewPreviewRegion.service.ts',
    'src/main/onlypreview/views/onlyPreviewGlobalSearchView.service.ts',
    'src/main/onlypreview/views/onlyPreviewGlobalSearchWindow.service.ts',
    'src/main/windows/onlyPreviewWindow.helper.ts'
  ]) {
    assert.doesNotMatch(source(path), /raiseAfterPreviewAttach|onActiveViewAttached\s*[(:]/);
  }
});
