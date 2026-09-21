import assert from 'node:assert/strict';
import test from 'node:test';
import { devToolsHostBounds } from '../../src/main/maestro/windows/devtoolsPlacement.ts';

// docs/features/maestro-devtools-follow-main-window.md #4.
const laptop = { x: 0, y: 25, width: 1512, height: 920 };
// A secondary display sitting LEFT of the primary one — negative origin, the case that
// broke restored window geometry before (window.helper.ts) and would break naive math here.
const secondary = { x: -2560, y: -300, width: 2560, height: 1415 };
const tiny = { x: 0, y: 0, width: 800, height: 600 };

const inside = (rect, workArea) =>
  rect.x >= workArea.x &&
  rect.y >= workArea.y &&
  rect.x + rect.width <= workArea.x + workArea.width &&
  rect.y + rect.height <= workArea.y + workArea.height;

test('every host lands inside the anchor display work area', () => {
  for (const workArea of [laptop, secondary, tiny]) {
    for (let index = 0; index < 20; index += 1) {
      const rect = devToolsHostBounds({ workArea, index });
      assert.ok(inside(rect, workArea), `index ${index} escaped ${JSON.stringify(workArea)}: ${JSON.stringify(rect)}`);
    }
  }
});

test('the first host sits in the work area top-right corner', () => {
  const rect = devToolsHostBounds({ workArea: secondary, index: 0 });
  assert.equal(rect.y, secondary.y + 24);
  assert.equal(rect.x + rect.width, secondary.x + secondary.width - 24);
});

test('each further host is offset so two DevTools never fully overlap', () => {
  const first = devToolsHostBounds({ workArea: laptop, index: 0 });
  const second = devToolsHostBounds({ workArea: laptop, index: 1 });
  assert.notDeepEqual({ x: first.x, y: first.y }, { x: second.x, y: second.y });
  assert.equal(second.x, first.x - 28);
  assert.equal(second.y, first.y + 28);
});

test('the offset wraps instead of walking off the display', () => {
  const base = devToolsHostBounds({ workArea: laptop, index: 0 });
  const wrapped = devToolsHostBounds({ workArea: laptop, index: 6 });
  assert.deepEqual(wrapped, base);
});

test('a small display gets a host that still fits', () => {
  const rect = devToolsHostBounds({ workArea: tiny, index: 0 });
  assert.ok(rect.width <= tiny.width - 48, `width ${rect.width} does not fit ${tiny.width}`);
  assert.ok(rect.height <= tiny.height - 48, `height ${rect.height} does not fit ${tiny.height}`);
  assert.ok(rect.width > 0 && rect.height > 0);
});
