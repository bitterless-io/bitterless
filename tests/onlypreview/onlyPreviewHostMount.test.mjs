import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import test, { describe } from 'node:test';
import { build } from 'esbuild';

const root = resolvePath(import.meta.dirname, '../..');
const read = (path) => readFileSync(resolvePath(root, path), 'utf8');

/**
 * 「上次是 tab 就 tab,上次是窗口就窗口」(Ral 2026-09-09)。
 *
 * 位置/尺寸/所在屏幕本来就已经持久化了(`windowStateService` 的 `'onlypreview'` 键),这一条只管
 * **哪一种承载**。判定是纯的,所以跑真输入;接线那一半只能源码守卫,但守的都是「不这么写就静默退化」
 * 的地方 —— 漏了不会报错,只会变成「每次都开 tab」或「切换成功了但下次没记住」。
 */
const compiled = await build({
  stdin: {
    contents:
      "export { readOnlyPreviewHostMount, rememberOnlyPreviewHostMount } from './src/main/miniapps/onlypreview/onlyPreviewHostMount.service.ts';",
    resolveDir: root
  },
  bundle: true, write: false, platform: 'node', format: 'esm', target: 'node22',
  tsconfig: resolvePath(root, 'tsconfig.node.json'),
  external: ['electron', 'electron-xpc/main']
});
void compiled;

describe('承载偏好的存取', () => {
  const source = read('src/main/miniapps/onlypreview/onlyPreviewHostMount.service.ts');

  test('默认是 tab —— 没有记录时保持工作区芯片一直以来的行为', () => {
    assert.match(source, /DEFAULT_HOST_MOUNT: OnlyPreviewHostMountPreference = 'tab'/);
  });

  test('认识的两个值之外一律落默认 —— 存坏了不该把 OnlyPreview 打不开', () => {
    assert.match(source, /value === 'window' \|\| value === 'tab' \? value : DEFAULT_HOST_MOUNT/);
  });

  test('读失败不外抛,公开读函数落默认 —— 一个状态位不该让「打开」这件事失败', () => {
    // 存储那一层的 catch 返回 `null`(「不知道」),由公开读函数把它变成默认值 —— 两者刻意分开:
    // `peek` 需要能表达"还不知道",而调用方需要一个能用的值。
    assert.match(source, /const readStoredHostMount[\s\S]*?catch \{\s*return null;\s*\}/);
    assert.match(source, /return stored \?\? DEFAULT_HOST_MOUNT;/);
    // 行为本身在 micromeet-cowork 的 `tests/unit/onlyPreviewHostMount.test.mjs` 里用 stub 真跑
    // (本仓这份是 esbuild 打包加载,`settingEmitter` 在模块加载时就建好了,替不掉)。
  });

  test('写是 fire-and-forget 且吞掉异常 —— 切换已经成功了,写不进去不该报成失败', () => {
    const remember = source.slice(source.indexOf('export const rememberOnlyPreviewHostMount'));
    assert.match(remember, /void \(async \(\) => \{/);
    assert.match(remember, /catch \{/);
    assert.doesNotMatch(remember, /throw/);
  });

  test('不写进 OnlyPreviewSettings —— 那个 parser 严格,加字段会把已存记录静默重置', () => {
    // 检的是**代码**,不是注释:文件头那段注释正是在解释「为什么不用它」,所以它必须提到那个名字。
    const code = source.replace(/\/\*\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.doesNotMatch(code, /parseOnlyPreviewSettings|onlyPreviewSettingsService/);
    assert.doesNotMatch(code, /^import[^\n]*onlyPreview\.contract/m);
    // 自己的键,和设置那一份不共用
    assert.match(source, /HOST_MOUNT_KEY = 'onlypreview_host'/);
    assert.doesNotMatch(code, /'onlypreview_settings'/);
  });
});

describe('接线', () => {
  test('host toggle 记的是**结算之后**那一种,不是意图', () => {
    const toggle = read('src/main/windows/onlyPreviewHostToggle.service.ts');
    assert.match(
      toggle,
      /rememberOnlyPreviewHostMount\(settledKind === 'standalone' \? 'window' : 'tab'\)/,
      '记 destinationKind 的话,一次回退过的切换会把下次默认记错'
    );
  });

  /**
   * 关窗升格也是 `'tab'` 的写入方之一(方案 #5.1)。
   *
   * 不写的话:关掉独立窗口,内容回到了 tab,而偏好还是 `'window'` —— 下一次点工作区芯片又弹一个
   * 窗口,读起来像「刚才那一下没回来」。落定的承载就是真相,和 `relocate` 结算之后那一处同一条口径。
   */
  test('关窗升格写的是 tab —— 偏好留在 window 的话下次点芯片又弹窗口', () => {
    const toggle = read('src/main/windows/onlyPreviewHostToggle.service.ts');
    const promote = toggle.slice(toggle.indexOf('async promoteDeferredTab('));
    assert.ok(promote, '缺 promoteDeferredTab —— 关窗回收没有落点');
    assert.match(promote.slice(0, promote.indexOf('\n  }\n')), /rememberOnlyPreviewHostMount\('tab'\)/);
  });

  test('打开入口先问已有承载,再问上次那一种', () => {
    const opener = read('src/main/windows/onlyPreviewMaestroOpener.ts');
    const standaloneAt = opener.indexOf('getStandaloneHost()');
    const preferenceAt = opener.indexOf('readOnlyPreviewHostMount()');
    assert.ok(standaloneAt > -1, '缺「已有独立窗口就复用」');
    assert.ok(preferenceAt > -1, '缺「按上次那一种开」');
    assert.ok(
      standaloneAt < preferenceAt,
      '顺序反了:承载已经在了却还去读偏好,可能开出第二个 OnlyPreview'
    );
  });
});
