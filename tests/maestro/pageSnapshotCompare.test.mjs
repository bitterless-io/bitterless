import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

/**
 * `/page_snapshot_compare` —— 树 + DOM 原文 + 覆盖诊断打成一个 zip
 * (契约 `docs/features/page-snapshot-compare.md`)。
 *
 * 与 `/page_snapshot` 的守卫同法:用源码断言而不是跑 Electron。这条命令要守的全是**边界** ——
 * 读哪个 tab、三样是不是同一次取、剥不剥脚本、取消了写不写盘、临时目录清不清 —— 都是结构判据。
 */
const APP_ROOT = resolve(import.meta.dirname, '../..');
const read = (path) => readFileSync(join(APP_ROOT, path), 'utf8');

const capture = read('src/main/maestro/capture/capture.service.ts');
const debuggerCapture = read('src/main/maestro/capture/debuggerCapture.ts');
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
/** 注释剥掉之后的代码 —— `doesNotMatch` 一律跑在这上面,判据是代码不是散文。 */
const codeOf = (body) => body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const operator = bodyOf(capture, '  async pageSnapshotCompareForOperator(');
const operatorCode = codeOf(operator);
const probe = bodyOf(debuggerCapture, 'const comparePayload = (', '\n}\n');
// 这个方法的返回类型是多行对象字面量,`\n  }` 会先命中它 —— 用它后面那条注释当收尾。
const snapshotCompare = bodyOf(debuggerCapture, '  async snapshotCompare(', '\n  /** Viewport JPEG');
const exporter = bodyOf(controller, '  async exportPageSnapshotCompare(');
const exporterCode = codeOf(exporter);
const command = bodyOf(panel, '    exportPageSnapshotCompare: async () => {', '\n    },');

test('「当前 tab」沿用人这一侧的解析器,不另写第三份', () => {
  assert.match(operator, /this\.currentCaptureTarget\(\)/,
    '这条命令问的是"人正在看哪一页",判据就是这个解析器');
  assert.doesNotMatch(operatorCode, /agentWorkTarget|browserTarget|activeTabId/,
    'agent 那侧的目标解析器不适用:agent 没有"正在看哪一页"这回事');
});

test('树 / DOM / 诊断必须来自同一次求值', () => {
  assert.match(snapshotCompare, /\(\$\{comparePayload\}\)\(\$\{snapshotWalker\}\)/,
    'walker 要作为参数传进探针:分两次取,两份就来自不同瞬间');
  assert.equal((codeOf(snapshotCompare).match(/sendCommand\(/g) || []).length, 1,
    '一次往返 —— 而且诊断靠的是 walker 刚写上的 data-coach-ref,下一次快照开头就会清掉');
  assert.match(probe, /const snapshot = walk\(\)/, '先走树,后面的做差才有 ref 可依据');
});

test('做差的文字叶子判据与 walker 的保留规则逐字一致', () => {
  assert.match(probe, /if \(el\.children\.length !== 0\) continue/,
    'walker 只把无子元素的节点当文字叶子;判据不一致就会凭空造出缺口');
  assert.match(probe, /tag === 'label'/, 'walker 把 <label> 排除在文字叶子之外');
  assert.match(probe, /if \(el\.hasAttribute\('data-coach-ref'\)\) continue/,
    '身上有 ref 就是进了树,不是缺口');
  assert.match(probe, /if \(!el\.getClientRects\(\)\.length\) continue/,
    '只算**可见**的:屏幕上看不见的东西不在树里,本来就不是缺陷');
});

test('aria-hidden 与真隐藏归为「不是缺陷」,否则警报永远在响', () => {
  assert.match(probe, /defect = false/, '必须存在非缺陷分支');
  assert.match(probe, /aria-hidden="true" — kept out by design/, 'aria-hidden 是设计,不是缺陷');
  assert.match(probe, /genuinely not rendered, not a defect/, '真隐藏是设计,不是缺陷');
  assert.match(probe, /benign \+= 1/, '非缺陷单独计数,不混进 gaps');
});

test('HTML 原文默认剥掉脚本正文', () => {
  assert.match(probe, /querySelectorAll\('script, style'\)/, '脚本与样式正文都要换掉');
  assert.match(probe, /stripped by page_snapshot_compare/, '替换成可辨认的占位,不是删标签');
  assert.doesNotMatch(exporterCode, /scriptsStripped:\s*false/,
    '剥除是默认值:这个压缩包的用途就是发给别人看,而页面里可能带着活的访问令牌');
});

test('先取数、再弹保存对话框', () => {
  const grab = exporter.indexOf('pageSnapshotCompareForOperator(');
  const ask = exporter.indexOf('showSaveDialog(');
  assert.ok(grab > 0 && ask > grab,
    '人是看着当前这一屏才敲的命令;挑保存位置可能花掉十几秒,那期间页面还在动');
});

test('取消不落盘,失败给理由,临时目录必清', () => {
  const cancel = exporter.indexOf('cancelled: true');
  const zip = exporter.indexOf('createArchive(');
  assert.ok(cancel > 0 && zip > cancel, '取消要在打包之前早退');
  assert.match(exporter, /return \{ ok: false, error:/, '失败给理由,不是 null');
  assert.match(exporter, /finally \{[\s\S]*rmSync\(staging/, '临时目录在 finally 里删,失败也不留残渣');
});

test('压缩包里是一个文件夹,四个文件齐全', () => {
  assert.match(exporter, /createArchive\(chosen\.filePath, \[folder\], \{ cwd: staging \}\)/,
    '以父级为 cwd、输入用目录名 —— 解压出来是一个文件夹,不是一摊散文件');
  for (const name of ['snapshot.yml', 'page.html', 'meta.json', 'diagnosis.md']) {
    assert.ok(exporter.includes(name), `压缩包里缺 ${name}`);
  }
});

test('两条路出的 yml 必须逐字一致', () => {
  assert.match(snapshotCompare, /composeSnapshotYaml\(value\.snapshot\)/);
  assert.match(bodyOf(debuggerCapture, '  async snapshot('), /composeSnapshotYaml\(value\)/,
    '共用同一份组装:否则拿导出的 yml 去对照 agent 实际看到的那份就失去意义');
});

test('回渲染端的是有界结论,不是正文', () => {
  const result = bodyOf(api, 'export type PageSnapshotCompareResult =', ';\n');
  assert.doesNotMatch(result, /\byaml\b/, 'yml 正文只进压缩包');
  assert.doesNotMatch(result, /\bhtml\b/, 'HTML 原文只进压缩包');
  assert.match(result, /gaps: PageSnapshotGap\[\]/,
    '诊断结论是例外中的有界例外 —— 界面要靠它直接说出根因,让人解压才知道结果这条命令就白做了');
  assert.match(result, /cancelled\?: boolean/, '取消不是错误');
});

test('命令有自己的 case,界面留痕不只发 toast', () => {
  assert.match(type, /'\/page_snapshot_compare'/, '命令名要收进那个闭合联合');
  assert.match(store, /case '\/page_snapshot_compare':\n\s*await context\.exportPageSnapshotCompare\(\)/);
  assert.match(panel, /name: '\/page_snapshot_compare'/);
  assert.match(command, /pushLocalNote/,
    '产物是一个**结论**:根因和压缩包路径都要回翻,toast 会消失');
  assert.match(command, /if \(reply\.cancelled\) return/, '取消是正常路径,不该弹错误');
  assert.match(command, /props\.session\.id !== sessionId/, '一次往返之间会话可能已经换掉');
});
