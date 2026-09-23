import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

/**
 * `/page_snapshot` —— 把**人正在看的那个 tab** 的无障碍快照写进剪贴板
 * (契约 `docs/features/maestro-slash-commands.md`)。
 *
 * 用源码断言而不是跑 Electron:这条命令要守的全是**边界**(读哪个 tab、截不截断、动不动录制、
 * 失败时剪贴板有没有被改),而这些是结构判据,不需要真窗口就能钉住。cowork 侧同形。
 */
const APP_ROOT = resolve(import.meta.dirname, '../..');
const read = (path) => readFileSync(join(APP_ROOT, path), 'utf8');

const capture = read('src/main/maestro/capture/capture.service.ts');
const controller = read('src/main/maestro/windows/main/maestroWindow.controller.ts');
const api = read('src/shared/maestro/coach.api.ts');
const panel = read('src/renderer/maestro/control/src/ChatPanel.vue');
const store = read('src/renderer/maestro/control/src/store/shortcut.store.ts');
const type = read('src/renderer/maestro/control/src/store/shortcut.type.ts');

const bodyOf = (source, declaration, close = '\n  }') => {
  const at = source.indexOf(declaration);
  assert.ok(at > 0, `${declaration} 必须存在`);
  return source.slice(at, source.indexOf(close, at));
};
/**
 * 注释剥掉之后的代码。所有 `doesNotMatch` 断言都跑在这一份上 —— 否则一句解释为什么**不**走
 * agent 那条路的注释,会被判成"走了 agent 那条路"。判据是代码,不是散文。
 */
const codeOf = (body) => body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const operator = bodyOf(capture, '  async pageSnapshotForOperator(');
const operatorCode = codeOf(operator);
const copy = bodyOf(controller, '  async copyPageSnapshot(');
const copyCode = codeOf(copy);
const command = bodyOf(panel, '    copyPageSnapshot: async () => {', '\n    },');

test('「当前 tab」走人这一侧的解析器,不另写第三份"哪个 tab 在前台"', () => {
  assert.match(operator, /this\.currentCaptureTarget\(\)/,
    '这条命令问的就是"人正在看哪一页",那正是 currentCaptureTarget 的判据');
  assert.doesNotMatch(operatorCode, /agentWorkTarget|browserTarget|activeTabId/,
    '自己挑 tab = 第四个"当前 tab"的定义,四份定义迟早互相漂开');
  // 复用而不是包一层 pageSnapshotForAgent:那份 emit trace,见下一条。
  assert.doesNotMatch(operatorCode, /pageSnapshotForAgent/);
});

test('这是一次读:不截图、不写 trace、不碰录制', () => {
  assert.match(operator, /snapshot\(\{ shot: false \}\)/,
    '没人会把这张图当图看,多一次 CDP 截屏纯属浪费');
  assert.doesNotMatch(operatorCode, /this\.emitTrace|this\.emit\(/,
    '人把页面拷进剪贴板不是录制里的一步 —— 写进去就是往他正在录的那份里塞一条幻觉观察');
  assert.doesNotMatch(operatorCode, /startRecording|switchCaptureTarget|activateTab/);
});

test('失败给理由,而且剪贴板一个字都不动', () => {
  assert.match(operator, /return \{ ok: false, error:/,
    '前台不是可读网页 与 CDP 读失败 是两件事,合成 null 之后界面只能说一句"没有页面"');
  const guard = copy.indexOf('if (pageSnapshotFailed(snapshot)) return snapshot');
  const write = copy.indexOf('clipboard.writeText');
  assert.ok(guard >= 0 && write > guard,
    '写剪贴板必须在失败早退之后 —— 否则人会拿着上一次的内容以为是这一次的');
});

test('整份进剪贴板:200k 那道闸是给上下文窗口的,剪贴板没有上下文窗口', () => {
  assert.doesNotMatch(copyCode, /clipText|SNAPSHOT_RESULT_LIMIT|slice\(0,/,
    '一棵停在半路的树,对"对照 agent 看到了什么"这件事恰恰是最没用的');
  for (const header of ['# tab: ', '# page: ', '# title: ', '# elements: ']) {
    assert.ok(copy.includes(header), `贴出去的快照要自己说得清来自哪一页:缺 ${header}`);
  }
});

test('回渲染端的是量度,不是快照正文', () => {
  const result = bodyOf(api, 'export type PageSnapshotCopyResult', '\n\n');
  assert.match(result, /\| \{ ok: true; tabId: string; url: string; title: string; nodeCount: number; chars: number \}/);
  assert.doesNotMatch(result, /yaml/, '正文只进剪贴板 —— 与 copyNextTurnContext 同一口径');
  assert.match(api, /  copyPageSnapshot\(\): Promise<PageSnapshotCopyResult>/,
    '不带 sessionId:当前 tab 是窗口这一级的事实,不是会话的');
});

test('命令有自己的 case,不是搭别人的便车', () => {
  assert.match(type, /'\/page_snapshot'/, '命令名要收进那个闭合联合,否则漏接一条不是编译错误');
  assert.match(store, /case '\/page_snapshot':\n\s*await context\.copyPageSnapshot\(\)/);
  assert.match(panel, /name: '\/page_snapshot'/);
  assert.match(command, /if \(!reply\.ok\) throw new Error\(reply\.error\)/, '失败要可见');
  assert.match(command, /props\.session\.id !== sessionId/, '一次往返之间会话可能已经换掉');
});
