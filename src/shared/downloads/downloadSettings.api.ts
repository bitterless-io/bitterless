// VENDORED FILE — byte-identical in `micromeet-cowork` and `bitterless`. The handler class name is
// identical in both repos too, so the renderer emitter string (`'DownloadSettingsHandler'`) is the
// same one on both sides.
//
// 下载目录设置的 xpc 契约(docs/features/browser-downloads.md)。渲染端只 import 这个文件,
// 不 import handler 类 —— 渲染层没有任何到 main 的 import。每个方法都是**零参数**,稳稳在
// electron-xpc 的 `AssertSingleParam` 之内。

export interface DownloadSettingsSnapshot {
  /**
   * 用户明确选过的目录。**空串 = 没选过**,那就是用系统下载目录 —— 这两件事必须分得开:
   * 直接把 `effective` 显示成"已配置"的话,人换了系统下载目录之后界面会说谎。
   */
  configured: string
  /** 系统下载目录(`app.getPath('downloads')`)。 */
  system: string
  /** 这一刻的下载真的会落在哪。配的目录不可用时它等于 `system`。 */
  effective: string
  /** 配了目录、但此刻不可写(盘拔了 / 被删了 / 只读)。界面要说出来,不能装作没事。 */
  unavailable: boolean
}

export interface DownloadSettingsApi {
  state(): Promise<DownloadSettingsSnapshot>
  /** 弹系统目录选择框。**取消 = 什么都不改**,原样把当前状态返回去。 */
  choose(): Promise<DownloadSettingsSnapshot>
  /** 回到系统下载目录(清掉 `configured`)。 */
  reset(): Promise<DownloadSettingsSnapshot>
  /** 在访达 / 资源管理器里打开当前**真正**会用的那个目录。 */
  reveal(): Promise<void>
}
