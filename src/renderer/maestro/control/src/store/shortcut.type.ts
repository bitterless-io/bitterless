export interface ShortcutCommandItem {
  kind: 'command'
  // 名字用下划线而不是空格:开菜单的 token 正则是 `\/([\w-]*)`,带空格的名字根本不会被识别成命令。
  // 与既有的 `/view_context` 同一个写法。
  name: '/test_auto_compact' | '/compact' | '/clear' | '/view_context' | '/copy_session_path' | '/export' | '/page_snapshot' | '/page_snapshot_compare' | '/test_show_error' | '/view_context_graph' | '/workflow'
  hint: string
}

/** 挂到下一次发送的技能 —— 与 `MaestroChatDetail['draft'].skill` 同形,composer 已经在存它。 */
export interface ShortcutSkill {
  reference: string
  name: string
  layer: string
  path: string
}

/**
 * 技能条目(2026-09-18,契约 `docs/features/maestro-slash-commands.md`「Skills in the slash menu」)。
 * 名字是**技能名前面加斜杠**,所以它和命令共用同一套渲染与键盘处理;`name` 不受命令那个字面量
 * 联合的约束,因为技能名来自磁盘。
 */
export interface ShortcutSkillItem {
  kind: 'skill'
  name: string
  hint: string
  skill: ShortcutSkill
}

export type ShortcutItem = ShortcutCommandItem | ShortcutSkillItem

export interface ShortcutRunContext {
  compact: () => Promise<void>
  testAutoCompaction: () => Promise<void>
  listWorkflows: () => Promise<void>
  newChat: () => Promise<boolean>
  copyContext: () => Promise<void>
  copySessionPath: () => Promise<void>
  /** `/export` —— 打包会话的模型 I/O 目录,让人选保存位置。与上一条同源。 */
  exportSession: () => Promise<void>
  /**
   * `/page_snapshot` —— 把**人正在看的那个 tab** 的无障碍快照写进剪贴板。
   * 与上面几条一样由 `ChatPanel` 注入,store 不碰 xpc。
   */
  copyPageSnapshot: () => Promise<void>
  /**
   * `/page_snapshot_compare` —— 树 + DOM 原文 + 诊断打成 zip。与上一条同源:
   * 那条出给人贴,这条出给人查。同样由 `ChatPanel` 注入,store 不碰 xpc。
   */
  exportPageSnapshotCompare: () => Promise<void>
  testShowError: () => Promise<void>
  /**
   * `/view_context_graph`:读一次上下文结构 + 在面板里开弹窗。由 `ChatPanel` **注入**,
   * 和上面三个同一条理由,但这条的理由更硬:
   *
   * 1. 这个 store 至今**只有一条 `import type`** —— 没有 DOM、没有 Electron、没有 Vue,
   *    所以守卫能把它当纯函数直接跑。自己在这里调 xpc,就把 preload / electron-xpc /
   *    message.store 整条依赖链拖进那个沙箱,store 也就不再是可单独跑的东西。
   * 2. 认领「哪一块 block 对应界面上哪条消息」要拿**渲染层的消息摘要**(每条消息正文的前
   *    `CONTEXT_GRAPH_MATCH_HEAD_CHARS` 字符),而消息挂在面板的 `props.session` 上。
   *    在这里拿不到它,只能多开一条 store 管不着的数据通路。
   *
   * 失败**抛**而不是回错误字符串 —— 与既有的 `copyContext` 逐字同形:`commit()` 的 catch
   * 把异常收成 `{ ok: false, error }`,面板再把它变成一条 `Message.error`。
   */
  openContextGraph: () => Promise<void>
}

export type ShortcutCommit =
  /**
   * `skill` 在场 = 选中了一个技能,要把它挂到下一次发送。面板只删掉 `/xxx` 这个 token,
   * **草稿其余部分留着** —— 技能几乎总要带一句意图,清空输入框等于让人重打一遍。
   * 这条路不执行任何东西:真正的注入在 main 的 `selectedSkillPrompt`。
   */
  | { ok: true; skill?: ShortcutSkill }
  | { ok: false; error?: string }

export interface SlashToken {
  query: string
  start: number
  end: number
}
