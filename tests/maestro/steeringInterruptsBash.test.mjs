import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { transform } from 'esbuild';

/**
 * 人在 tooling 期间发的那句话,必须有机会送到模型手上。
 *
 * 2026-09-22 实录(cowork,`agent-io/20260922172300506-3livgggcegdmucgup78`,本仓同一条路径):
 * 一条 `grep -rli … .`(93 GB 工作区)跑了 11 分钟没返回。pi 只在**工具边界**投递 steering,
 * 没有边界 ⇒ 那句纠正永远送不进去,最后只能去终端 `kill`。
 *
 * 钉三个环节:打断真的让 `exec` 结束并如实说明;只认领**自己**这一次打断;
 * 覆盖内置 bash 走 customTools 同名覆盖而**不是** `excludeTools`。
 *
 * 见 docs/issues/bash-tool-has-no-timeout-and-wedges-the-turn.md。
 */
const root = resolve(import.meta.dirname, '../..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
// 这个模块只有 type import,所以单文件 transform 就能跑真源码,不必 bundle。
const compiled = (await transform(read('src/main/agent/runtime/piInterruptibleBash.ts'), { loader: 'ts', format: 'esm' })).code;
const { createInterruptibleBash, steeringInterruptReason } =
  await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

/** 一个永不自己结束的假命令 —— 只有 signal 能让它回来,正是那 11 分钟的形状。 */
const hangingLocal = () => ({
  exec: (_command, _cwd, options) => new Promise((_resolve, reject) => {
    options.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  })
});

const collect = () => {
  const chunks = [];
  return { onData: (buf) => chunks.push(String(buf)), text: () => chunks.join('') };
};

test('打断会让命令结束,并如实说明它被杀了', async () => {
  const bash = createInterruptibleBash(hangingLocal());
  const out = collect();
  const running = bash.operations.exec('grep -rli x .', '/tmp', { onData: out.onData });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(bash.interrupt('the operator sent a message'), true);
  const result = await running;
  assert.equal(result.exitCode, null, 'null 是 pi 对「被杀掉」的既有表示,不自造新值');
  const text = out.text();
  assert.match(text, /\[interrupted after \d+s\] the operator sent a message/);
  assert.match(text, /The command was: grep -rli x \./, '要把原命令说出来 —— 模型据此决定重跑还是换法');
  assert.match(text, /Nothing about its result is known/, '不许暗示它"完成了"或"没找到"');
});

test('没有命令在跑时,打断如实返回 false', () => {
  const bash = createInterruptibleBash(hangingLocal());
  assert.equal(bash.interrupt('nobody is running'), false);
  assert.equal(bash.runningForMs(), undefined);
});

test('回合自己的 abort 不许被说成「被操作者打断」', async () => {
  const bash = createInterruptibleBash(hangingLocal());
  const turn = new AbortController();
  const out = collect();
  const running = bash.operations.exec('sleep 999', '/tmp', { onData: out.onData, signal: turn.signal });
  await new Promise((r) => setTimeout(r, 5));
  turn.abort();
  await assert.rejects(running, /aborted/, '回合级 abort 要原样抛回去,由上层按 Stop 处理');
  assert.equal(out.text(), '', '不许往结果里写"被操作者打断"');
});

test('命令自身的错误原样抛出', async () => {
  const bash = createInterruptibleBash({ exec: async () => { throw new Error('ENOENT: no such cwd'); } });
  await assert.rejects(bash.operations.exec('ls', '/nope', { onData: () => {} }), /ENOENT/);
});

test('理由里带上用户原话,并且截断', () => {
  const reason = steeringInterruptReason({ text: 'x'.repeat(500) });
  assert.match(reason, /The operator sent a message while this command was running/);
  assert.ok(reason.length < 300, '长消息要截断 —— 它进的是工具结果,不是上下文预算的垃圾桶');
});

test('steering 入队之后真的会去打断', () => {
  const src = read('src/main/agent/runtime/piRuntimeSession.ts');
  const body = src.slice(src.indexOf('async enqueueSteering('), src.indexOf('async prompt('));
  assert.match(body, /this\.bash\?\.interrupt\(steeringInterruptReason\(message\)\)/,
    '排完队要打断正在跑的命令 —— 否则这条消息等不到边界');
  assert.ok(
    body.indexOf('this.pendingSteering.push(queued)') < body.indexOf('interrupt('),
    '先入队再打断:反过来的话边界出现时队列还是空的,白杀一条命令'
  );
});

test('覆盖内置 bash 走 customTools 同名覆盖,不走 excludeTools', () => {
  const src = read('src/main/agent/runtime/piRuntimeAdapter.ts');
  assert.match(src, /createBashToolDefinition\(prompt\.cwd, \{ operations: interruptibleBash\.operations \}\)/);
  assert.match(src, /customTools: bashTool \?/, '要真的把它放进工具表');
  assert.doesNotMatch(src, /excludeTools/, 'excludeTools 会把同名的自定义 bash 一起关掉');
  assert.match(src, /builtinNames\.includes\('bash'\)/);
});

test('没投出去的 steering 把字还回输入框', () => {
  const panel = read('src/renderer/maestro/control/src/ChatPanel.vue');
  const ok = panel.slice(panel.indexOf('if (reply && !isRejection(reply)) {'), panel.indexOf("if (!reply.mergedIntoTurn) emit('sent', reply)"));
  assert.match(ok, /reply\.error === 'steer-failed'/, '成功那一支里要认出「没投出去」');
  assert.match(ok, /input\.value = message/, '要把字还回去');
  assert.match(ok, /!input\.value\.trim\(\)/, '只在输入框仍为空时还原 —— 不许盖掉新打的字');
});

test('clearQueue() 的返回值不许丢', () => {
  const src = read('src/main/agent/runtime/piRuntimeSession.ts');
  const body = src.slice(src.indexOf('takePendingSteering()'), src.indexOf('async prompt('));
  assert.match(body, /const dropped = this\.session\.clearQueue\?\.\(\)/, '要接住返回值,不能裸调');
  assert.match(body, /dropped\?\.steering\.length/, '要真的读它 —— 它是「pi 手上还剩几条」的唯一权威');
  assert.match(body, /phase: 'steering-dropped'/, '两侧不同量要能在日志里看见,不许静默');
});
