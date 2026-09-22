import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
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

// ── 源码断言:DevTools 的 host 窗**不许** parent 到主窗 ──────────────────────────────────────
//
// 这不是风格洁癖,是一条已经发生过的回归。`host.setParentWindow(mainWindow)` 是 macOS「DevTools
// 与主窗同一个 Space」唯一可行的实现,所以它非常容易被再次加回来 —— 而同一条 API 也让子窗随父窗
// **移动**、永远**压在父窗上面**、并且**自己不能被拖走**。Ral 2026-09-21 先报了一次「devtool 黏在
// 并覆盖在主窗口上、会随主窗一起被拖动」,2026-09-22 再报一次并把需求收窄成只保「同一块显示器」。
//
// 这条断言读源码而不是跑 Electron:整条锚定逻辑的行为需要真实窗口才能观察,而单测里没有窗口。
// 契约见 docs/features/maestro-devtools-follow-main-window.md #6。
test('the DevTools host window is never parented to the main window', () => {
  const source = readFileSync(new URL('../../src/main/maestro/windows/devtoolsAnchor.service.ts', import.meta.url), 'utf8');
  // 去掉注释:上面那段解释里就提到了 setParentWindow,不能让它把断言喂饱。
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  assert.equal(
    /setParentWindow|setVisibleOnAllWorkspaces/.test(code),
    false,
    'devtoolsAnchor.service.ts 不许 parent host 窗或钉 Space —— 那会让 DevTools 随主窗移动、' +
      '压在主窗上面、且自己不能被拖走(Ral 2026-09-21 / 09-22 两次报告)。要找回 Space 这一层,' +
      '得先找到一条不牺牲可拖动性的绑定方式。'
  );
  // 同时钉住落位这一半还在 —— 否则把 setBounds 一起删掉也能让上面那条通过。
  assert.ok(/host\.setBounds\(devToolsHostBounds\(/.test(code), 'placeHost 仍要按主窗所在显示器落位');
  // 以及:不跟着主窗跑。监听主窗 move 会把「拖主窗时 DevTools 一起动」原样带回来。
  assert.equal(/\.on\('move/.test(code) || /\.on\('moved/.test(code), false, '不许监听主窗 move');
});
