import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

/**
 * `/export` —— 把会话的模型 I/O 目录打成 zip 并让人选保存位置。
 *
 * 用源码断言而不是跑对话框:`dialog.showSaveDialog` 要真窗口,而这条要守的都是**结构**,不是交互。
 *
 * 2026-09-22 Ral 追加了一条要求:压缩期间要有等待提示。它把这个命令从一次调用拆成了**两步** ——
 * 选位置(人在想)和压缩(机器在忙)必须分开,否则加载态会盖住人挑目录的全过程,显示的是一个
 * 假的"正在压缩"。所以下面钉的不只是"能导出",还有**两步的边界在哪**。
 */
const APP_ROOT = resolve(import.meta.dirname, '../..');
const read = (path) => readFileSync(join(APP_ROOT, path), 'utf8');

const service = read('src/main/agent/maestroAgent.service.ts');
const panel = read('src/renderer/maestro/control/src/ChatPanel.vue');
const bodyOf = (source, declaration, close) => {
  const at = source.indexOf(declaration);
  assert.ok(at > 0, `${declaration} 必须存在`);
  return source.slice(at, source.indexOf(close, at));
};
const pick = bodyOf(service, '  async pickSessionIoExportTarget(', '\n  }');
const write = bodyOf(service, '  async writeSessionIoArchive(', '\n  }');
const exportCommand = bodyOf(panel, '    exportSession: async () => {', '\n    },');

test('两步各司其职:选位置的那步不压缩,压缩的那步不弹对话框', () => {
  assert.doesNotMatch(pick, /createArchive/, '第一步压缩了,等待提示就会盖住人挑目录的全过程');
  assert.doesNotMatch(write, /showSaveDialog/, '第二步再弹一次对话框,人就要选两遍');
  assert.match(pick, /showSaveDialog/);
  assert.match(write, /createArchive/);
});

test('目录按会话身份取,与 /copy_session_path 同源', () => {
  for (const [name, body] of [['pick', pick], ['write', write]]) {
    assert.match(body, /this\.resolveSessionIoDirectory\(params\?\.sessionId, params\.workspace\)/,
      `${name} 不能自己解析路径 —— 三个入口必须指向同一个地方`);
    assert.doesNotMatch(body, /params\.path|params\.dir/, `${name} 不能信任界面递过来的路径`);
  }
  // 第二步**重新解析**而不是把第一步的 path 当源:两步之间界面可能换了会话,身份才是判据。
  assert.doesNotMatch(write, /params\.source|params\.from\b/);
});

test('取消不是失败', () => {
  assert.match(pick, /if \(chosen\.canceled \|\| !chosen\.filePath\) return \{ ok: false, cancelled: true \}/);
  // 契约把 cancelled 与 error 分成两支,界面才可能对它们区别对待。
  const api = read('src/shared/maestro/coach.api.ts');
  assert.match(api, /\| \{ ok: false; cancelled: true \}/);
  assert.match(api, /\| \{ ok: false; error: string \}/);
  assert.match(exportCommand, /if \(!picked\.ok && 'cancelled' in picked\) return/, '取消时不写时间线、不弹红');
});

test('压缩包里是一个顶层文件夹,不是一堆散文件', () => {
  assert.match(write, /createArchive\(target, \[basename\(dir\)\], \{ cwd: join\(dir, '\.\.'\) \}\)/,
    'cwd 取父级、输入用目录名 —— 否则解压出来是一地散文件');
});

test('等待提示只罩住压缩,而且每一条出口都收掉它', () => {
  const picked = exportCommand.indexOf('pickSessionIoExportTarget');
  const loading = exportCommand.indexOf('Message.loading');
  const written = exportCommand.indexOf('writeSessionIoArchive');
  assert.ok(picked >= 0 && loading > picked, '提示必须在选完位置之后才亮 —— 人挑目录时不是"正在压缩"');
  assert.ok(written > loading, '提示必须在压缩之前亮,否则它罩不住压缩');
  assert.match(exportCommand, /duration: 0/, '压缩多久不知道,提示不能自己超时消失');
  assert.match(exportCommand, /\} finally \{\s*\n\s*pending\.close\(\)/,
    '收尾要在 finally —— 成功、失败、抛出三条路都得把 duration 0 的提示收掉');
});

test('命令挂在 /copy_session_path 旁边,并且走同一条 dispatch', () => {
  assert.match(panel, /name: '\/export'/);
  const store = read('src/renderer/maestro/control/src/store/shortcut.store.ts');
  assert.match(store, /case '\/export':\n\s*await context\.exportSession\(\)/);
  const type = read('src/renderer/maestro/control/src/store/shortcut.type.ts');
  assert.match(type, /'\/export'/, '命令名的闭合联合要收进它,否则新命令是编译错误');
});
