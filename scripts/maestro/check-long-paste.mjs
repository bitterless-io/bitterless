/* eslint-disable @typescript-eslint/explicit-function-return-type */
/*
 * 超长粘贴 → `<userData>/pastes/` 的文件,提示词里只留摘头摘尾 + 绝对路径。
 *
 * Ral 2026-09-11:「当用户粘贴的文字大小超过一定 size 时 作为临时文件放到提示词中」、
 * 「需要 `<userData>` 下有目录能存放这种文件」。
 *
 * 为什么值得一条守卫:这条路的两种失效**都不会报错**。
 *  · 阈值以下误触发 ⇒ 普通消息被换成引用块,模型每次都要多跑一次 `read`;
 *  · 发相对路径 ⇒ `<userData>` 在工作区之外,`read` 必然解析失败,而模型只会说"读不到文件"
 *    —— 和今天 `out/chain/<id>.md` 那批没人写的地址是同一类死链。
 */
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import ts from 'typescript'

const root = resolve(import.meta.dirname, '../..')
const require = createRequire(import.meta.url)

// 别名解析 —— `longPaste.service.ts` 从 `@maestro-shared/longPaste.contract` 取阈值
// (那个数必须与渲染端的原话链共用,见该文件)。不解析别名的话守卫会以 `Cannot find module`
// 整条挂掉,表现和一次真实回归一模一样。
const cache = new Map()
const load = (relPath) => {
  const file = relPath.endsWith('.ts') ? resolve(root, relPath) : resolve(root, `${relPath}.ts`)
  if (cache.has(file)) return cache.get(file).exports
  const out = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    fileName: file
  }).outputText
  const module = { exports: {} }
  cache.set(file, module)
  new Function('exports', 'require', 'module', '__filename', '__dirname', out)(
    module.exports,
    (child) => {
      if (child.startsWith('@maestro-shared/')) return load(`src/shared/maestro/${child.slice('@maestro-shared/'.length)}`)
      if (child.startsWith('.')) return load(resolve(file, '..', child).slice(root.length + 1))
      return require(child)
    },
    module,
    file,
    resolve(file, '..')
  )
  return module.exports
}

const fail = (message) => {
  console.error(`  ✗ ${message}`)
  process.exitCode = 1
}
const assertOk = (condition, message) => {
  if (!condition) fail(message)
}

const svc = load('src/main/agent/longPaste.service.ts')

// —— 1. 阈值两侧 ————————————————————————————————————————————————————————————
const dir = mkdtempSync(join(tmpdir(), 'bl-paste-'))
const short = 'x'.repeat(svc.LONG_PASTE_CHAR_THRESHOLD)
const shortResult = svc.offloadLongPaste({ dir, message: short, sessionId: 's1' })
assertOk(shortResult.text === short, '恰好等于阈值时必须原样返回(判据是严格大于)')
assertOk(!shortResult.path, '阈值以下不该落盘')
assertOk(readdirSync(dir).length === 0, '阈值以下不该在目录里留下任何文件')

const long = `PLEASE-REVIEW-THIS\n${'y'.repeat(svc.LONG_PASTE_CHAR_THRESHOLD)}\nTHATS-ALL-THANKS`
const longResult = svc.offloadLongPaste({ dir, message: long, sessionId: 'sess/with:odd*chars' })
assertOk(Boolean(longResult.path), '超过阈值必须落盘')
assertOk(longResult.originalChars === long.length, `originalChars 应如实报 ${long.length},实得 ${longResult.originalChars}`)

// —— 2. 落盘的是**逐字原文** ————————————————————————————————————————————————
// 这是整条特性的承重点:提示词里只剩摘要,文件是那段话唯一的完整副本。
assertOk(readFileSync(longResult.path, 'utf8') === long, '落盘内容必须与原文逐字相同')

// —— 3. 引用块 ——————————————————————————————————————————————————————————————
const { text } = longResult
// Ral 2026-09-11:「摘头摘尾 就没必要了」。所以引用块里**一个字原文都不该有** ——
// 这条断言同时也是那次决定的记录:哪天有人想把摘录加回来,先来改这里。
assertOk(!text.includes('PLEASE-REVIEW-THIS'), '引用块不该带摘头(Ral 2026-09-11:摘头摘尾没必要)')
assertOk(!text.includes('THATS-ALL-THANKS'), '引用块不该带摘尾')
assertOk(text.length < 600, `没有摘录时引用块应该很短,实得 ${text.length}`)
assertOk(text.includes(longResult.path), '引用块里必须有文件路径')
assertOk(text.includes('read'), '引用块必须点名用 `read` 工具 —— 不说清用什么读,模型会去问用户')
// 没有摘录 ⇒ 模型读文件之前对内容一无所知,所以必须明确要求它先读,否则它会拿着一个路径直接回答。
assertOk(/Read that file|before replying/.test(text), '必须明确要求模型先读那个文件 —— 没有摘录时它没有别的判断依据')

// **绝对路径**。`<userData>` 在工作区之外,相对路径必然解析失败;pi 内置 read 的
// `resolveToCwd` 对绝对路径原样返回(path-utils.js:72),这是它够得到的唯一形态。
assertOk(isAbsolute(longResult.path), `必须是绝对路径,实得 ${longResult.path}`)
const quoted = text.split('\n').find((line) => line.trim() === longResult.path)
assertOk(Boolean(quoted), '路径必须单独成行(嵌在句子里模型容易连标点一起抄进 read)')

