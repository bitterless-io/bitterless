import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { build } from 'esbuild'

/**
 * 用户那句话必须能被结构识别出来,不能靠模型在几万字符里注意到一行字面量。
 *
 * 2026-09-18 实录(cowork,`agent-io/20260918174106964-9wkjcu7ohrkmu6rqkue`,本仓同一条路径):
 * Ral 发了 `hi`,这一轮的 user 消息是 **74,547 字符**,其中技能目录 53,993(72.4%)、
 * 钻探块 9,593(12.9%),而他打的字是 **2 个字符**,`User message:` 落在第 74,531 位 ——
 * 整条消息的最后 0.02%。模型把上面的指令墙当成了任务,自己编了一个"扫描代码库"的活,
 * 连跑 41 步 bash/read_file,一次纯文本回复都没有。`tool_choice` 是 `auto`,
 * 没有任何开关强制它调工具 —— 完全是提示词推出来的。
 *
 * 断言的是**结构**,不是措辞。见 docs/issues/turn-prompt-buries-the-user-message.md。
 */
const root = resolve(import.meta.dirname, '../..')
const output = await build({
  stdin: { contents: "export { buildAgentTurnPrompt, STATIC_TURN_GUIDANCE } from './src/main/agent/runtime/agentPrompt';", resolveDir: root, loader: 'ts' },
  bundle: true, write: false, platform: 'node', format: 'esm', tsconfig: resolve(root, 'tsconfig.node.json'),
  // 这个虚拟模块由打包插件在真实构建里提供。本测试只关心提示词的拼装,所以在这里把它解析成一个
  // 空模块 —— 标 external 不行:那样 `virtual:` 会原样留在产物里,Node 的 ESM loader 认不了它。
  plugins: [{
    name: 'stub-virtual-pi-skills',
    setup(ctx) {
      ctx.onResolve({ filter: /^virtual:/ }, ({ path }) => ({ path, namespace: 'stub' }))
      // 名字取自 piSkillSdk.ts 的再导出清单。提示词拼装真的会调 `formatSkillsForPrompt`,
      // 所以给的是**良性空值**,不是抛错的桩 —— 本测试断言的是围栏结构,技能正文是否为空无关。
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
const { buildAgentTurnPrompt, STATIC_TURN_GUIDANCE } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`)

const base = { nowLocal: '2026-09-18 17:41:08 +08:00 (Asia/Shanghai)', currentUrl: '', activeTab: null, openTabs: [], briefs: [] }
const buildPrompt = (message, extra = {}) => buildAgentTurnPrompt({ ...base, message, ...extra })

test('请求被围栏包起来,而且围栏是最后一段', () => {
  const prompt = buildPrompt('hi')
  const open = prompt.indexOf('<user_message>')
  const close = prompt.indexOf('</user_message>')
  assert.ok(open > 0, '必须有开围栏')
  assert.ok(close > open, '必须有闭围栏')
  assert.equal(prompt.slice(open + '<user_message>'.length, close).trim(), 'hi', '围栏里正好是用户那句话')
  assert.equal(
    prompt.slice(close + '</user_message>'.length).trim(),
    '',
    '围栏之后不能再有内容 —— 一旦有,模型最后读到的又不是请求了'
  )
})

test('围栏前面明说上面是参考资料,不是任务', () => {
  const preamble = buildPrompt('hi').split('<user_message>')[0]
  assert.match(preamble, /REFERENCE MATERIAL/, '要点明上面那一大片的性质')
  assert.match(preamble, /not a request|is not a task list/i, '要明确否定「它是任务」这个读法')
  assert.match(preamble, /ONLY thing you were asked to/i, '要指明唯一的请求在哪')
})

test('闲聊逃生阀按请求本身判,并覆盖全部工具', () => {
  // 2026-09-22:逃生阀是常量,已从**每轮消息**搬到**系统提示词**(表 2 产品层,
  // `MaestroAgent.systemPrompt()` → `STATIC_TURN_GUIDANCE`)。模型照样每次都读得到,
  // 但不再聊 N 轮发 N 遍(closeout1 B4)。守卫钉的还是同三件事,只是换了落点。
  assert.match(STATIC_TURN_GUIDANCE, /GREETINGS AND SMALL TALK GET A PLAIN REPLY/, '问候要有明确判据')
  assert.match(STATIC_TURN_GUIDANCE, /call NO tool at all/i, '覆盖全部工具,不只是浏览器那一组')
  // 原来那条只在用户「明确要求」时才生效 —— 一句 hi 触发不了它的任何一个条件。留着它没问题,
  // 但它不能是唯一的一条,否则这次的回归会原样复发。
  const explicitOnly = STATIC_TURN_GUIDANCE.indexOf('If the user explicitly asks for a chat-only answer')
  const byRequest = STATIC_TURN_GUIDANCE.indexOf('GREETINGS AND SMALL TALK')
  assert.ok(byRequest >= 0 && byRequest < explicitOnly, '按请求判的那条要在前面,不能只留「明确要求」那条')
  assert.ok(!buildPrompt('hi').includes('GREETINGS AND SMALL TALK'), '常量不该回到每轮消息里')
})

test('旧的裸 `User message:` 收尾不能再出现', () => {
  assert.doesNotMatch(
    buildPrompt('hi'),
    /\nUser message:\n/,
    '这正是 2026-09-18 那次回归的形状:一行字面量当分界,模型在 74k 字符里看不见它'
  )
})

test('围栏原样保留用户的内容,不做任何改写', () => {
  // 多行、含 XML 尖括号、含中文 —— 围栏只做分界,不负责转义,所以必须逐字保留。
  const message = '帮我看下 <div> 这个标签\n第二行\n第三行'
  const prompt = buildPrompt(message)
  const open = prompt.indexOf('<user_message>') + '<user_message>'.length
  assert.equal(prompt.slice(open, prompt.indexOf('</user_message>')).trim(), message)
})

test('空消息也保持同一个形状 —— 水合/steering 会用空串预热', () => {
  const prompt = buildPrompt('')
  assert.ok(prompt.includes('<user_message>'), '空消息不能把围栏整段省掉')
  assert.ok(prompt.trimEnd().endsWith('</user_message>'), '结构不随内容变化')
})
