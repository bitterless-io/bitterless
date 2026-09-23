import type { ShortcutCommit, ShortcutItem, ShortcutRunContext, ShortcutSkillItem, SlashToken } from './shortcut.type'

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

/**
 * 技能目录 → `/` 面板的技能条目。**纯函数**,所以「哪些技能能进面板」这条判据可以脱离 DOM 被直接测 ——
 * 它原来藏在已删除的 SkillPicker 的 `available()` 里,那是上一版唯一被守卫钉住的地方。
 *
 * 只收**当前可用**的:坏包、未归属、被停用的不进面板 —— 面板是"能用的东西"的清单,诊断在 Workbench。
 * 入参按结构收(不 import `SkillSummary`),这个 store 至今只有一条 `import type`,守卫因此能把它当纯
 * 模块跑;拖进 app 的类型链就没有这个性质了。
 */
export interface SkillCatalogRow {
  reference?: string
  name: string
  displayName?: string
  layer?: string
  path: string
  status?: string
  scope?: string
  enabled?: boolean
  allowImplicitInvocation?: boolean
}
export const skillShortcutRows = (
  skills: readonly SkillCatalogRow[],
  describe: (row: SkillCatalogRow) => string
): ShortcutSkillItem[] =>
  skills
    .filter((skill) => Boolean(skill.reference) && skill.status === 'ready' && skill.scope !== 'unassigned' && skill.enabled !== false)
    .map((skill) => ({
      kind: 'skill' as const,
      name: `/${skill.name}`,
      hint: describe(skill),
      skill: { reference: skill.reference!, name: skill.displayName || skill.name, layer: skill.layer || 'global', path: skill.path }
    }))

export class ShortcutStore {
  open = false
  query = ''
  activeIndex = 0
  pending = false

  /**
   * 技能条目。**与 `items` 分开存**(契约「Skills in the slash menu」):命令那份是编译期就闭合的
   * 字面量集合,技能来自磁盘、随会话变;混在一起就没法再断言"命令集合没有被悄悄改大"。
   * 由 `ChatPanel` 拉到目录后喂进来 —— store 仍然只有一条 `import type`,可脱离 DOM 直接跑。
   */
  skills: ShortcutSkillItem[] = []

  constructor(readonly items: ShortcutItem[]) {}

  get matches(): ShortcutItem[] {
    const query = this.query.toLowerCase()
    const byName = (a: ShortcutItem, b: ShortcutItem): number => a.name < b.name ? -1 : a.name > b.name ? 1 : 0
    const matching = (list: ShortcutItem[]): ShortcutItem[] =>
      list.filter((item) => `${item.name} ${item.hint}`.toLowerCase().includes(query)).sort(byName)
    // 命令块 ASCII 有序,技能块 ASCII 有序,命令全部在技能之前。
    // 没有技能时结果与只排 `items` 时逐字节相同。
    return [...matching(this.items), ...matching(this.skills)]
  }

  registerSkills(skills: ShortcutSkillItem[]): void { this.skills = skills }

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
    // 技能不是命令:没有执行体,只把选中的那个交回给面板去挂。放在 try 之前是因为它不会抛 ——
    // 下面那个 switch 的每一条都是一次真的调用,这条不是。
    if (item.kind === 'skill') { this.pending = false; return { ok: true, skill: item.skill } }
    const { name } = item
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
        case '/export':
          await context.exportSession()
          return { ok: true }
        case '/page_snapshot':
          await context.copyPageSnapshot()
          return { ok: true }
        case '/page_snapshot_compare':
          await context.exportPageSnapshotCompare()
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
          // `item` 在这里被收窄成 `never`(每个命令名都已分派),所以名字要从收窄之前取 ——
          // 这正是「漏接一条 = 可见的失败」那条设计还活着的证据。
          return { ok: false, error: `unknown command ${name}` }
      }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    } finally {
      this.pending = false
    }
  }
}