// —— 4. 文件名:会话 id 里的路径字符不能漏进文件名 ——————————————————————————
// 传的 sessionId 是 `sess/with:odd*chars`。不清洗的话 `/` 会让 writeFileSync 写到子目录去
// (或直接 ENOENT),而这在真实会话 id 变形时才会暴露。
const name = longResult.path.slice(dir.length + 1)
assertOk(!name.includes('/') && !name.includes(':') && !name.includes('*'), `文件名必须已清洗,实得 ${name}`)
assertOk(name.endsWith('.txt'), '长粘贴原文落盘用 .txt')

// —— 5. 写盘失败时退回原文,不抛 ————————————————————————————————————————————
// 一次粘贴太大是可以降级的情形:原文进上下文只是占地方,把发送整个打断是用户立刻看得见的故障。
const denied = svc.offloadLongPaste({ dir: '/proc/nonexistent-cannot-mkdir', message: long, sessionId: 's2' })
assertOk(denied.text === long, '写盘失败必须退回原文')
assertOk(Boolean(denied.error), '写盘失败必须把原因带出来供上游记日志')
assertOk(!denied.path, '写盘失败不该报一个并不存在的路径')

// —— 6. 接线:必须挂在 sendAgentMessage 的入口 ——————————————————————————————
// 断开这根线,上面全部断言仍然全绿,而真实会话里一个字都不会被转存 —— 所以它必须单独钉。
const agentSrc = readFileSync(resolve(root, 'src/main/agent/maestroAgent.service.ts'), 'utf8')
assertOk(agentSrc.includes('offloadLongPaste'), 'maestroAgent.service 必须调用 offloadLongPaste')
assertOk(
  /const message = this\.offloadLongPasteIfNeeded\(params\.message\.trim\(\)/.test(agentSrc),
  'sendAgentMessage 必须在 trim() 之后、用于 route 之前就把超长粘贴换掉(那是用户文本进 agent 的唯一入口)'
)
const paths = readFileSync(resolve(root, 'src/main/maestro/llm/llmPaths.ts'), 'utf8')
// 只取定义那一行 —— 早先写成跨 200 字符的正则,结果匹配到了紧邻声明的 `maestroAgentDir`,
// 断言恒红。守卫误报和守卫漏报一样坏,所以判据收窄到它自己那一行。
const longPasteLine = paths.split('\n').find((line) => line.includes('export const maestroLongPasteDir')) || ''
assertOk(Boolean(longPasteLine), 'llmPaths 必须导出 maestroLongPasteDir')
assertOk(longPasteLine.includes("getPath('userData')"), '存放目录必须在 `<userData>` 下(Ral 2026-09-11 指定)')
assertOk(
  !longPasteLine.includes('maestroAgentDir') && !longPasteLine.includes('PI_DIR_NAME'),
  '不能放在 agentDir(`<userData>/.pi`)下 —— 那是 pi 的目录,它会扫 skills/、找 AGENTS.md、把 bin/ 当 TOOLS_DIR'
)


// —— 7. 长粘贴不可能被原话链绕回来 ————————————————————————————————————————
// 这一条此前是"两处阈值必须同数"(渲染端建链时代)。2026-09-11 把链搬到 main 之后,
// 那个失效模式**结构上不再存在** —— main 记进 jsonl 的就是它真正发出去的那一份
// (长粘贴已换成引用),链从 jsonl 建,原文没有任何路径能回到上下文。
// 所以这里钉的是那个结构事实,而不是两个数字相等。
const offloadLine = agentSrc.split('\n').findIndex((line) => line.includes('offloadLongPasteIfNeeded(params.message.trim()'))
const recordLine = agentSrc.split('\n').findIndex((line) => line.includes('this.recordUserChainMessage(message,'))
assertOk(offloadLine >= 0 && recordLine >= 0, '发送路径必须同时有"转文件"和"记历史"两步')
assertOk(
  offloadLine < recordLine,
  '**顺序是判据的一部分**:必须先转文件再记历史,否则 jsonl 里存的是原文,压缩后原话链会把它整个注回上下文'
)
assertOk(
  /recordUserChainMessage\(message,/.test(agentSrc) && !/recordUserChainMessage\(params\.message/.test(agentSrc),
  '记历史必须用 offload 之后的 `message`,不是 `params.message`(那是原文)'
)

// 阈值仍然只能有一处定义 —— main 与任何将来要判断它的地方共用。
const contract = readFileSync(resolve(root, 'src/shared/maestro/longPaste.contract.ts'), 'utf8')
assertOk(/export const LONG_PASTE_CHAR_THRESHOLD/.test(contract), '阈值必须定义在 shared 契约里')
const service = readFileSync(resolve(root, 'src/main/agent/longPaste.service.ts'), 'utf8')
assertOk(
  service.includes('@maestro-shared/longPaste.contract'),
  'longPaste.service 必须从 shared 契约取阈值,不能自己写一个数'
)

if (!process.exitCode) console.log('[check-long-paste] ok')
