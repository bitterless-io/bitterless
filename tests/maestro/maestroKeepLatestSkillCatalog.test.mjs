import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { transpileModule, ModuleKind, ScriptTarget } from 'typescript'

const SOURCE = join(import.meta.dirname, '../../src/main/agent/runtime/keepLatestSkillCatalog.ts')
const compiled = transpileModule(readFileSync(SOURCE, 'utf8'), {
  compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 }
}).outputText
const { keepLatestSkillCatalog, measureSkillCatalogs, SKILL_CATALOG_START, SKILL_CATALOG_END } =
  await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)

const catalog = (rev, bulk = 2000) =>
  `${SKILL_CATALOG_START}\n{"catalogRevision":"${rev}","skills":[${'"x",'.repeat(bulk)}"end"]}\n${SKILL_CATALOG_END}`
const user = (say, rev) => ({ role: 'user', content: [{ type: 'text', text: `${say}\n${catalog(rev)}` }] })
const userStr = (say, rev) => ({ role: 'user', content: `${say}\n${catalog(rev)}` })
const assistant = say => ({ role: 'assistant', content: [{ type: 'text', text: say }] })
const textOf = m => Array.isArray(m.content) ? m.content.map(b => b.text ?? '').join('') : String(m.content ?? '')
const carriers = list => list.filter(m => textOf(m).includes(SKILL_CATALOG_START)).length

test('一个会话只留一份 —— 只有最后一条带目录', () => {
  const messages = [user('一', 'r1'), assistant('ok'), user('二', 'r2'), assistant('ok'), user('三', 'r3')]
  assert.equal(carriers(messages), 3, '前提:每条用户消息本来都带')
  const out = keepLatestSkillCatalog(messages)
  assert.equal(carriers(out), 1)
  assert.ok(textOf(out.at(-1)).includes('"catalogRevision":"r3"'), '留下的必须是最新那份')
  assert.match(textOf(out[0]), /\[skill-catalog superseded\]/)
  assert.match(textOf(out[0]), /revision r3/, '占位行要指向当前那一份')
})

test('省下的量 —— 4 轮场景对齐 BL 实测形状', () => {
  const messages = [user('一', 'r1'), user('二', 'r1'), user('三', 'r1'), user('四', 'r1')]
  const out = keepLatestSkillCatalog(messages)
  const m = measureSkillCatalogs(messages, out)
  assert.equal(m.supersededMessages, 3)
  assert.ok(m.afterChars < m.beforeChars / 3, `应砍掉约 3/4,实际 ${m.beforeChars} → ${m.afterChars}`)
})

test('用户原话一个字不动', () => {
  const messages = [user('帮我登录下 ops 通用', 'r1'), user('然后帮我登录下', 'r2')]
  const out = keepLatestSkillCatalog(messages)
  assert.match(textOf(out[0]), /^帮我登录下 ops 通用\n/)
  assert.ok(!textOf(out[0]).includes('"catalogRevision"'))
})

test('string content 与 block content 都支持', () => {
  const messages = [userStr('一', 'r1'), userStr('二', 'r2')]
  const out = keepLatestSkillCatalog(messages)
  assert.equal(carriers(out), 1)
  assert.equal(typeof out[0].content, 'string')
  assert.match(out[0].content, /\[skill-catalog superseded\]/)
})

test('只动 user —— assistant 与 toolResult 一律不碰', () => {
  const messages = [
    { role: 'assistant', content: [{ type: 'text', text: catalog('r0') }] },
    { role: 'toolResult', toolName: 'x', content: [{ type: 'text', text: catalog('r0') }] },
    user('一', 'r1'), user('二', 'r2')
  ]
  const out = keepLatestSkillCatalog(messages)
  assert.ok(textOf(out[0]).includes(SKILL_CATALOG_START), 'assistant 不碰')
  assert.ok(textOf(out[1]).includes(SKILL_CATALOG_START), 'toolResult 不碰')
  assert.equal(carriers(out.slice(2)), 1)
})

test('幂等 + 无变更时返回原引用', () => {
  const messages = [user('一', 'r1'), user('二', 'r2')]
  const once = keepLatestSkillCatalog(messages)
  const twice = keepLatestSkillCatalog(once)
  assert.equal(twice, once, '第二遍不该再动,连引用都不换')
  assert.equal(measureSkillCatalogs(once, twice).supersededMessages, 0)
})

test('只有一份时原样返回', () => {
  const messages = [assistant('hi'), user('一', 'r1')]
  assert.equal(keepLatestSkillCatalog(messages), messages)
})

test('一条都没有时原样返回', () => {
  const messages = [assistant('hi'), { role: 'user', content: [{ type: 'text', text: '没有目录' }] }]
  assert.equal(keepLatestSkillCatalog(messages), messages)
})

test('纯函数:不改动入参', () => {
  const messages = [user('一', 'r1'), user('二', 'r2')]
  const before = messages.map(textOf)
  keepLatestSkillCatalog(messages)
  assert.deepEqual(messages.map(textOf), before)
})

test('一条消息里有多份也全部替换', () => {
  const messages = [
    { role: 'user', content: [{ type: 'text', text: `甲\n${catalog('r1')}\n乙\n${catalog('r1')}` }] },
    user('二', 'r2')
  ]
  const out = keepLatestSkillCatalog(messages)
  assert.ok(!textOf(out[0]).includes(SKILL_CATALOG_START))
  assert.equal((textOf(out[0]).match(/\[skill-catalog superseded\]/g) || []).length, 2)
  assert.match(textOf(out[0]), /^甲\n/)
})

test('缺 catalogRevision 时占位行不编版本号', () => {
  const bare = `${SKILL_CATALOG_START}\n{"skills":[]}\n${SKILL_CATALOG_END}`
  const messages = [
    { role: 'user', content: [{ type: 'text', text: `一\n${bare}` }] },
    { role: 'user', content: [{ type: 'text', text: `二\n${bare}` }] }
  ]
  const out = keepLatestSkillCatalog(messages)
  assert.match(textOf(out[0]), /\[skill-catalog superseded\]/)
  assert.ok(!/revision /.test(textOf(out[0])), '取不到版本就不写,不许编一个')
})

test('空数组与非数组输入安全返回', () => {
  assert.deepEqual(keepLatestSkillCatalog([]), [])
  assert.equal(keepLatestSkillCatalog(undefined), undefined)
})
