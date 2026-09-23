/**
 * 守卫:按角色裁剪**不可能丢掉一个可操作元素**。
 *
 * 这是 `snapshotPrune.ts` 唯一站得住的理由 —— 它敢在选段之前上,就是因为它丢的只有
 * 纯展示文字。这条不变量一旦破了,裁剪就和选段一样有"看不见"的风险,必须立刻知道。
 *
 * 用 esbuild 真编译源文件,不做正则剥类型:`check-snapshot-selects.mjs` 那套手写
 * `stripTs` 在 walker 签名一改就以语法错误的形式炸掉,是仓库里已知的脆弱点
 * (见 areas/agent-runtime/browser-use/page-snapshot.md 五)。
 */
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

const entry = fileURLToPath(new URL('../../src/main/maestro/drive/snapshotPrune.ts', import.meta.url))
const bundled = await build({
  entryPoints: [entry],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  logLevel: 'silent'
})
const module = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`
)
const { pruneSnapshot, PRUNE_MIN_BYTES } = module

const ACTIONABLE = /^\s*-\s+(button|link|textbox|searchbox|combobox|checkbox|radio|tab|menuitem|switch|slider|option|spinbutton)\b/
const refsOf = (text) =>
  text
    .split('\n')
    .filter((line) => ACTIONABLE.test(line))
    .map((line) => (line.match(/\[ref=(e\d+)\]/) || [])[1])
    .filter(Boolean)

// 一份带页头、NOTE、表格数据、纯展示文字、嵌套容器的真实形状快照。
const filler = Array.from({ length: 400 }, (_, i) => `    - text: paragraph filler line ${i} with enough words to matter`).join('\n')
const snapshot = [
  '# tab: tab-1',
  '# page: https://example.test/patients',
  '# title: Patients',
  '# elements: 12',
  '# INCOMPLETE: 3 line(s) of text are rendered on this page but are NOT in the tree below (e.g. "X"). Treat this snapshot as a partial view: do NOT conclude content is absent.',
  '',
  '- banner [ref=e1]:',
  '  - link "Home" [ref=e2]:',
  '    - /url: /home',
  '  - text: a tagline nobody clicks',
  '- main [ref=e3]:',
  '  - heading "Patients" [level=1] [ref=e4]',
  '  - table [ref=e5]:',
  '    - row [ref=e6]:',
  '      - cell "张三" [ref=e7]',
  '      - button "Delete" [ref=e8]',
  '    - row [ref=e9]:',
  '      - cell "李四" [ref=e10]',
  '      - button "Delete" [ref=e11]',
  '  - generic [ref=e12]:',
  filler,
  '- dialog "Confirm" [ref=e13]:',
  '  - button "OK" [ref=e14]'
].join('\n')

assert.ok(snapshot.length >= PRUNE_MIN_BYTES, 'fixture must exceed the prune threshold or nothing is exercised')

const result = pruneSnapshot(snapshot)
assert.equal(result.pruned, true, 'a snapshot over the threshold must be pruned')

// 1 · 不变量:一个可操作 ref 都不能少。
const before = refsOf(snapshot)
const after = refsOf(result.text)
assert.deepEqual(after, before, `pruning dropped actionable refs: ${before.filter((r) => !after.includes(r)).join(', ')}`)

// 2 · 数据行必须留下 —— 「删掉张三那一行」要先看得见张三。
assert.match(result.text, /cell "张三"/, 'table data rows must survive pruning')
assert.match(result.text, /cell "李四"/, 'table data rows must survive pruning')

// 3 · dialog 必须留下 —— 弹窗是业务 agent 的主场。
assert.match(result.text, /dialog "Confirm"/, 'dialogs must survive pruning')

// 4 · 页头与 INCOMPLETE 必须留下(它们是 agent 判断"这是局部视图"的唯一依据)。
assert.match(result.text, /^# tab: tab-1$/m, 'header must survive')
assert.match(result.text, /# INCOMPLETE:/, 'the partial-view warning must survive')

// 5 · 真的省下了东西,而且返回的是原文的子集(只删不写)。
assert.ok(result.droppedBytes > 0, 'pruning must actually drop bytes')
for (const line of result.text.split('\n')) {
  assert.ok(snapshot.includes(line), `pruning emitted a line that is not in the original: ${line.slice(0, 80)}`)
}

// 6 · 阈值以下一行不动。
const small = pruneSnapshot('# tab: t\n\n- button "Go" [ref=e1]')
assert.equal(small.pruned, false, 'a small snapshot must be returned untouched')

console.log(`[check-snapshot-prune] ok — ${before.length} actionable refs preserved, ${result.droppedBytes} bytes dropped`)
