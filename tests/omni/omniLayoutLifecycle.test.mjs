/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  OMNI_BROWSER_HEADER_HEIGHT,
  OMNI_LAYOUT_DIVIDER_SIZE,
  OmniLayoutCommitQueue,
  flattenOmniPaneTreePixels,
  removeOmniPaneTree,
  resolveOmniCellViewBounds,
  splitOmniPaneTree
} from '../../src/shared/omni/omniLayout.service.ts';
import {
  SETTING_SERIALIZED_VALUE_MAX_BYTES,
  serializeSettingValue
} from '../../src/shared/setting/settingValue.service.ts';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

const leaf = (id, contentMode = 'browser') => ({
  id,
  type: 'leaf',
  url: `https://${id}.example.com`,
  contentMode,
  miniAppId: 'todo'
});

const initialTree = () => ({
  id: 'vertical-root',
  type: 'split',
  direction: 'v',
  sizes: [35, 65],
  children: [
    {
      id: 'top-horizontal',
      type: 'split',
      direction: 'h',
      sizes: [45, 55],
      children: [leaf('top-left'), leaf('top-right')]
    },
    {
      id: 'bottom-horizontal',
      type: 'split',
      direction: 'h',
      sizes: [30, 70],
      children: [leaf('bottom-left'), leaf('bottom-right', 'miniapp')]
    }
  ]
});

const twoColumnTree = () => ({
  id: 'horizontal-root',
  type: 'split',
  direction: 'h',
  sizes: [38, 62],
  children: [
    {
      id: 'left-vertical',
      type: 'split',
      direction: 'v',
      sizes: [40, 60],
      children: [leaf('left-top'), leaf('left-bottom')]
    },
    {
      id: 'right-vertical',
      type: 'split',
      direction: 'v',
      sizes: [30, 70],
      children: [leaf('right-top'), leaf('right-bottom')]
    }
  ]
});

const pixelGeometry = (tree) =>
  flattenOmniPaneTreePixels(tree, {
    x: 0,
    y: 32,
    width: 1000,
    height: 568
  }).map(({ id, x, y, width, height }) => ({ id, x, y, width, height }));

const rightColumnGeometry = (tree) =>
  pixelGeometry(tree).filter(({ id }) => id.startsWith('right-'));

const collapseTopBranch = () => {
  const first = removeOmniPaneTree(initialTree(), 'top-left');
  assert.equal(first.changed, true);
  assert.equal(first.tree?.type, 'split');
  assert.equal(first.tree?.direction, 'v');
  assert.equal(first.tree?.children?.[0].id, 'top-right');

  const second = removeOmniPaneTree(first.tree, 'top-right');
  assert.equal(second.changed, true);
  assert.ok(second.tree);
  return second.tree;
};

test('closing a complete top branch promotes the horizontal child without parent sizes', () => {
  const promoted = collapseTopBranch();
  assert.equal(promoted.id, 'bottom-horizontal');
  assert.equal(promoted.direction, 'h');
  assert.deepEqual(promoted.sizes, [30, 70]);
  assert.deepEqual(
    promoted.children.map(({ id }) => id),
    ['bottom-left', 'bottom-right']
  );

  const cells = flattenOmniPaneTreePixels(promoted, {
    x: 0,
    y: 32,
    width: 1000,
    height: 568
  });
  assert.deepEqual(
    cells.map(({ id, x, y, width, height }) => ({ id, x, y, width, height })),
    [
      { id: 'bottom-left', x: 0, y: 32, width: 299, height: 568 },
      { id: 'bottom-right', x: 303, y: 32, width: 697, height: 568 }
    ]
  );
  assert.equal(cells[1].x - (cells[0].x + cells[0].width), OMNI_LAYOUT_DIVIDER_SIZE);
});

