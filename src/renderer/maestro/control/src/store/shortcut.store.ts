import type { ShortcutCommit, ShortcutItem, ShortcutRunContext, SlashToken } from './shortcut.type'

/** Exact host command; a path or longer command name stays ordinary input. */
export const parseCompactCommand = (text: string): { instructions?: string } | null => {
  const match = text.trim().match(/^\/compact(?:\s+([\s\S]*))?$/)
  return match ? { instructions: match[1]?.trim() || undefined } : null
}

export const slashTokenAt = (text: string, caret: number): SlashToken | null => {
  const before = text.slice(0, caret)
  const match = /(?:^|\n)\/([\w-]*)$/.exec(before)
  if (!match) return null
  // Do not turn the first slash of a path into a command when its suffix is after the caret.
  if (text[caret] && !/\s/.test(text[caret])) return null
  return { query: match[1], start: caret - match[1].length - 1, end: caret }
}

export class ShortcutStore {
  open = false
  query = ''
  activeIndex = 0
  pending = false

  constructor(readonly items: ShortcutItem[]) {}

  get matches(): ShortcutItem[] {
    const query = this.query.toLowerCase()
    return this.items.filter((item) => `${item.name} ${item.hint}`.toLowerCase().includes(query))
      .sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
  }

  get active(): ShortcutItem | undefined { return this.matches[this.activeIndex] }

  update(token: SlashToken | null): void {
    if (!token) { this.close(); return }
    if (!this.open || this.query !== token.query) this.activeIndex = 0
    this.query = token.query
    this.open = true
  }

  close(): void { this.open = false; this.query = ''; this.activeIndex = 0 }

  move(delta: number): void {
    if (!this.matches.length) return
    this.activeIndex = (this.activeIndex + delta + this.matches.length) % this.matches.length
  }

  async commit(context: ShortcutRunContext): Promise<ShortcutCommit> {
    const item = this.active
    if (!this.open || !item || this.pending) return { ok: false }
    this.pending = true
    this.close()
    try {
      // **每条命令都显式分派。** 原来是「不是 /clear 就当 copyContext」的兜底 ——
      // 那种写法在加第三条命令的那一刻就会静默跑错一条,而且不会有任何类型错误。
      // 现在漏接一条的表现是 `unknown command`(可见的失败),不是跑错。
      switch (item.name) {
        case '/test_auto_compact':
          await context.testAutoCompaction()
          return { ok: true }
        case '/compact':
          await context.compact()
          return { ok: true }
        case '/workflow':
          await context.listWorkflows()
          return { ok: true }
        case '/clear':
          return { ok: await context.newChat() }
        case '/view_context':
          await context.copyContext()
          return { ok: true }
        case '/copy_session_path':
          await context.copySessionPath()
          return { ok: true }
        case '/test_show_error':
          await context.testShowError()
          return { ok: true }
        // 结构与 `/view_context` 是**两条不同的命令**,不是重复:那条出正文(逐字、不截断,
        // 所以去剪贴板),这条出结构(类型 / 体量 / 回合 / 压缩边界,有界投影,所以进弹窗)。
        // 成功不回 error:弹窗本身就是结果,再补一句 toast 是替它证明自己。
        case '/view_context_graph':
          await context.openContextGraph()
          return { ok: true }
        default:
          return { ok: false, error: `unknown command ${item.name}` }
      }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    } finally {
      this.pending = false
    }
  }
}
