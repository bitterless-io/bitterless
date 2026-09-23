/* eslint-disable @typescript-eslint/explicit-function-return-type */
// ══ 行为守卫 ══ 只有拥有那扇窗标题栏的 surface 才可以声明 `-webkit-app-region: drag`
//
// 契约:docs/issues/a-hidden-view-keeps-its-drag-region-and-eats-clicks.md
//
// 为什么需要守卫而不是靠自觉:Electron 把每一个挂进窗口的 `WebContentsView` 注册成
// draggable-region provider,`NativeWindow::NonClientHitTest()` 把它们**全部**问一遍 ——
// 不看可见性,也不看 z 序,第一个命中就返回 `HTCAPTION`。所以一个嵌进别人窗口的 surface 只要
// 声明了 drag,它就会在**整扇窗**的那块矩形上吃掉点击(拖得动、点不动),而且在它自己隐藏之后
// 依然如此。typecheck 看不见,视觉验收也看不见 —— 那块区域是透明的。
//
// 判据两条:
//  ① 声明 drag 的文件集合必须与下面这张表**逐字相等**。多一个 → 有人新加了 drag 区却没想过
//     它会不会被嵌;少一个 → 表过期了。两种都必须有人做一次判断,不能悄悄漂移。
//  ② 表里标了 `embedded` 的,那个修饰符必须在同一个文件里把 drag 改回 `no-drag`。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (relativePath) => readFileSync(join(projectRoot, relativePath), 'utf8');

/**
 * 每一个声明 `-webkit-app-region: drag` 的 renderer surface,以及它凭什么这么做。
 *
 * `windowOnly` = 这个 surface 只会作为一扇窗自己的 chrome 出现,drag 是它的本职。
 * `embedded`   = 它也会被装进别人的窗口(Maestro 的一格 tab、Omni 的一个 cell),那一态必须
 *                由这个修饰符改回 `no-drag`。
 */
const SURFACES = [
  {
    file: 'src/renderer/home/src/components/MenuBar/MenuBar.less',
    windowOnly: 'Bitterless 主窗自己的 menu bar'
  },
  {
    file: 'src/renderer/maestro/home/src/components/MenuBar/MenuBar.less',
    windowOnly: 'Maestro(Agent Browser)主窗的 78px chrome —— tab 条就是它的标题栏'
  },
  {
    file: 'src/renderer/omni/omniWindow/src/App.less',
    windowOnly: 'Omni Browser 主窗自己的 32px menu bar'
  },
  {
    file: 'src/renderer/onlypreview/shell/src/App.less',
    embedded: '.onlypreview-shell__menu-bar--embedded'
  },
  {
    file: 'src/renderer/todo/src/components/MenuBar/MenuBar.less',
    embedded: '.menubar--omni'
  },
  {
    file: 'src/renderer/coin/src/components/TrenchHeader/TrenchHeader.less',
    embedded: '.trench-header--embedded'
  },
  {
    file: 'src/renderer/eyesOnAgents/src/components/EyesOnAgentsMenuBar/EyesOnAgentsMenuBar.less',
    embedded: '.eyes-menu-bar--omni'
  },
  {
    file: 'src/renderer/submodules/src/components/SubmodulesMenuBar/SubmodulesMenuBar.less',
    embedded: '.submodules-menu-bar--omni'
  }
];

const declaresDrag = (source) => /-webkit-app-region:\s*drag/.test(source);

const ruleBody = (source, selector) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return source.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? null;
};

test('every renderer that declares a window-drag region is registered here', () => {
  // `git grep` 而不是自己走目录:.gitignore 里的产物(out/、vendor 打包件)会把这条判据淹掉。
  const found = execFileSync(
    'git',
    ['grep', '-l', '-E', '-e', '-webkit-app-region: *drag', '--', 'src/renderer'],
    { cwd: projectRoot, encoding: 'utf8' }
  )
    .split('\n')
    .filter(Boolean)
    .filter((path) => !path.includes('/vendor/'))
    .sort();
  const registered = SURFACES.map((surface) => surface.file).sort();
  assert.deepEqual(
    found,
    registered,
    'A renderer gained or lost a `-webkit-app-region: drag` region. Decide which it is — window chrome ' +
      '(windowOnly) or a surface that can be embedded in someone else\'s window (embedded + a no-drag ' +
      'modifier) — and register it. See docs/issues/a-hidden-view-keeps-its-drag-region-and-eats-clicks.md.'
  );
});

for (const surface of SURFACES) {
  if (!surface.embedded) continue;
  test(`${surface.file} gives up its drag region when embedded`, () => {
    const source = read(surface.file);
    assert.ok(declaresDrag(source), `${surface.file}: expected a drag region to guard`);
    const body = ruleBody(source, surface.embedded);
    assert.ok(body, `${surface.file}: missing the embedded modifier ${surface.embedded}`);
    assert.match(
      body,
      /-webkit-app-region:\s*no-drag/,
      `${surface.file}: ${surface.embedded} must set no-drag — embedded chrome is not the host window's ` +
        'title bar, and Electron asks every attached view for its drag region regardless of visibility.'
    );
  });
}

test('the OnlyPreview shell only claims the drag region when it owns the window', () => {
  const app = read('src/renderer/onlypreview/shell/src/App.vue');
  assert.match(
    app,
    /'onlypreview-shell__menu-bar--embedded':\s*!ownsWindow/,
    'App.vue must apply the embedded modifier whenever the shell is mounted in a host tab.'
  );
  assert.match(
    app,
    /const handleMenuBarDoubleClick[\s\S]{0,400}?if \(!ownsWindow\) return;/,
    'Double-clicking embedded chrome must not maximize the host window either.'
  );
});
