/**
 * Maestro 壳覆盖层对话框的上线契约(docs/features/tab-alias.md #2)。
 *
 * 文件名说的是它的第一个用途(别名表单),它现在还承载关闭确认
 * (docs/features/maestro-zellij-close-confirm.md #2.1)。**没改名是刻意的**:`tabAlias` 同时是
 * XPC handler 的字符串键、`electron.vite.config.ts` 的入口名、i18n 的命名空间和
 * `check-tab-alias.mjs` 的锚点 —— 四处字符串键一起改而 typecheck 一声不吭,风险远大于名字更好听。
 *
 * 为什么需要一个**自己的覆盖层 view** 而不是 Home 渲染进程里的一张卡片:操作区是一个原生
 * `WebContentsView`,绘制在 Home 的 DOM **之上**,DOM 里的居中卡片会被它整块盖住;而 Electron
 * 根本没有带文本输入的原生对话框,窗口级 modal 又在本仓有三处「卡死整个窗口 ＋ CDP 钻探死锁」的
 * 记录。把操作区 view 先藏起来也不行 —— agent 的 `page_snapshot` 与钻探都靠它保持可见。
 *
 * 协议形制照 OnlyPreview 的 alert 层:main 持有 Promise,渲染层拉快照(`snapshot`)、回
 * `resolve`。不复用那一套本体,是因为它的每个入口都 `requireRuntime(hostToken)`,view 是
 * composite 自己容器的子节点。
 */

/** 快照发生变化 —— 渲染层收到就回来拉一次,payload 只带 revision(见 `snapshot`)。 */
export const MAESTRO_TAB_ALIAS_STATE_EVENT = 'coach/tab-alias-state'

/**
 * 别名长度上限(字符)。
 *
 * chip 宽度是固定的,超长 alias 会把整条挤变形,所以在**写进状态之前**截断,而不是靠 CSS 省略号
 * ——后者只是看不见,条上的宽度账已经算坏了。
 */
export const MAESTRO_TAB_ALIAS_MAX_LENGTH = 64

/**
 * tab chip 里**就地改名**的长度上限(字符,Ral 2026-09-16 定 20)。
 *
 * 和上面那个 64 是两块不同的画布:覆盖层那张卡片有的是宽度,chip 的宽度被 tab 条的收缩算法钳死。
 * 两个常量刻意互不引用 —— 把其中一个定义成另一个的函数,只会让下次改宽表单时顺手把 chip 挤坏
 * (docs/features/zellij-tab-inline-rename.md #5)。
 */
export const MAESTRO_TAB_INLINE_RENAME_MAX_LENGTH = 20

export interface MaestroTabAliasDialog {
  variant: 'alias'
  dialogId: string
  /** 这个 tab 现在显示的名字,表单里当副标题 —— 「你正在给哪个 tab 起名」要看得见。 */
  tabLabel: string
  /** 预填值:当前 alias,没有就是空串。 */
  alias: string
}

/**
 * 「这一次关闭会结束下面这些 Zellij 会话,确定吗?」
 *
 * 带的是**这一次关闭范围内**的 Zellij tab 显示名,不是被右键点中的那一个:`Close tabs to the right`
 * 的范围里可能一个 Zellij 都没有,也可能有三个,而对话框只弹一次
 * (docs/features/maestro-zellij-close-confirm.md #1)。空数组不该到这儿 —— 没有 Zellij 就不弹。
 */
export interface MaestroTabCloseConfirmDialog {
  variant: 'closeConfirm'
  dialogId: string
  terminalLabels: string[]
}

/** 这一层同时只有一个对话框,所以快照上就一个槽位,由 `variant` 判别。 */
export type MaestroShellDialog = MaestroTabAliasDialog | MaestroTabCloseConfirmDialog

export interface MaestroTabAliasSnapshot {
  /**
   * 每次状态变化 +1。
   *
   * 广播里**只带这个数**、不带对话框本体:payload 过 XPC 要能结构化克隆,而「拉一次完整快照」
   * 这条路本来就要有(渲染进程可能在广播之后才挂载)。两条路合成一条,就不会有两份状态。
   */
  revision: number
  dialog: MaestroShellDialog | null
}

export interface MaestroTabAliasXpcContract {
  snapshot(): Promise<MaestroTabAliasSnapshot>
  /** `cancel`(含 Escape)与空串是两件事:前者不动 alias,后者是**删除**别名。 */
  resolve(params: { dialogId: string; outcome: 'confirm' | 'cancel'; value?: string }): Promise<void>
}
