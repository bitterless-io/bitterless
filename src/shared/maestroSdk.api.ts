/**
 * `MAESTROSDK` —— 宿主给 mini-app 的注入面。
 *
 * **这份文件在 bitterless 与 micromeet-cowork 两仓逐字相同**,`src/preload/maestroSdk/index.ts`
 * 也是。两边的差异全部关在 main 侧(哪个覆盖层、哪条刷新路径),注入面本身一个字都不许分叉 ——
 * 分叉了,同一个 mini-app 在两个宿主里就得写两套代码,而这个 SDK 存在的理由正是不要那样。
 * 守卫:`diff` 这两个文件必须没有输出(见 feature 文档)。
 *
 * 使用文档:`areas/agent-runtime/miniapp/maestrosdk.md`
 */

/** main → mini-app 的刷新广播。载荷带 `instanceId`,收方自己判断是不是自己。 */
export const MAESTRO_SDK_REFRESH_EVENT = 'maestro/sdk-refresh'

export interface MaestroSdkRefreshBroadcast {
  /** 目标 tab 的身份(BL 是 `host.instanceId`,cowork 是 `tab.id`)。 */
  instanceId: string
  /** `before` 先发,`refresh` 紧接其后。两条都是 fire-and-forget。 */
  phase: 'before' | 'refresh'
}

/** mini-app 的 view 要摊进 `additionalArguments` 的那一格。 */
export const MAESTRO_SDK_INSTANCE_ARGUMENT = '--maestro-instance-id='

/** 从 `process.argv` 里取出本 view 所属 tab 的身份;没有就是 null(没被摊进来)。 */
export const readMaestroSdkInstanceId = (argv: readonly string[]): string | null => {
  for (const arg of argv) {
    if (arg.startsWith(MAESTRO_SDK_INSTANCE_ARGUMENT)) {
      const value = arg.slice(MAESTRO_SDK_INSTANCE_ARGUMENT.length)
      if (value) return value
    }
  }
  return null
}

/**
 * mini-app 要宿主弹一次确认时传的东西。
 *
 * **文案由 mini-app 给。** 它自己是一个第一方渲染进程、有自己的 i18n;main 在这条链上只是管道,
 * 不作者。这与「main 不许硬编码面向用户的文本」那条纪律不冲突 —— 文本从来没在 main 里产生过。
 */
export interface MaestroSdkConfirmRequest {
  title: string
  message: string
  /** 省略 = 宿主的默认「确定」/「取消」。 */
  confirmLabel?: string
  cancelLabel?: string
}

/** preload → main 的调用载荷。`instanceId` 是**谁在问** —— main 拿不到 sender,只能靠它。 */
export interface MaestroSdkConfirmCall extends MaestroSdkConfirmRequest {
  instanceId: string
}

/** main 侧那个 `XpcMainHandler` 的类名。两仓必须一致,否则注入面就分叉了。 */
export const MAESTRO_SDK_XPC_HANDLER = 'MaestroSdkXpcHandler'

export interface MaestroSdkXpcContract {
  confirm(params: MaestroSdkConfirmCall): Promise<boolean>
}

/** 渲染层看到的 `window.MAESTROSDK`。 */
export interface MaestroSdk {
  /**
   * 刷新即将发生 —— 保存草稿、停掉轮询、记住滚动位置。
   *
   * **它拦不住刷新。** 广播是 fire-and-forget,main 不会等这一轮 handler 跑完再发 `onRefresh`。
   * 要「可否决」是另一条设计。
   */
  beforeRefresh(handler: () => void): () => void
  /** 刷新发生 —— 真正去重拉数据 / 重建视图。 */
  onRefresh(handler: () => void): () => void
  /**
   * 让**宿主**弹一次确认,等人答完。
   *
   * 为什么必须借宿主:mini-app 的页面是一张原生 `WebContentsView`,而它自己的子 view(Zellij 的终端
   * 就是)画在它**之上** —— 页面里居中的 DOM 卡片会被整块盖住。宿主那一层是唯一能画在操作区之上的
   * 对话框层。窗口级原生 modal 在两仓都有记录会卡死整窗,不用。
   *
   * 非活动 tab 里问 ⇒ 直接 `false`,不弹:一个背景 tab 弹出来的对话框,人根本不知道是谁问的。
   * 这一层起不来 ⇒ 也是 `false`(**与关闭确认那条相反**:那里放行是因为拦住会让 tab 永远关不掉;
   * 这里没有那种不可逆的代价,而默默替人答"是"更危险)。
   */
  confirm(request: MaestroSdkConfirmRequest): Promise<boolean>
}