test('split above and below after root promotion keep both axes mapped independently', () => {
  const promoted = collapseTopBranch();
  const above = splitOmniPaneTree(promoted, 'bottom-left', {
    direction: 'v',
    position: 'before',
    splitId: 'left-vertical',
    newLeaf: leaf('new-above')
  });
  assert.equal(above.changed, true);
  assert.ok(above.tree);

  const aboveCells = flattenOmniPaneTreePixels(above.tree, {
    x: 0,
    y: 32,
    width: 1000,
    height: 568
  });
  assert.deepEqual(
    aboveCells.map(({ id, x, y, width, height }) => ({ id, x, y, width, height })),
    [
      { id: 'new-above', x: 0, y: 32, width: 299, height: 282 },
      { id: 'bottom-left', x: 0, y: 318, width: 299, height: 282 },
      { id: 'bottom-right', x: 303, y: 32, width: 697, height: 568 }
    ]
  );

  const below = splitOmniPaneTree(promoted, 'bottom-left', {
    direction: 'v',
    position: 'after',
    splitId: 'left-vertical',
    newLeaf: leaf('new-below')
  });
  assert.ok(below.tree);
  const belowCells = flattenOmniPaneTreePixels(below.tree, {
    x: 0,
    y: 32,
    width: 1000,
    height: 568
  });
  assert.deepEqual(
    belowCells.map(({ id, x, y, width, height }) => ({ id, x, y, width, height })),
    [
      { id: 'bottom-left', x: 0, y: 32, width: 299, height: 282 },
      { id: 'new-below', x: 0, y: 318, width: 299, height: 282 },
      { id: 'bottom-right', x: 303, y: 32, width: 697, height: 568 }
    ]
  );
});

test('collapsing and re-splitting the left column never changes the untouched right column', () => {
  const initial = twoColumnTree();
  const expectedRight = [
    { id: 'right-top', x: 382, y: 32, width: 618, height: 169 },
    { id: 'right-bottom', x: 382, y: 205, width: 618, height: 395 }
  ];
  assert.deepEqual(rightColumnGeometry(initial), expectedRight);

  const closedTop = removeOmniPaneTree(initial, 'left-top');
  assert.ok(closedTop.tree);
  assert.deepEqual(closedTop.tree.sizes, [38, 62]);
  assert.deepEqual(
    closedTop.tree.children.map(({ id }) => id),
    ['left-bottom', 'right-vertical']
  );
  assert.deepEqual(rightColumnGeometry(closedTop.tree), expectedRight);

  const splitAbove = splitOmniPaneTree(closedTop.tree, 'left-bottom', {
    direction: 'v',
    position: 'before',
    splitId: 'replacement-left-vertical',
    newLeaf: leaf('new-left-top')
  });
  assert.ok(splitAbove.tree);
  assert.deepEqual(splitAbove.tree.sizes, [38, 62]);
  assert.deepEqual(rightColumnGeometry(splitAbove.tree), expectedRight);

  const closedReplacement = removeOmniPaneTree(splitAbove.tree, 'new-left-top');
  assert.ok(closedReplacement.tree);
  assert.deepEqual(closedReplacement.tree.sizes, [38, 62]);
  assert.deepEqual(rightColumnGeometry(closedReplacement.tree), expectedRight);
});

test('browser and mini-app headers change only inner content bounds', () => {
  const outer = { x: 303, y: 32, width: 697, height: 568 };
  const browser = resolveOmniCellViewBounds(outer, OMNI_BROWSER_HEADER_HEIGHT);
  assert.deepEqual(browser, {
    header: { x: 303, y: 32, width: 697, height: 36 },
    content: { x: 303, y: 68, width: 697, height: 532 }
  });

  const miniApp = resolveOmniCellViewBounds(outer, 0);
  assert.deepEqual(miniApp, {
    header: null,
    content: outer
  });
});

