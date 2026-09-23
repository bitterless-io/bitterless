import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

/**
 * **agent 说「给你看」时,tab 必须出现在人眼前 —— 而不是 Workbench 底下。**
 *
 * 2026-09-23 实录(BL Preview 会话 `2n6mbjo9h5hmudg8q41`):用户说「打开 type safe 的页面,然后让我
 * 看一下它的充值方式」,模型调了 `activate_tab {"tab_id":"tab-8","show":"true"}` —— 判断和参数都对,
 * 工具也报 tab-8 `active: true`,可屏幕上始终是 Workbench。
 *
 * 根因:Workbench 是盖在操作区上的前台 VIEW,不是 OperationTab,`activateTab()` 不会把它收起来。
 * 人走的每条路都先 `backgroundWorkbenchTab()` 再激活;agent 的 `activate_tab {show}`、`open_tab {show}`
 * 与聊天里的「查看这个 tab」三条路都漏了。
 *
 * 见 docs/issues/agent-show-tab-hidden-behind-workbench.md。
 */
const ROOT = resolve(import.meta.dirname, '../..');
const read = (path) => readFileSync(join(ROOT, path), 'utf8');
const controller = read('src/main/maestro/windows/main/maestroWindow.controller.ts');
const browser = read('src/main/maestro/windows/main/maestroBrowserView.service.ts');

const body = (source, signature) => {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, `找不到 ${signature}`);
  return source.slice(start, source.indexOf('\n  }\n', start) + 4);
};

test('「给人看」只有一个入口,而且先退 Workbench、再激活', () => {
  const show = body(controller, 'private async showTabToHuman(id: string)');
  const back = show.indexOf('this.workbenchView.backgroundTab()');
  const activate = show.indexOf('await this.activateTab({ id })');
  assert.ok(back > 0 && activate > back, '顺序反了等于没退:tab 先在 Workbench 底下被激活');
});

test('activate_tab 的 show 分支走这个入口,不再直接 activateTab', () => {
  assert.match(controller, /if \(args\.show === true \|\| args\.show === 'true'\) await this\.showTabToHuman\(id\)/);
  assert.doesNotMatch(controller, /if \(args\.show === true \|\| args\.show === 'true'\) await this\.activateTab\(/,
    '本次现场的原形:tab 模型切了,屏幕没切');
});

test('聊天里「查看这个 tab」也走它,而且自检看的是屏幕', () => {
  const show = body(controller, 'async showAgentBrowserTab(');
  assert.match(show, /await this\.showTabToHuman\(params\.tabId\)/);
  assert.match(show, /this\.isShownToHuman\(params\.tabId\)/, '只比 activeTabId,Workbench 盖着时照样相等,会报假的 ok');
  assert.match(controller, /return this\.activeTabId === id && !this\.workbenchView\.isVisible\(\)/);
});

test('open_tab 带 show 时同样先退 Workbench', () => {
  const open = body(browser, 'async openAgentTab(');
  const back = open.indexOf('await this._state.backgroundWorkbenchTab()');
  const activate = open.indexOf('await this.activateTab({ id: tab.id })');
  assert.ok(back > 0 && activate > back, '新 tab 开在 Workbench 底下,人同样什么都看不到');
});

test('activateTab() 本身不碰 Workbench —— drill / 后台加载 / 回放不该把人从 Workbench 里拽出来', () => {
  const activate = body(browser, 'async activateTab(params: { id: string; deferNavigation?: boolean })');
  assert.doesNotMatch(activate, /backgroundWorkbenchTab/, '接口注释选择「逐个调用点显式声明」,这里全局塞进去会误伤');
});

/**
 * ── 同日复查两仓每一个 activateTab 调用点之后补的两条 ────────────────────────────────────────
 * 这两条路 cowork 本来就是对的(OnlyPreview 走 `newTab()`,那里第一句就退 Workbench);
 * bitterless 走 `openCompositeTabTarget` / 控制器 `openCompositeTab`,原来都没退。
 */
test('OnlyPreview 以 tab 挂载时的每一次预览(MCP preview_open、工作区芯片)先退 Workbench', () => {
  const open = body(controller, 'async openWorkspaceInPreview(');
  const back = open.indexOf('this.workbenchView.backgroundTab()');
  const target = open.indexOf('this.browserView.openCompositeTabTarget(');
  assert.ok(back > 0 && target > back, '预览会开在 Workbench 底下 —— 「给我看这个文件」看不到');
});

test('操作者开 app(Workbench Apps 页、Zellij、Trench、OnlyPreview 窗口→tab)先退 Workbench', () => {
  const open = body(controller, 'async openCompositeTab(params: { id: string })');
  const back = open.indexOf('this.workbenchView.backgroundTab()');
  const call = open.indexOf('await this.browserView.openCompositeTab(params)');
  assert.ok(back > 0 && call > back, 'Workbench Apps 页的「打开 OnlyPreview」点了等于没点');
});
