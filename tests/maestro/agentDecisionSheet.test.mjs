import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import ts from 'typescript';

const APP_ROOT = resolve(import.meta.dirname, '../..');
const load = (() => {
  const cache = new Map();
  const read = file => {
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} }; cache.set(file, module);
    const native = createRequire(file);
    const { outputText } = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } });
    new Function('require', 'module', 'exports', outputText)(name =>
      name.startsWith('.') ? read(resolve(dirname(file), `${name}.ts`))
      : name.startsWith('@main/') ? read(resolve(APP_ROOT, 'src/main', `${name.slice(6)}.ts`))
      : name.startsWith('@shared/') ? read(resolve(APP_ROOT, 'src/shared', `${name.slice(8)}.ts`))
      : native(name), module, module.exports);
    return module.exports;
  };
  return path => read(resolve(APP_ROOT, path));
})();
const { normalizeDecisionQuestions, agentDecisionRegistry } = load('src/main/agent/decisionRegistry.service.ts');
const { DECISION_OTHER_LABEL } = load('src/shared/agentDecision.api.ts');

const question = (over = {}) => ({
  header: 'Route', question: 'Which way?', options: [{ label: 'A', description: 'a' }, { label: 'B' }], ...over
})

test('契约校验:形状不对就报错,不悄悄修正', () => {
  assert.deepEqual(normalizeDecisionQuestions([question()]), [
    { header: 'Route', question: 'Which way?', multiSelect: false, options: [{ label: 'A', description: 'a' }, { label: 'B' }] }
  ])
  assert.throws(() => normalizeDecisionQuestions([]), /non-empty/)
  assert.throws(() => normalizeDecisionQuestions(Array.from({ length: 5 }, () => question())), /at most 4 questions/)
  assert.throws(() => normalizeDecisionQuestions([question({ options: [{ label: 'only' }] })]), /2-4 entries/)
  assert.throws(() => normalizeDecisionQuestions([question({ options: Array.from({ length: 5 }, (_, i) => ({ label: `o${i}` })) })]), /2-4 entries/)
  assert.throws(() => normalizeDecisionQuestions([question({ header: '' })]), /header is required/)
  assert.throws(() => normalizeDecisionQuestions([question({ question: '' })]), /question is required/)
})

test('「其他」不许调用方自己声明 —— 它由界面补', () => {
  assert.throws(
    () => normalizeDecisionQuestions([question({ options: [{ label: 'A' }, { label: DECISION_OTHER_LABEL }] })]),
    /added by the interface/
  )
})

test('request 挂起直到有人回答,同一个 id 只认第一次', async () => {
  const pendingBefore = agentDecisionRegistry.list().length
  let settled = false
  const promise = agentDecisionRegistry.request('chat-a', normalizeDecisionQuestions([question()]))
  promise.then(() => { settled = true })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(settled, false, '没人回答之前必须一直挂着')
  const entry = agentDecisionRegistry.list().find((item) => item.sessionId === 'chat-a')
  assert.ok(entry, '待答的卡要能被渲染端列出来')
  assert.equal(agentDecisionRegistry.resolve({ decisionId: entry.decisionId, picked: [['A']] }).ok, true)
  assert.deepEqual((await promise).picked, [['A']])
  assert.equal(agentDecisionRegistry.resolve({ decisionId: entry.decisionId, picked: [['B']] }).ok, false, '重复回答不认')
  assert.equal(agentDecisionRegistry.list().length, pendingBefore, '答完就从待答表里消失')
})

test('会话被停掉时,它名下挂着的拍板一律以取消了结 —— 否则那个工具调用永远挂着', async () => {
  const promise = agentDecisionRegistry.request('chat-doomed', normalizeDecisionQuestions([question()]))
  agentDecisionRegistry.cancelSession('chat-doomed')
  assert.equal((await promise).cancelled, true)
  assert.equal(agentDecisionRegistry.list().some((item) => item.sessionId === 'chat-doomed'), false)
})

const tool = readFileSync(join(APP_ROOT, 'src/main/agent/tools/decisionTools.ts'), 'utf8')

test('取消返回一段明确的话,不是异常也不是空', () => {
  assert.match(tool, /chose not to answer it/, '措辞要让模型知道"人看见了、选择不回答"')
  assert.doesNotMatch(tool, /throw new Error\('cancel/i, '取消不是异常 —— 异常会中止回合')
})

test('工具说明里写死了「不要自己加 other」', () => {
  assert.match(tool, /NEVER add an "other".*the interface always appends a free-text one/s)
  assert.match(tool, /BLOCKS until the user answers/, '阻塞语义必须写给模型看,否则它会结束回合再问')
})

const sheet = readFileSync(join(APP_ROOT, 'src/renderer/maestro/control/src/task/DecisionSheet.vue'), 'utf8')

test('卡在底面、不在时间线里,并且空的「其他」不能提交', () => {
  assert.match(sheet, /pendingDecisionMessages\(props\.session\)\[0\]/, '一次只画一张')
  assert.match(sheet, /!picks\.includes\(DECISION_OTHER_LABEL\) \|\| other\.value\[q\]\.trim\(\)\.length > 0/,
    '选了"其他"却没填,不是一个决定')
  assert.match(sheet, /label === DECISION_OTHER_LABEL \? other\.value\[q\]\.trim\(\) : label/,
    '提交时哨兵要换成人打的原文,不能漏到模型眼前')
})

const service = readFileSync(join(APP_ROOT, 'src/main/agent/maestroAgent.service.ts'), 'utf8')

test('Stop 会话时确实调了 cancelSession —— 定义了不调用等于没写', () => {
  // 这条守的不是"有这个方法",而是"abortAgent 真的用了它"。`ask_user` 阻塞,
  // 没人 resolve 那个工具调用就永远挂着,而它所在的回合已经没了。
  const abort = service.slice(service.indexOf('async abortAgent('))
  const body = abort.slice(0, abort.indexOf('\n  async '))
  assert.match(body, /agentDecisionRegistry\.cancelSession\(sessionKey\)/)
})

const control = readFileSync(join(APP_ROOT, 'src/renderer/maestro/control/src/ControlApp.vue'), 'utf8')

test('挂在滚动容器之外,与 ChatConfirmSheet 并列', () => {
  assert.match(control, /<ChatConfirmSheet :session="activeSession" \/>\n(?:\s*<!--[\s\S]*?-->\n)?\s*<DecisionSheet :session="activeSession" \/>/)
})
