/* eslint-disable @typescript-eslint/explicit-function-return-type */
// 契约:docs/issues/inactive-window-chrome-has-no-hover-and-eats-the-first-click.md
//
// 后台 hover 的全部判据都在 `resolveInactiveHover()` 这一个纯函数里 —— 采样循环只负责取光标、
// 发事件。这里按表钉死边界:进条、静止、出条、窗口外、以及「`leave` 只发一次」。
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '../..');
const mocks = {
  electron: `
    export const screen = { getCursorScreenPoint: () => ({ x: 0, y: 0 }) };
  `
};

const bundled = await build({
  stdin: {
    contents: `
      export { resolveInactiveHover } from './src/main/maestro/windows/main/inactiveChromeHover.service.ts';
    `,
    resolveDir: root
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  write: false,
  tsconfig: resolve(root, 'tsconfig.node.json'),
  plugins: [
    {
      name: 'inactive-hover-native-boundary',
      setup(context) {
        context.onResolve({ filter: /.*/ }, ({ path }) =>
          Object.hasOwn(mocks, path) ? { path, namespace: 'inactive-hover-mock' } : undefined
        );
        context.onLoad({ filter: /.*/, namespace: 'inactive-hover-mock' }, ({ path }) => ({
          contents: mocks[path],
          loader: 'js'
        }));
      }
    }
  ]
});
const encoded = Buffer.from(bundled.outputFiles[0].text).toString('base64');
const { resolveInactiveHover } = await import(`data:text/javascript;base64,${encoded}`);

// 一扇内容区在屏幕 (100, 200) 的窗口,1000x800,顶部 78px 是 chrome。
const content = { x: 100, y: 200, width: 1000, height: 800 };
const chromeHeight = 78;
const at = (x, y, previous = null) =>
  resolveInactiveHover({ cursor: { x, y }, content, chromeHeight, previous });

test('a cursor inside the chrome band reports the content-area point', () => {
  assert.deepEqual(at(340, 220), { kind: 'move', point: { x: 240, y: 20 } });
});

test('a cursor that has not moved costs nothing', () => {
  assert.deepEqual(at(340, 220, { x: 240, y: 20 }), { kind: 'none' });
  assert.deepEqual(at(341, 220, { x: 240, y: 20 }), { kind: 'move', point: { x: 241, y: 20 } });
});

test('leaving the chrome band clears the hover exactly once', () => {
  // 下到操作区:那是另一个 webContents,chrome 这边要收掉 hover。
  const left = at(340, 400, { x: 240, y: 20 });
  assert.deepEqual(left, { kind: 'leave', point: { x: 240, y: 20 } });
  // `previous` 被采样循环清成 null 之后就不再重复发。
  assert.deepEqual(at(340, 400, null), { kind: 'none' });
});

test('a cursor outside the window is not hover, and never was', () => {
  assert.deepEqual(at(50, 220), { kind: 'none' });
  assert.deepEqual(at(2000, 220), { kind: 'none' });
  assert.deepEqual(at(340, 100), { kind: 'none' });
  assert.deepEqual(at(50, 220, { x: 240, y: 20 }), { kind: 'leave', point: { x: 240, y: 20 } });
});

test('the band is clamped to the content height and disabled when there is no chrome', () => {
  assert.deepEqual(
    resolveInactiveHover({ cursor: { x: 340, y: 220 }, content, chromeHeight: 0, previous: null }),
    { kind: 'none' }
  );
  assert.deepEqual(
    resolveInactiveHover({
      cursor: { x: 340, y: 210 },
      content: { ...content, height: 5 },
      chromeHeight,
      previous: null
    }),
    { kind: 'none' }
  );
});

test('the top-left pixel of the chrome is inside, the first operation-area row is not', () => {
  assert.deepEqual(at(100, 200), { kind: 'move', point: { x: 0, y: 0 } });
  assert.deepEqual(at(340, 277), { kind: 'move', point: { x: 240, y: 77 } });
  assert.deepEqual(at(340, 278), { kind: 'none' });
});
