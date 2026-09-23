// ══ 行为守卫 ══ 聊天正文里的文件链接 —— 渲染成链接 · 悬浮给可读全路径 · 点击进 OnlyPreview
//
// docs/issues/chat-file-link-opens-finder.md。Ral 2026-09-23:「以 cowork 交互为准」。
//
// 这份守卫**过真的 Markdown 解析器**,不是断言函数在。cowork 那边同一块的教训值得抄过来:
// 它的守卫只测了 encode↔decode 往返一致,两端都对,**中间那层(渲染器认不认)从来没人跑过**,
// 于是在链接完全失效的情况下保持全绿(micromeet-cowork 的
// docs/issues/file-link-with-space-is-not-a-link.md)。
import { readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { marked } from 'marked'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => readFileSync(join(root, rel), 'utf8')

let failures = 0
const check = (label, ok, why = '') => {
  if (ok) return
  failures += 1
  console.error(`✗ ${label}${why ? ` — ${why}` : ''}`)
}

// ── 取 mdTitle + mdDirLink 两个纯函数跑真代码 ────────────────────────────────────────────────────
const archive = read('src/main/maestro/files/workspaceArchive.service.ts')
const from = archive.indexOf('const mdTitle =')
const to = archive.indexOf('export class WorkspaceArchiveService')
check('guard can locate mdTitle/mdDirLink', from >= 0 && to > from, 'workspaceArchive 的结构变了,守卫要跟着改')
const pure = archive.slice(from, to) + '\nmodule.exports = { mdDirLink, mdTitle }\n'
const compiled = ts.transpileModule(pure, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText
const sandbox = { exports: {}, module: { exports: {} }, basename, console }
runInNewContext(compiled, sandbox)
const { mdDirLink } = sandbox.module.exports

const anchor = (html) => /^<a href="([^"]*)"(?: title="([^"]*)")?[^>]*>(.*)<\/a>$/.exec(String(html).trim())
const unescape = (s) => String(s ?? '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'")

// ── ① 真的渲染成链接,且只露文件名 ─────────────────────────────────────────────────────────────
for (const path of [
  '/tmp/report.md',
  '/Users/ral/tmp/Trial 1 NPG/output/s0_2/DECISIONS.md',
  '/tmp/Granostic_Trial_1 (1)/notes.md',
  '/tmp/100% done.md',
  '/用户/ral/报告 2026.md',
  '/tmp/a (b) "q".md'
]) {
  const html = marked.parseInline(mdDirLink(path))
  const m = anchor(html)
  check(`renders as a link: ${path}`, Boolean(m), `marked produced ${JSON.stringify(String(html).slice(0, 140))}`)
  if (!m) continue
  check(`href decodes back: ${path}`, decodeURIComponent(m[1]) === path.replace(/\\/g, '/'),
    `decoded to ${JSON.stringify(decodeURIComponent(m[1]))}`)
  // 可见文字只能是文件名 —— URL 露在正文里正是 cowork 那次报的现象。
  check(`only the file name is visible: ${path}`, unescape(m[3]).replace(/\\(.)/g, '$1') === basename(path),
    `visible text was ${JSON.stringify(unescape(m[3]))}`)
  // ── ② 悬浮给的是可读全路径,不是 %20 那串 ──
  check(`hover shows the readable path: ${path}`, unescape(m[2]) === path,
    `title was ${JSON.stringify(unescape(m[2]))}`)
}

// 断电反验:title 里的引号不转义,带 `"` 的文件名会整条断掉 —— 用一类断链换另一类。
check(
  'negative control: an unescaped quote in the title breaks the whole link',
  !anchor(marked.parseInline('[x](/tmp/a.md "a "q".md")')),
  'a raw quote no longer breaks parsing, so escaping it proves nothing'
)
// 断电反验:目标里留个裸空格就不再是链接(cowork 正是栽在这一条上)。
check(
  'negative control: an unescaped space stops being a link',
  !anchor(marked.parseInline('[x](/tmp/a b.md)')),
  'marked parsed a destination containing a raw space, so this gate proves nothing'
)

// ── ③ 单击进 OnlyPreview,不是访达 ─────────────────────────────────────────────────────────────
// Ral 2026-09-23「以 cowork 交互为准」。cowork 2026-09-08 就改了,本仓当时没跟上,
// 而 docs/INDEX.md 里那条却写着「synced to bitterless」—— 文档与代码对不上。
const messageItem = read('src/renderer/maestro/control/src/MessageItem.vue')
const clickBody = messageItem.slice(messageItem.indexOf('const onMarkdownClick'), messageItem.indexOf('const onMarkdownContextMenu'))
check('a single click opens the in-app Preview', /previewLocalFile\(/.test(clickBody),
  '正文链接的单击必须走 OnlyPreview')
check('a single click no longer reveals in the OS file manager', !/showFileInFolder\(/.test(clickBody),
  'showFileInFolder 会把人踢去访达 —— 那是 2026-09-08 之前的行为')
check('previewLocalFile goes through openWorkspaceInPreview',
  /const previewLocalFile[\s\S]{0,400}openWorkspaceInPreview/.test(messageItem))
// 打不开必须有反馈:静默 no-op 读起来就是"点了没反应"。
check('a failed open is reported', /const previewLocalFile[\s\S]{0,400}markMissing\(/.test(messageItem),
  '失败无声等于"点击坏了"')
// 产物条上的「在访达中显示」是另一个入口,保留 —— 这里只钉正文链接。
check('showFileInFolder still exists for the artifact strip', /const showFileInFolder/.test(messageItem))

console.log(failures ? `[check-chat-file-link] ${failures} assertion(s) failed` : '[check-chat-file-link] ok')
process.exit(failures ? 1 : 0)
