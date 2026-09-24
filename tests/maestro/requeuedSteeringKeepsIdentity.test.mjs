import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

/**
 * **排队消息顺延时:同一个 id、dispatch 之前不「转正」、不留幽灵投影、等待期间看得见也取得回。**
 *
 * 9-22「二次改造」把排队中的 steering 挪进 `session.pendingSteering` 之后,顺延那条路没改完:交给 `send()` 的
 * `existingMessage` 对第一次排队的话是 undefined,于是它成了一次普通发送 —— 新 id、当场标成「模型看过」;
 * 停止后顺延那一支还不出队,投影带着撤回键永远留在时间线上。
 * 见 docs/issues/requeued-steering-loses-identity-and-honesty.md。
 *
 * 跑的是 `turn.service.ts` 里**真的** `sendSteering` / `continueSteeringAfterCompletion` / `withdrawSteering`。
 */
const ROOT = resolve(import.meta.dirname, '../..');
const SOURCE = readFileSync(join(ROOT, 'src/renderer/maestro/control/src/store/turn.service.ts'), 'utf8');

let seq = 0;
const globals = () => ({
  uid: () => `uid-${++seq}`,
  isRejection: (r) => Boolean(r) && r.ok === false && 'reason' in r,
  interpolateChatCopy: (template, vars) => template.replace('{detail}', vars.detail),
  i18nHelper: { maestroControl: { chat: { steeringFailed: '⚠ not processed: {detail}', unknownError: 'unknown error' } } },
  coach: { withdrawSteering: async () => ({ messageIds: [] }) },
  Date, Promise, Map, Set, Error
});
const methods = (names) => {
  const ast = ts.createSourceFile('turn.service.ts', SOURCE, ts.ScriptTarget.Latest, true);
  const found = new Map();
  const visit = (node) => { if (ts.isMethodDeclaration(node) && names.includes(node.name.getText(ast))) found.set(node.name.getText(ast), node.getText(ast)); ts.forEachChild(node, visit); };
  visit(ast);
  for (const n of names) assert.ok(found.has(n), `找不到 ${n}`);
  const js = ts.transpileModule(`class Target { ${[...found.values()].join('\n')} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return runInNewContext(`${js}; Target.prototype`, globals());
};
const proto = methods(['sendSteering', 'continueSteeringAfterCompletion', 'withdrawSteering']);
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const tick = () => new Promise((r) => setImmediate(r));

const fixture = ({ dispatch, finishFromMain = async () => {} }) => {
  const session = { id: 's', turn: { id: 't1' }, messages: [], pendingSteering: [] };
  const sends = [];
  const store = {
    buildAgentContext: () => ({}), dispatch: (...args) => dispatch(session, ...args), getSession: (id) => (id === 's' ? session : undefined),
    updateSessionContextUsage() {}, scrollToBottom() {}, persistSession: async () => true, withTokenCount: (m) => m, stickToBottom: false
  };
  const host = Object.assign(Object.create(proto), {
    _state: store, rootDispatchWaiters: new Map(), steeringContinuations: new Map(), finishFromMain,
    appendTimelineEntry: (target, entry) => { target.messages.push(entry); return entry; },
    // `send()` 只记下它收到的那条消息此刻的样子 —— 「顺延回来的消息」要到它自己 dispatch 时才转正。
    send: async (...args) => { sends.push({ args, message: args[3], promptExcludedAtCall: args[3]?.promptExcluded, idAtCall: args[3]?.id }); return { ok: true, text: 'done' }; }
  });
  return { session, host, sends, humans: () => session.messages.filter((m) => m.role === 'human') };
};

test('停止后顺延:同一个 id、交给 send() 时仍标「模型还没看见」、出队、时间线上只有一条', async () => {
  const f = fixture({ dispatch: async (session) => { session.turn = undefined; return { ok: false, error: 'steer-failed', text: 'stopped' }; } });
  const pending = f.host.sendSteering(f.session, 'take this instead');
  const queuedId = f.session.pendingSteering[0].id;
  const result = await pending;
  assert.equal(result.ok, true, '顺延出去的那一轮就是它的结局');
  assert.equal(f.sends.length, 1);
  assert.equal(f.sends[0].idAtCall, queuedId, 'main 按 messageId 去重 —— 顺延不许换 id');
  assert.equal(f.sends[0].promptExcludedAtCall, true, 'dispatch 之前不许声称模型看过');
  assert.equal(f.session.pendingSteering.length, 0, '原来不出队:投影带着撤回键永远留在时间线上');
  assert.deepEqual(f.humans().map((m) => m.id), [queuedId], '投影与新消息不许并排出现');
  assert.equal(f.session.messages.filter((m) => m.error).length, 0, '没投出去 ≠ 失败 —— 不该有 ⚠');
});

test('自然跑完:等收尾期间它仍在队列里(看得见),这时取回有效,取回后不顺延', async () => {
  const finishing = deferred();
  const f = fixture({
    dispatch: async () => ({ ok: false, text: '', continueAsRoot: { turnId: 't1', reply: { ok: true, text: 'old' }, snapshot: {} } }),
    finishFromMain: async (session) => { await finishing.promise; session.turn = undefined; }
  });
  const pending = f.host.sendSteering(f.session, 'wait for me');
  await tick();
  const item = f.session.pendingSteering[0];
  assert.ok(item, '原来一进这一支就出队:收尾那几秒里这句话从屏幕上消失');
  assert.equal(item.awaitingTurnEnd, true);
  const texts = await f.host.withdrawSteering('s', [item.id]);
  assert.deepEqual([...texts], ['wait for me'], '它已不在 pi 手里,取回由渲染端就地完成 —— 否则撤回键按下去什么都不发生');
  finishing.resolve(); const result = await pending;
  assert.equal(result.error, 'steer-withdrawn');
  assert.equal(f.sends.length, 0, '取回之后不许再顺延出去');
  assert.equal(f.humans().length, 0);
  assert.equal(f.session.messages.filter((m) => m.error).length, 0);
});

test('自然跑完后顺延成下一回合:同一个 id,交给 send() 时仍标「模型还没看见」', async () => {
  const f = fixture({
    dispatch: async () => ({ ok: false, text: '', continueAsRoot: { turnId: 't1', reply: { ok: true, text: 'old' }, snapshot: {} } }),
    finishFromMain: async (session) => { session.turn = undefined; }
  });
  const pending = f.host.sendSteering(f.session, 'next turn please');
  const queuedId = f.session.pendingSteering[0].id;
  await pending;
  assert.equal(f.sends.length, 1);
  assert.equal(f.sends[0].idAtCall, queuedId);
  assert.equal(f.sends[0].promptExcludedAtCall, true);
  assert.equal(f.sends[0].args[6], 't1', '续跑带上原回合 id');
  assert.equal(f.session.pendingSteering.length, 0);
  assert.deepEqual(f.humans().map((m) => m.id), [queuedId]);
});

test('send():顺延回来的消息等 dispatch 真的发出去才转正,普通发送保持原样', () => {
  // bitterless 里 `sendSteering` 定义在 `send` 前面 —— 从 `send` 切到它后面紧跟的下一个方法。
  const start = SOURCE.indexOf('  async send(sessionId: string');
  const next = SOURCE.slice(start + 1).search(/\n  (?:private |public |protected )?(?:async )?[a-zA-Z]+\(/);
  const send = SOURCE.slice(start, start + 1 + next);
  assert.ok(start > 0 && send.includes('reply = await store.dispatch('), '切出来的必须是 send() 本体');
  assert.match(send, /if \(!existingMessage\) humanMessage\.promptExcluded = undefined/, '追加时只给普通发送转正');
  const flip = send.indexOf('if (existingMessage) {\n        humanMessage.promptExcluded = undefined');
  const dispatch = send.indexOf('reply = await store.dispatch(');
  assert.ok(flip > 0 && dispatch > flip && dispatch - flip < 400, '顺延回来的那条紧挨着 dispatch 才转正');
});
