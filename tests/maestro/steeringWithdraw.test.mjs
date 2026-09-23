import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import ts from 'typescript';

/**
 * 「取回」—— 趁排队的话还没送到模型手上,把它拿回输入框再改。
 *
 * pi 自己的 TUI 就有:`app.message.dequeue`(默认 alt+up,说明文字「Restore queued messages」)
 * → `restoreQueuedMessagesToEditor()` → `clearQueue()`,整批回到编辑器。本仓落在状态条那一行上。
 *
 * 钉三件事:整批取回、**已经送到模型那里的不许算作取回**、以及取回既不是失败也不是送达
 * (混进 failed 会让渲染端把它顺延成下一个回合 —— 等于替人重发他刚拿回去的话)。
 *
 * 与 `micromeet-cowork/apps/cowork/tests/unit/steeringWithdraw.test.mjs` 同形。
 */
const root = resolve(import.meta.dirname, '../..');
const nodeRequire = createRequire(import.meta.url);

const loadMainModule = (relPath) => {
  const file = resolve(root, relPath);
  const out = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    fileName: file,
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', '__filename', out)(nodeRequire, module, module.exports, file);
  return module.exports;
};

const { TurnSteeringInbox } = loadMainModule('src/main/agent/steering/turnSteeringInbox.ts');

const runtime = () => {
  const queued = [];
  return {
    queued,
    enqueueSteering: async (message) => { queued.push(message); },
    takePendingSteering: () => queued.splice(0),
    requeueSteering: async (messages) => { for (const message of messages) queued.push(message) },
  };
};
const settle = () => new Promise((resolve) => setImmediate(resolve));

test('还躺在队列里的整批取回,回执是 withdrawn', async () => {
  const inbox = new TurnSteeringInbox();
  const host = runtime();
  inbox.start(host);
  const first = inbox.enqueue({ text: '雅加达天气也差下', messageId: 'm1' });
  const second = inbox.enqueue({ text: '查下', messageId: 'm2' });
  await settle();
  assert.equal(host.queued.length, 2, '两条都已经交给运行时');

  const taken = await inbox.withdraw();
  assert.deepEqual(taken.map((message) => message.messageId), ['m1', 'm2']);
  assert.equal((await first).outcome, 'withdrawn');
  assert.equal((await second).outcome, 'withdrawn');
  assert.equal(host.queued.length, 0, '运行时那一侧也要清空 —— 否则模型照样会读到');
});

test('已经送到模型那里的那条不算取回,继续等它自己的回执', async () => {
  const inbox = new TurnSteeringInbox();
  const host = runtime();
  inbox.start(host);
  const delivered = inbox.enqueue({ text: 'A', messageId: 'm1' });
  const pending = inbox.enqueue({ text: 'B', messageId: 'm2' });
  await settle();
  host.queued.splice(host.queued.findIndex((message) => message.messageId === 'm1'), 1);

  const taken = await inbox.withdraw();
  assert.deepEqual(taken.map((message) => message.messageId), ['m2'], '只有 B 能被取回');
  assert.equal((await pending).outcome, 'withdrawn');
  inbox.consume('m1');
  assert.equal((await delivered).outcome, 'delivered', 'A 的回执照旧 —— 它确实进了模型的上下文');
});

test('取回不许被当成失败 —— 否则渲染端会把它顺延成下一个回合,替人重发一遍', () => {
  const service = readFileSync(resolve(root, 'src/main/agent/maestroAgent.service.ts'), 'utf8');
  assert.match(service, /delivered\.outcome === 'withdrawn'/, 'main 要把它单独回报');
  assert.match(service, /error: 'steer-withdrawn'/);
  const turnService = readFileSync(resolve(root, 'src/renderer/maestro/control/src/store/turn.service.ts'), 'utf8');
  const steering = turnService.slice(turnService.indexOf('private async sendSteering('));
  const withdrawn = steering.indexOf("reply.error === 'steer-withdrawn'");
  const resend = steering.indexOf('const resent = await this.send(');
  assert.ok(withdrawn > 0 && withdrawn < resend, '这一支必须排在顺延之前');
});

test('取回其中一条:其余的原样放回队列,顺序不变', async () => {
  const inbox = new TurnSteeringInbox()
  const host = runtime()
  inbox.start(host)
  const a = inbox.enqueue({ text: 'A', messageId: 'm1' })
  const b = inbox.enqueue({ text: 'B', messageId: 'm2' })
  const c = inbox.enqueue({ text: 'C', messageId: 'm3' })
  await settle()

  // pi 的 clearQueue() 只能整批清 —— 所以"取回其中一条"= 全部拿走 + 把其余的按原顺序放回去。
  const taken = await inbox.withdraw(['m2'])
  assert.deepEqual(taken.map(message => message.messageId), ['m2'])
  assert.equal((await b).outcome, 'withdrawn')
  assert.deepEqual(host.queued.map(message => message.messageId), ['m1', 'm3'], '其余两条原样回到队列,顺序不变')
  inbox.consume('m1'); inbox.consume('m3')
  assert.equal((await a).outcome, 'delivered')
  assert.equal((await c).outcome, 'delivered')
})

/**
 * **排队中的话不是一条消息** —— `message-types.html` #3 建议 3(照 pi)。
 * pi 里未投递的 steering 根本不是 entry:它在队列里,**投递那一刻**才成为条目。
 * 界面不变:队列由 `visibleMessages()` 投影在时间线末尾,取回按钮照挂。
 */
test('排队中的 steering 进队列,不进 messages[];送达那一刻才成为消息', () => {
  const turnService = readFileSync(resolve(root, 'src/renderer/maestro/control/src/store/turn.service.ts'), 'utf8');
  const steering = turnService.slice(turnService.indexOf('private async sendSteering('));
  const dispatchAt = steering.indexOf('reply = await store.dispatch(');
  const enqueueAt = steering.indexOf('session.pendingSteering = [...(session.pendingSteering || [])');
  const appendAt = steering.indexOf('const humanMessage = existingMessage || this.appendTimelineEntry(');
  const mergedAt = steering.indexOf('if (reply.mergedIntoTurn) {');

  assert.ok(enqueueAt > 0 && enqueueAt < dispatchAt, '发之前先入队');
  assert.ok(appendAt > mergedAt, '建消息必须发生在 mergedIntoTurn 那一支里 —— 投递之前不许有条目');
  assert.doesNotMatch(steering.slice(0, dispatchAt), /promptExcluded: true/, '入队那一步不许再造一条 promptExcluded 的消息');

  const store = readFileSync(resolve(root, 'src/renderer/maestro/control/src/store/message.store.ts'), 'utf8');
  assert.match(store, /visibleMessages\(session: MessageSession\): ChatMessage\[\]/);
  assert.match(store, /steeringPending: true/);

  const panel = readFileSync(resolve(root, 'src/renderer/maestro/control/src/ChatPanel.vue'), 'utf8');
  assert.match(panel, /<MessageList :messages="messageStore\.visibleMessages\(session\)">/);

  const persisted = store.slice(store.indexOf('private toStoredSession('));
  assert.doesNotMatch(persisted, /pendingSteering/, '队列不落库');
});
