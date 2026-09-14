import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import ts from 'typescript';

/**
 * 钻探编排的三条不变量（`drill-001` 阶段三）。
 *
 * 为什么这个文件存在：这三条各有一份 cowork issue 文档，而三个 bug **全是静默的** ——
 * 搬错不会有编译错误，也不会有报错，只会在两小时的钻探里悄悄做错事：
 *
 *  ① 全局单例  —— 第二次 begin 夺舍正在跑的那一轮（归属被覆盖、录制目录被换掉）
 *  ② 运行代次  —— 停止静默失效（判据挂在一个可能不存在的 TaskHandle 上）
 *  ③ 归属分离  —— 退化键 'default' 被当成归属盖出去，接收端解析不到就去猜
 *
 * 断言分两类：**行为**（构造真实例跑）与**次序**（对源码，因为"闸在赋值之前"这类要求
 * 只能在文本上表达 —— 那也是 cowork 那三个守卫的做法）。
 */

const ROOT = new URL('../../', import.meta.url).pathname;
const src = readFileSync(join(ROOT, 'src/main/maestro/sitemap/drillRun.service.ts'), 'utf8');

// ── 行为：转译 + 求值真模块 ────────────────────────────────────────────────────
//
// **不许用 `.catch(() => null)` 兜底再配 `if (!X) return` 的守卫。** 第一版就是那么写的,
// 而 node 直接 import `.ts` 会抛 ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX ⇒ 9 条行为断言全靠早退**空过**,
// 14/14 绿得毫无意义。加载失败必须让整个文件当场炸。
// 加载法照 `maestroCompactionHandler.test.mjs`(同一棵树里已有的做法)。
const root = resolve(import.meta.dirname, '../..');
const nodeRequire = createRequire(import.meta.url);

const loadMainModule = (relPath, stubs = {}) => {
  const file = resolve(root, relPath);
  const out = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    fileName: file,
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', '__filename', out)(
    (name) => {
      if (Object.hasOwn(stubs, name)) return stubs[name];
      return nodeRequire(name);
    },
    module,
    module.exports,
    file,
  );
  return module.exports;
};

const cancelled = [];
const { DrillRunService } = loadMainModule('src/main/maestro/sitemap/drillRun.service.ts', {
  'electron-xpc/main': { xpcMain: { broadcast: () => {} } },
  '@main/agent/runtime/agentSessionContext': {
    DEFAULT_AGENT_SESSION_KEY: 'default',
    currentChatSessionId: () => undefined,
  },
  '@maestro-main/tasks/taskRegistry.service': {
    taskRegistry: {
      cancel: (params) => {
        cancelled.push(params);
        return { ok: true, message: 'cancelled' };
      },
    },
  },
});

// 加载真的成功了吗 —— 这一条挡住"整个文件空过"这种失败模式。
assert.equal(typeof DrillRunService, 'function', 'DrillRunService 必须真的加载出来');

const makeHost = (over = {}) => ({
  logs: [],
  notes: [],
  exploring: false,
  debugCodex(e) {
    this.logs.push(e);
  },
  async setAutoDismissFileDialogs() {},
  async stopCaptureIfAgentStarted() {
    return true;
  },
  exploreSession() {
    return this.exploring ? { isExploring: true, isStopped: false, async finishTabScope() {} } : null;
  },
  ...over,
});

// ── ② 代次：单调、幂等、一个判据答两件事 ──────────────────────────────────────
test('代次单调 —— 同一毫秒内两次 begin 也必须不同', () => {
  const svc = new DrillRunService(makeHost());
  const a = svc.beginDrillRun();
  const b = svc.beginDrillRun();
  assert.ok(b > a, `第二次必须更大（否则"停止后立刻重开"会退化成两轮共用一个身份）：${a} → ${b}`);
});

test('isRunLive 同时回答「被停了」与「已经是下一轮了」', () => {
  const svc = new DrillRunService(makeHost());
  const first = svc.beginDrillRun();
  assert.equal(svc.isRunLive(first), true);
  svc.invalidateDrillRun('测试');
  assert.equal(svc.isRunLive(first), false, '被停了 → 不 live');
  const second = svc.beginDrillRun();
  assert.equal(svc.isRunLive(first), false, '已经是下一轮 → 旧 id 不 live');
  assert.equal(svc.isRunLive(second), true);
  assert.equal(svc.isRunLive(0), false, 'runId 0 永远不 live（没抓到代次的调用方不许放行）');
});

test('作废的一轮不占位 —— 否则重开要等一个死掉的运行让位', () => {
  const host = makeHost();
  const svc = new DrillRunService(host);
  svc.beginDrillRun();
  host.exploring = true;
  assert.ok(svc.busyWith(), '探索中 → 占位');
  svc.invalidateDrillRun('操作者按了停止');
  assert.equal(svc.busyWith(), null, '作废后不占位（exploreSession.open 仍是 true 也一样）');
});

test('摄取阶段同样占位（它活得比回合长）', () => {
  const svc = new DrillRunService(makeHost());
  svc.beginDrillRun();
  svc.setIngesting(true);
  assert.equal(svc.busyWith()?.phase, 'ingesting');
});

