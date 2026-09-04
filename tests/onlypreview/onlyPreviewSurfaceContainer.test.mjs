import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';

const projectRoot = resolve(dirname(new URL(import.meta.url).pathname), '..', '..');
const source = (relativePath) => readFileSync(join(projectRoot, relativePath), 'utf8');
// These files carry long "why" comments that quote the code they replaced, so an assertion about
// what the code does must not read the history above it.
const code = (relativePath) =>
  source(relativePath)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

const HELPER = 'src/main/windows/onlyPreviewWindow.helper.ts';
const LAYERS = 'src/main/onlypreview/views/onlyPreviewViewLayer.service.ts';

test('the composite is parented by its own container, not by the window', () => {
  const layers = source(LAYERS);
  // The layer service must know nothing about windows: its parent is a `View`, so the same
  // algorithm works whether that view fills a window or a region of somebody else's window.
  assert.match(layers, /start\(container: View\): void/);
  assert.match(layers, /container\.addChildView\(occupant\.view\)/);
  const layerCode = code(LAYERS);
  assert.doesNotMatch(layerCode, /BaseWindow/, 'the layer service must not depend on a window type');
  assert.doesNotMatch(
    layerCode,
    /contentView/,
    'the layer service must not reach for a window content view'
  );
});

test('the container is attached before anything sorts into it', () => {
  const helper = source(HELPER);
  const attach = helper.indexOf('contentView.addChildView(surfaceContainer)');
  const start = helper.indexOf('onlyPreviewViewLayerService.start(surfaceContainer)');
  assert.ok(attach > 0, 'the helper must attach the surface container');
  assert.ok(start > 0, 'the layer service must be started on the container');
  // A first sort into a container that is not yet in the window would attach the shell to a view
  // with no parent, which paints nothing and gives no error.
  assert.ok(attach < start, 'the container must reach the window before the first sort');
  assert.doesNotMatch(
    helper,
    /onlyPreviewViewLayerService\.start\(window\)/,
    'the layer service must never be started on a window again'
  );
});

test('one detach releases the whole composite', () => {
  const helper = source(HELPER);
  // The layers are children of the container, so teardown removes the container and they go with
  // it. Removing the shell alone would leave the container — and any overlay still in it — attached.
  assert.match(helper, /removeChildView\(surfaceContainer\)/);
  assert.deepEqual(
    helper.match(/removeChildView\([^)]*\)/g),
    ['removeChildView(surfaceContainer)'],
    'the helper must detach only the surface container'
  );
  assert.match(helper, /this\.surfaceContainer = null;/);
});

test('exactly one place turns a window into a surface size', () => {
  const helper = source(HELPER);
  // `syncSurfaceBounds` is the seam a non-window host replaces. If a second place sized the
  // container from `getContentSize()`, an embedded surface would silently keep window geometry.
  assert.match(helper, /private syncSurfaceBounds\(\): \{ width: number; height: number \} \| null/);
  assert.deepEqual(
    helper.match(/container\?\.setBounds\(|surfaceContainer\.setBounds\(/g),
    ['container?.setBounds('],
    'only syncSurfaceBounds may size the container'
  );
});
