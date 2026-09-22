import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { resolve } from 'node:path'
import { build } from 'esbuild'

const APP_ROOT = resolve(import.meta.dirname, '../..')
const output = await build({
  stdin: {
    contents: "export { buildAgentTurnPrompt, buildSessionSkillGuidance, STATIC_TURN_GUIDANCE } from './src/main/agent/runtime/agentPrompt'; export { DRILL_BUILTIN_SKILL, DRILL_ROUTE } from './src/main/agent/drill.skill';",
    resolveDir: APP_ROOT, loader: 'ts'
  },
  bundle: true, write: false, platform: 'node', format: 'esm', tsconfig: resolve(APP_ROOT, 'tsconfig.node.json'),
  // 虚拟模块由打包插件在真实构建里提供;本测试只关心提示词的拼装,给良性空值即可。
  plugins: [{
    name: 'stub-virtual-pi-skills',
    setup(ctx) {
      ctx.onResolve({ filter: /^virtual:/ }, ({ path }) => ({ path, namespace: 'stub' }))
      ctx.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
        contents: [
          'export const formatSkillsForPrompt = () => ""',
          'export const loadSkillsFromDir = () => ({ skills: [] })',
          'export const parseFrontmatter = () => ({})',
          'export const createSyntheticSourceInfo = () => ({})',
          'export const getShellConfig = () => ({})',
          'export const getPowerShellConfig = () => ({})'
        ].join('\n'),
        loader: 'js'
      }))
    }
  }]
})
const real = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`)

/**
 * 钻探是 builtin 技能:清单里一条简介,路由在 `DRILL_ROUTE`,循环正文在 `begin` 的回包里。
 *
 * 2026-09-18(cowork 实录,本仓同一条路径;Ral「钻探改为 builtin 技能」,执行 2026-09-16 的定案)之前,10,464 字符的完整钻探
 * 流程零插值、无开关地拼进**每一条** user 消息 —— 一条 `hi` 的 user 消息 74,547 字符里它占 12.9%,
 * steering 还要再发一次(issues/turn-prompt-buries-the-user-message.md)。
 *
 * 这条守卫钉三件事,都是"下次顺手加回去"最容易破的:
 *  · 循环正文**不在**每轮提示词里 —— 它归 `BEGIN_GUIDANCE`,按需交付;
 *  · `begin` 之前 / `end` 之后必须知道的路由**在**提示词里 —— 删过头会让模型不知道从哪开始;
 *  · `BEGIN_GUIDANCE` 确实覆盖了被删掉的那些主题 —— 否则"搬去按需交付"只是把它弄丢了。
 */
const { buildAgentTurnPrompt, buildSessionSkillGuidance, STATIC_TURN_GUIDANCE, DRILL_BUILTIN_SKILL, DRILL_ROUTE } = real

const prompt = buildAgentTurnPrompt({
  message: 'hi', nowLocal: '2026-09-18 17:41:08 +08:00 (Asia/Shanghai)', currentUrl: '', activeTab: null, openTabs: [], briefs: [DRILL_BUILTIN_SKILL]
})
const skillGuidance = buildSessionSkillGuidance({ briefs: [DRILL_BUILTIN_SKILL] })
const beginGuidance = readFileSync(join(APP_ROOT, 'src/main/maestro/sitemap/exploreSession.service.ts'), 'utf8')
  .split('const BEGIN_GUIDANCE = [')[1].split("].join(")[0]

/** 循环正文的特征句 —— 这些**只该**出现在 `begin` 的回包里。 */
const LOOP_ONLY = [
  'NEW TABS = BRANCH DRILL',
  'COMPLETION IS COVERAGE OF PLACES',
  'NAVIGATE BY CLICKING',
  'NARRATE AS YOU GO',
  'RECOVERY ONLY'
]

/** 路由 —— `begin` 之前或 `end` 之后才用得上,`BEGIN_GUIDANCE` 里没有。 */
const ROUTE_ONLY = [
  'start_recording {"mode":"api"}',
  'ingest_recording {"api": true, "ui": false}',
  'WHO SAYS "DONE"',
  'CONTINUING PART OF A SITE',
  'Already-explored site'
]

test('路由在系统提示词里,循环正文哪儿都不在', () => {
  // 2026-09-22:路由从**每轮消息**搬到**系统提示词**(表 2 产品层,`MaestroAgent.systemPrompt()`)。
  // 它零插值、与本轮无关,原先聊 N 轮就重发 N 遍(closeout1 B4)。守卫钉的仍是同三件事,
  // 只是第一件的落点从 `buildAgentTurnPrompt()` 换成 `STATIC_TURN_GUIDANCE`。
  for (const phrase of ROUTE_ONLY) {
    assert.ok(STATIC_TURN_GUIDANCE.includes(phrase), `路由缺了「${phrase}」—— 模型会不知道钻探从哪一步开始`)
  }
  for (const phrase of LOOP_ONLY) {
    assert.ok(!STATIC_TURN_GUIDANCE.includes(phrase), `「${phrase}」又回到常驻指引里了。它归 explore_session begin 的回包`)
    assert.ok(!prompt.includes(phrase), `「${phrase}」又回到每轮提示词里了`)
  }
})

test('路由不再每轮重发', () => {
  for (const phrase of ROUTE_ONLY) {
    assert.ok(
      !prompt.includes(phrase),
      `「${phrase}」还在每轮消息里。它是常量,该在系统提示词里发一次 —— `
      + '留在每轮等于聊 N 轮发 N 遍(closeout1 B4)'
    )
  }
})

test('被移出提示词的主题,BEGIN_GUIDANCE 真的接住了', () => {
  // 只断言"接住了",不断言用词 —— 两边措辞本来就不同,钉措辞会把守卫变成复读机。
  for (const topic of ['OBSERVE', 'ui_act', 'explore_record', 'module_done', 'need_login', 'BRANCH', 'commit control']) {
    assert.ok(
      beginGuidance.includes(topic),
      `BEGIN_GUIDANCE 里找不到「${topic}」—— 那这一段不是被搬走了,是被弄丢了`
    )
  }
})

test('BEGIN_GUIDANCE 没有的两条,路由里补着', () => {
  // 实测 BEGIN_GUIDANCE 里 `uncovered` 与 end 的强制前置都是 0 次。不补的话,模型只能靠撞
  // `end` 的拒绝才知道自己还没完 —— 可恢复,但白跑一轮。
  assert.ok(!beginGuidance.includes('uncovered'), '前提变了:BEGIN_GUIDANCE 现在自己讲 uncovered 了,这里可以删')
  assert.match(DRILL_ROUTE, /END IS GATED/, 'end 的强制前置要写在路由里')
  assert.match(DRILL_ROUTE, /uncovered/, 'uncovered 的结算方式要写在路由里')
})

test('简介留在技能清单里,并且自己就说得清怎么走', () => {
  assert.equal(DRILL_BUILTIN_SKILL.id, 'builtin:drill')
  // 清单条目是唯一的入口 —— 它必须自带四步路由,否则「简介进清单就行」不成立。
  assert.match(DRILL_BUILTIN_SKILL.description, /start_recording/)
  assert.match(DRILL_BUILTIN_SKILL.description, /explore_session/)
  assert.match(DRILL_BUILTIN_SKILL.description, /ingest_recording/)
  assert.match(DRILL_BUILTIN_SKILL.description, /不用 get_skill_contract/, '内置技能不走 contract,要写明')
  // 2026-09-22:内置文本流程清单也从每轮消息搬进系统提示词(`buildSessionSkillGuidance`,表 2)。
  // 它进不了 A8 那份目录(registry 的 catalogPrompt 按 status/scope 过滤),所以这条守卫是唯一
  // 钉住"简介没被弄丢"的地方 —— 落点换了,断言跟着换,意图不变。与 cowork 成对。
  assert.ok(skillGuidance.includes('"builtin:drill"'), '简介必须真的出现在会话级技能清单里')
  assert.ok(!prompt.includes('"builtin:drill"'), '简介又回到每轮消息里了 —— 它是会话常量,聊 N 轮会重发 N 遍')
})

test('钻探正文不再由 agentPrompt 自己持有', () => {
  const source = readFileSync(join(APP_ROOT, 'src/main/agent/runtime/agentPrompt.ts'), 'utf8')
  assert.ok(source.includes('DRILL_ROUTE'), 'agentPrompt 引用 DRILL_ROUTE')
  assert.ok(
    !source.includes('NEW TABS = BRANCH DRILL'),
    '钻探正文又被写回 agentPrompt 了 —— 它归 drill.skill.ts,清单/路由/正文各在其位'
  )
})