// ── ① 单例：拒绝而不是排队；本人重入放行 ──────────────────────────────────────
test('别的会话在钻 → 拒绝，且文案点名阶段', () => {
  const host = makeHost();
  const svc = new DrillRunService(host);
  svc.claimRun({ sessionKey: 'A', owner: 'A' });
  host.exploring = true;
  const refusal = svc.refuseIfBusyElsewhere('B');
  assert.ok(refusal, 'B 必须被拒');
  assert.match(refusal, /REFUSED/);
  assert.match(refusal, /exploration phase/, '要说清它在哪个阶段');
  assert.match(refusal, /Do NOT retry/, '要说清怎么办，否则模型原样重试');
  assert.ok(
    host.logs.some((l) => l.phase === 'drill:refused-not-singleton'),
    '拒绝要留痕',
  );
});

test('同一个会话重入 → 放行（不是第二轮）', () => {
  const host = makeHost();
  const svc = new DrillRunService(host);
  svc.claimRun({ sessionKey: 'A', owner: 'A' });
  host.exploring = true;
  assert.equal(svc.refuseIfBusyElsewhere('A'), null);
});

test('归属不被第二个 claim 覆盖（第二道断言性早退）', () => {
  const host = makeHost();
  const svc = new DrillRunService(host);
  svc.claimRun({ sessionKey: 'A', owner: 'A' });
  host.exploring = true;
  svc.claimRun({ sessionKey: 'B', owner: 'B' });
  assert.equal(svc.ownerSessionId, 'A', 'A 还在钻，归属不许被 B 抢走');
});

// ── ③ 停止：先作废、无条件回执、非主人留痕 ────────────────────────────────────
test('停止先作废代次，且不依赖有没有可取消的任务', () => {
  const host = makeHost();
  const svc = new DrillRunService(host);
  const runId = svc.claimRun({ sessionKey: 'A', owner: 'A' });
  host.exploring = true;
  svc.setExploreTask(null); // 没有任务 —— 摄取阶段就是这个形状
  svc.stopByOperator('A');
  assert.equal(svc.isRunLive(runId), false, '没有任务也必须作废代次');
});

test('非主人停止 → 拒绝但留痕（不再静默）', () => {
  const host = makeHost();
  const svc = new DrillRunService(host);
  const runId = svc.claimRun({ sessionKey: 'A', owner: 'A' });
  host.exploring = true;
  svc.stopByOperator('B');
  assert.equal(svc.isRunLive(runId), true, 'B 不许停 A 的钻探');
  assert.ok(
    host.logs.some((l) => l.phase === 'drill:stop-ignored' && l.level === 'error'),
    '必须留一行 drill:stop-ignored —— 否则"对不上主人"和"停止成功"在人眼里一样',
  );
});

// ── 次序断言（对源码）——「闸在赋值之前」这类要求只能在文本上表达 ──────────────
test('次序：单例闸的拒绝在 claimRun 写归属之前可用', () => {
  const refuseAt = src.indexOf('refuseIfBusyElsewhere(');
  const claimAt = src.indexOf('claimRun(');
  assert.ok(refuseAt > 0 && claimAt > 0);
  assert.ok(
    refuseAt < claimAt,
    'refuseIfBusyElsewhere 必须定义在 claimRun 之前 —— 顺序即文档：调用方照这个顺序读',
  );
});

test('次序：stopByOperator 里 invalidateDrillRun 在取消任务之前', () => {
  const body = src.slice(src.indexOf('stopByOperator('));
  const invalidateAt = body.indexOf('this.invalidateDrillRun(');
  const cancelAt = body.indexOf('taskRegistry.cancel(');
  assert.ok(invalidateAt > 0 && cancelAt > 0);
  assert.ok(
    invalidateAt < cancelAt,
    '作废必须无条件且在前 —— 取消任务那段有三个前置条件，任一不成立就整段跳过',
  );
});

test('次序：停止的播报在那三个前置条件之外', () => {
  const body = src.slice(src.indexOf('stopByOperator('));
  const ifAt = body.indexOf('if (this.exploreTask && session?.isExploring');
  const closeAt = body.indexOf('\n    }', ifAt);
  const broadcastAt = body.indexOf("xpcMain.broadcast('coach/drill-note'");
  assert.ok(ifAt > 0 && broadcastAt > 0);
  assert.ok(broadcastAt > closeAt, '播报必须在 if 块外面 —— 否则没有任务时人收不到任何回执');
});

test('归属与账本键是两个字段，且归属永不为退化键', () => {
  assert.match(src, /private drillUsageKey/, '账本键');
  assert.match(src, /private drillOwnerSessionId: string \| undefined/, '归属');
  assert.match(
    src,
    /currentChatSessionId\(\)/,
    '归属必须来自 currentChatSessionId（它把 default 映成 undefined）',
  );
  assert.doesNotMatch(
    src,
    /drillOwnerSessionId = DEFAULT_AGENT_SESSION_KEY/,
    '归属不许被写成退化键 —— 那会让接收端解析不到就去猜',
  );
});

test('finalize 不清归属（摄取活得比回合长）', () => {
  assert.match(src, /finalize 不清它/, '这条要求必须留在代码里说明，否则下一个人会顺手清掉');
  assert.doesNotMatch(src, /drillOwnerSessionId = undefined/, '不许在任何地方清空归属');
});
