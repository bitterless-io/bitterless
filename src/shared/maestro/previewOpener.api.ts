/**
 * The host's preview application, as Maestro is allowed to know it.
 *
 * Maestro's workspace tools want to *show the owner some files*. Which application does that is the
 * host's business, and `check:maestro`'s alias boundary forbids Maestro from reaching for it — so
 * the host registers an opener and Maestro calls it without naming it.
 *
 * When nothing is registered the caller falls back to the OS file manager, which is what these
 * tools did before a preview application existed.
 */
/** Existing local targets use the preview router; missing paths retain Chromium's error page. */
export type MaestroLocalPreviewTarget =
  | { readonly kind: 'preview'; readonly path: string }
  | { readonly kind: 'missing'; readonly fileUrl: string }

export interface MaestroPreviewOpener {
  /** Settled Project root only; an external single-file preview does not supply a workspace. */
  currentProjectDirectory?(): string | undefined
  /**
   * Open one absolute path — a directory or a file — in the host's preview application.
   *
   * `line` 是**尽力而为的建议**:只有能按行渲染的预览器会用它,其余(图片 / PDF / 媒体 / 目录)
   * 照常打开、不滚动。行号不合法或超出文件行数同样只是忽略 —— 它永远不是打不开的理由。
   */
  open(absolutePath: string, options?: { line?: number; fragment?: string }): Promise<void>
  /**
   * 这个会话不再用这个工作区了 —— 解除预览中匹配的 Project 绑定,保留 tab/窗口供再次选择。
   *
   * 保留既有接口名。宿主在目标变更队列中比对当前项目根,不影响另一个 Project 或外部文件预览。
   */
  closeForPath(absolutePath: string): Promise<void>
  /** What to call it in text shown to the owner, e.g. "OnlyPreview". */
  readonly displayName: string
  /**
   * 地址栏那一串是不是一条**本机文件路径**,以及该怎么落。`null` = 不是,按地址原路处理。
   *
   * **为什么这条也走端口。** 判据本身(什么算绝对路径、哪些格式普通 tab 渲染得了)住在宿主的预览
   * 应用里,而 `check:maestro` 的别名边界禁止 maestro 去拿它。曾经有一版是 maestro 直接
   * import `@shared/onlypreview/*` 与 `@main/miniapps/onlypreview/*` —— 那不只是过不了断言:
   * 它把宿主整棵 onlypreview 子树(连 fileSearch / menu)拖进了 maestro 的测试打包里。
   *
   * **同步**,因为地址栏那一发不能等:调用点在建 tab 之前,插一次异步读会让输入像卡住。
   * 存在性检查是一次 `existsSync`,那是可接受的同步成本。
   */
  resolveLocalTarget(input: string): MaestroLocalPreviewTarget | null
}