test('layout commits cannot interleave apply and persistence across structural operations', async () => {
  const queue = new OmniLayoutCommitQueue();
  const order = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });

  const first = queue.enqueue(async () => {
    order.push('apply-first');
    await firstGate;
    order.push('persist-first');
  });
  await Promise.resolve();

  const second = queue.enqueue(async () => {
    order.push('apply-second');
    order.push('persist-second');
  });
  await Promise.resolve();
  assert.deepEqual(order, ['apply-first']);

  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(order, ['apply-first', 'persist-first', 'apply-second', 'persist-second']);
});

test('setting persistence preserves layouts beyond the former 10k truncation boundary', () => {
  const value = { layout: 'x'.repeat(12_000) };
  const serialized = serializeSettingValue(value);
  assert.deepEqual(JSON.parse(serialized), value);
  assert.throws(
    () => serializeSettingValue('x'.repeat(SETTING_SERIALIZED_VALUE_MAX_BYTES)),
    RangeError
  );
  assert.throws(
    () => serializeSettingValue('界'.repeat(Math.floor(SETTING_SERIALIZED_VALUE_MAX_BYTES / 3))),
    RangeError
  );
});

test('renderer remounts after structural changes and rejects lifecycle resize writes', () => {
  const appSource = read('src/renderer/omni/omniControl/src/App.vue');
  const paneSource = read('src/renderer/omni/omniControl/src/components/OmniPane.vue');
  const storeSource = read('src/renderer/omni/omniControl/src/store/layout.store.ts');
  const toolbarStyle = read('src/renderer/omni/omniControl/src/components/OmniPaneMenuBar.less');
  const mainSource = read('src/main/windows/omniWindow.helper.ts');
  const handlerSource = read('src/main/xpc/omniWindow.handler.ts');
  const settingDaoSource = read('src/preload/sqlite/dao/setting.dao.ts');

  assert.match(appSource, /:key="layoutStore\.structureRevision"/);
  assert.match(storeSource, /structureRevision \+= 1;/);
  assert.match(storeSource, /sizes\.length !== found\.children\?\.length/);
  assert.match(paneSource, /const onResizeEnd = async[\s\S]*?if \(!isMounted\.value\) return;/);
  assert.match(paneSource, /if \(!event\?\.event\) return;/);
  assert.match(
    paneSource,
    /const handleClose = async[\s\S]*?layoutStore\.structureChanging = true/
  );
  assert.match(paneSource, /await layoutStore\.syncLayout\(\);[\s\S]*?finally \{/);
  assert.match(toolbarStyle, /flex: 0 0 36px;/);
  assert.match(toolbarStyle, /height: 36px;/);
  assert.match(mainSource, /cell\.menubar \? OMNI_BROWSER_HEADER_HEIGHT : 0/);
  assert.match(mainSource, /private readonly layoutCommitQueue = new OmniLayoutCommitQueue\(\)/);
  assert.match(mainSource, /commitLayout[\s\S]*?await this\.persistLayoutToDao\(\)/);
  assert.match(mainSource, /xpcMain\.broadcast\(OMNI_LAYOUT_SNAPSHOT_EVENT, config\)/);
  assert.match(storeSource, /OmniWindowHandler\/commitLayout/);
  assert.ok(!/syncLayout[\s\S]*?OmniWindowHandler\/saveLayout/.test(storeSource));
  assert.doesNotMatch(storeSource, /removeNodeFromTree/);
  assert.doesNotMatch(storeSource, /OmniWindowHandler\/saveLayout/);
  assert.match(handlerSource, /async commitLayout[\s\S]*?omniWindowHelper\.commitLayout/);
  assert.doesNotMatch(handlerSource, /async saveLayout/);
  assert.match(
    handlerSource,
    /return omniWindowHelper\.getLayoutConfig\(\) \?\?\s*await settingEmitter\.get/
  );
  assert.match(settingDaoSource, /serializeSettingValue\(params\.value\)/);
  assert.doesNotMatch(settingDaoSource, /sanitizeValue/);
});
