import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
const APP_ROOT = new URL('../../', import.meta.url).pathname

/**
 * 「这条消息进不进模型的上下文」的**单一判据**
 * (`overmind:areas/agent-runtime/chat/message-types.html` #3 建议 1 / 2)。
 *
 * 照 pi 的两类做:`CustomEntry` 永不进、`CustomMessageEntry` 进。原来这件事是**十几处各自维护的
 * 一个布尔**(`promptExcluded`),由产生消息的那一处记得设 —— 漏设不报错,只会静默多喂或少喂一段。
 */
/** 渲染端模块 —— `loadMain` 只认 @main/ @shared/,这里直接转译求值(与 drill 那几个守卫同一种写法)。 */
const { entryClass, isCustomEntry } = (() => {
  const file = join(APP_ROOT, 'src/renderer/maestro/control/src/store/messageClass.ts')
  const out = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    fileName: file
  }).outputText
  const module = { exports: {} }
  runInNewContext(out, { module, exports: module.exports, require: () => ({}), Set })
  return module.exports
})()

const message = (over = {}) => ({ id: 'm1', source: 'cowork', role: 'ai', content: 'x', streaming: false, ts: 0, ...over })

test('永不进上下文的那几种 → custom', () => {
  for (const customType of ['task', 'confirm', 'decision', 'local-notice', 'failure']) {
    assert.equal(entryClass(message({ customType })), 'custom', customType)
    assert.equal(isCustomEntry(message({ customType })), true, customType)
  }
})

test('进上下文但要区别渲染的那几种 → custom_message', () => {
  // 今天只有压缩摘要一个成员 —— `user-selected` 2026-09-22 被否掉(拍板卡本身已经在左边)。
  for (const customType of ['compaction']) {
    assert.equal(entryClass(message({ customType })), 'custom_message', customType)
    assert.equal(isCustomEntry(message({ customType })), false, customType)
  }
})

test('普通对话消息 → message', () => {
  assert.equal(entryClass(message({ role: 'human', type: 'text' })), 'message')
  assert.equal(entryClass(message({ role: 'ai', type: 'text' })), 'message')
  assert.equal(entryClass(message({ role: 'human', type: 'files' })), 'message')
})

test('老数据没有 customType 也要归得对 —— 库里那些行不迁移', () => {
  assert.equal(entryClass(message({ type: 'task' })), 'custom')
  assert.equal(entryClass(message({ type: 'confirm' })), 'custom')
  assert.equal(entryClass(message({ type: 'decision' })), 'custom')
  assert.equal(entryClass(message({ localOnly: true })), 'custom')
  assert.equal(entryClass(message({ error: true })), 'custom')
  assert.equal(entryClass(message({ type: 'compact' })), 'custom_message')
})

test('投影的每一处都过这道闸,不再各自判 promptExcluded', () => {
  const store = readFileSync(join(APP_ROOT, 'src/renderer/maestro/control/src/store/message.store.ts'), 'utf8')
  for (const [name, src] of [['message.store', store]]) {
    for (const line of src.split('\n')) {
      if (!/if \(message\.promptExcluded/.test(line)) continue
      assert.fail(`${name}: 还有一处直接判 promptExcluded 而没先过 isCustomEntry —— ${line.trim()}`)
    }
  }
  assert.match(store, /isCustomEntry\(message\) \|\| message\.promptExcluded/)
})
