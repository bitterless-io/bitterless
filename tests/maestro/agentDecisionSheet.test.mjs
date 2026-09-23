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

/**
 * ── 2026-09-23 补的三条(`docs/issues/ask-user-answer-leaves-no-trace.md`)──────────────────
 *
 * Ral 报的两件事:「JSON schema 支持多选」「答完之后答案没有渲染在 UI 上」。
 * 两件事的共同点是 —— **能力早就接上了,只是从人这一侧够不着**:
 * `multiSelect` 契约、normalize、toggle 三处都在,但卡上看不出来、说明里也没教模型开;
 * decision 消息投影出来了、`picked` 也写回去了,但 `MessageItem` 没有这一支,没人画。
 */

const record = readFileSync(join(APP_ROOT, 'src/renderer/maestro/control/src/task/DecisionRecord.vue'), 'utf8')
const item = readFileSync(join(APP_ROOT, 'src/renderer/maestro/control/src/MessageItem.vue'), 'utf8')

test('答案有落点:时间线上有一个独立组件画它,而不是答完就消失', () => {
  assert.match(item, /const isDecisionRow = computed\(\(\) => props\.message\.type === 'decision'\)/,
    '`type: decision` 必须有自己的分支 —— 原来只有 task / confirm 两支');
  assert.match(item, /<DecisionRecord v-else-if="isDecisionRow" :message="props\.message" \/>/);
  assert.match(item, /isTaskRow\.value \|\| isConfirmRow\.value \|\| isDecisionRow\.value\) return false/,
    '它是无气泡的时间线条目 —— 套气泡等于两层壳');
  assert.match(record, /picked\.value\?\.\[q\] \|\| \[\]/, '画的是**答案**,不只是把问题重复一遍');
  assert.match(record, /cancelled/, '第三态:人看见了、选择不回答');
});

test('留档只留档,不第二次提供操作入口', () => {
  assert.doesNotMatch(record, /answerDecision|@click/, '两处都能点是有前车之鉴的,操作只在底面那张卡上');
});

test('多选:卡上说得出来,说明里也教了模型什么时候开', () => {
  assert.match(sheet, /const isMulti = \(q: number\): boolean => decision\.value\?\.questions\[q\]\?\.multiSelect === true/);
  assert.match(sheet, /v-if="isMulti\(q\)"/, '多选的那一问要显式标出来,不能和单选长得一模一样');
  assert.match(sheet, /isMulti\(q\) && isPicked\(q, option\.label\)/, '选中记号要让人看出「还能再点一个」');
  assert.match(tool, /Set multiSelect to true when several answers can hold at once/,
    '说明里只出现一个写死的 `"multiSelect": false`,模型读到的是「这个值是 false」而不是「你可以开」');
});

/**
 * **这一支没有 Tailwind。** `electron.vite.config.ts` 里没有 `@tailwindcss/vite`(cowork 那边才有),
 * 所以从 cowork 逐字移植过来的 `flex gap-3 rounded-xl bg-[#f8fafc]` 在 bitterless 里一条都不生效 ——
 * 卡片渲染成裸 div + 裸 button(Chromium 给裸 button 的默认样式正是灰底 + 1px 边框)。
 * 同一类坑在 `IconBtn` 上踩过一次(CLAUDE.md 的 Borderless UI):
 * 「那个组件是无边框的」不可继承,必须在**真正加载这张皮的界面**里验。
 */
test('这两个组件的样式落在真正会被加载的 .less 里,而不是无效的 utility class', () => {
  for (const [name, source] of [['DecisionSheet', sheet], ['DecisionRecord', record]]) {
    assert.match(source, new RegExp(`import '\\./${name}\\.less'`), `${name} 要引自己的 .less`);
    assert.doesNotMatch(source, /class="[^"]*\b(flex|gap-\d|rounded-(?:lg|xl|md)|text-\[\d+px\]|bg-\[#)/,
      `${name} 里不许留 Tailwind utility —— 这一支不编译它们,写了也是死字`);
  }
});
