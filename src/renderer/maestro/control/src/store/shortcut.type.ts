export interface ShortcutItem {
  // 名字用下划线而不是空格:开菜单的 token 正则是 `\/([\w-]*)`,带空格的名字根本不会被识别成命令。
  // 与既有的 `/view_context` 同一个写法。
  name: '/clear' | '/view_context' | '/copy_session_path' | '/test_show_error' | '/view_context_graph' | '/workflow'
  hint: string
}

export interface ShortcutRunContext {
  listWorkflows: () => Promise<void>
  newChat: () => Promise<boolean>
  copyContext: () => Promise<void>
  copySessionPath: () => Promise<void>
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

export type ShortcutCommit = { ok: true } | { ok: false; error?: string }

export interface SlashToken {
  query: string
  start: number
  end: number
}
