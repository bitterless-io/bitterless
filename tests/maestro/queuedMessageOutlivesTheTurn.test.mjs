import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

/**
 * **一条排队消息不会因为回合结束而作废 —— 它顺延成下一个回合。**
 *
 * 2026-09-22 实录(cowork 侧 `agent-io/20260922143654108-i21dqhp2dtrmucax32t`,同一套代码):
 * Ral 发出一句打错的话,按 Stop,再打一句,**回车 18 秒没有任何反应**。第一版修法是把字留在
 * 输入框里、等收尾结束再自动发;Ral 当天否掉了那个形状 ——
 *
 *   「静默吞掉和按钮禁用都不对,这种情况就类似于 followup 了,先进 queue 等结尾完结再发出去
 *     就行 … UI 上直接拼到结尾那个消息下面」
 *
 * 所以队列必须是**看得见的**:人类那条消息当场进时间线(`promptExcluded` 先标着,表示模型还
 * 没看见它),回合一结束就把**同一条**消息作为下一个回合发出去。
 *
 * 判据的关键一句:「没投出去」= 模型一个字都没看见它 ⇒ 它不是失败,是还在队列里。
 *
 * 配对开发:cowork 侧同名守卫 `apps/cowork/tests/unit/queuedMessageOutlivesTheTurn.test.mjs`。
 */
const ROOT = resolve(import.meta.dirname, '../..');
const read = (path) => readFileSync(join(ROOT, path), 'utf8');
const panel = read('src/renderer/maestro/control/src/ChatPanel.vue');
const service = read('src/renderer/maestro/control/src/store/turn.service.ts');
const steering = service.slice(service.indexOf('private async sendSteering('), service.indexOf('private continueSteeringAfterCompletion('));

test('收尾中的回车不再被任何一道闸挡回去', () => {
  assert.doesNotMatch(panel, /if \(props\.session\.turn\?\.aborting\) return/, '一行裸 return —— 那次回归的原形');
  assert.doesNotMatch(panel, /holdUntilStopped/, '留在输入框里等 watch 的那一版已被否掉');
  assert.doesNotMatch(steering, /if \(turn\.aborting\) return \{ ok: false, reason: 'not-sendable' \}/,
    'steering 入口也不许因为「正在收尾」就拒收 —— 收下,进队列');
  assert.doesNotMatch(steering, /if \(!ready \|\| turn\.aborting \|\|/, 'root 派发等待里的那一档同理');
});

test('没投出去 ≠ 失败:回合已经没了就把同一条消息作为下一回合发出去', () => {
  assert.match(steering, /if \(!session\.turn && !session\.archivedAt && store\.getSession\(session\.id\) === session\) \{/);
  // 9-22 二次改造后排队中的话不是消息;顺延那一刻才用**同一个 id** 建消息,先标「模型还没看见」,
  // 作为「顺延回来的消息」交给 send()(requeued-steering-loses-identity-and-honesty.md F3)。
  assert.match(steering, /const requeued = existingMessage \|\| this\.appendTimelineEntry\(\s*session,\s*store\.withTokenCount\(\{ id: messageId, [^}]*promptExcluded: true/,
    '顺延时沿用排队时的 id(main 按 messageId 去重),且在 dispatch 之前不许声称模型看过');
  assert.match(steering, /this\.send\(session\.id, text, undefined, requeued, context, snapshot\)/,
    '交给 send() 的是这条顺延回来的消息 —— 交 undefined 就成了一次普通发送:新 id、当场转正');
  const requeueAt = steering.indexOf('const requeued = existingMessage');
  const dequeueBefore = steering.lastIndexOf('dequeue()', requeueAt);
  assert.ok(dequeueBefore > 0 && requeueAt - dequeueBefore < 900,
    '顺延那一支必须先出队 —— 原来不出队,投影与新消息并排,之后投影带着撤回键一直留在时间线上');
  assert.match(steering, /if \(resent && !isRejection\(resent\)\) \{/);
});

test('⚠ 失败留痕只在顺延也没落点时才写', () => {
  const requeue = steering.indexOf('const resent = await this.send(');
  const failure = steering.indexOf('chat.steeringFailed');
  assert.ok(requeue > 0 && failure > requeue, '顺延必须在留痕之前 —— 反过来就是先宣告失败再补救');
});

test('那条人类消息先标成「模型还没看见」,送达后才转正', () => {
  assert.match(steering, /promptExcluded: true/, '排队中:它没进过提示词,留在用户原话链里就是让链谎报上下文');
  assert.match(steering, /humanMessage\.promptExcluded = undefined/, '并入回合后转正');
});
