import { BrowserWindow, screen, type WebContents } from 'electron'
import { windowStateService } from '@main/windows/windowState.service'
import { devToolsHostBounds, type DevToolsHostRect } from './devtoolsPlacement'

/**
 * Maestro 的 DevTools 一律开在**主窗所在的那块显示器**上。全文判据见 docs/features/maestro-devtools-follow-main-window.md。
 *
 * **只保显示器,不保 macOS 的 Space,也不 parent 到主窗**(Ral 2026-09-22 定,见该文档 #6):
 * 父子窗是「同一个 Space」唯一可行的实现,但同一条也让子窗随父窗**移动**、永远**压在父窗上面**、
 * 而且**自己不能被拖走**。三条加起来 DevTools 就成了焊在主窗上、位置不可调的挡板。所以放弃
 * Space 那一层,换回一扇自由可拖的窗。Cowork 侧同构,两份一起改。
 *
 * 落位只发生在**开的那一刻**(以及主窗就位后补排一次)。**刻意不监听主窗的 move** —— 跟着主窗跑
 * 就又回到「拖主窗时 DevTools 一起动」,那正是被否掉的那个行为。
 *
 * **为什么不能直接摆 Electron 内置的那扇 detach DevTools 窗**:它不是 BrowserWindow,JS 侧拿不到
 * (实测 Electron 40.10.6:开 DevTools 前后 `BrowserWindow.getAllWindows()` 数量不变,
 * `owner.getChildWindows()` 为空)。特别注意 `BrowserWindow.fromWebContents(wc.devToolsWebContents)`
 * **非空** —— 它返回的是**宿主窗自己**,照着它 `setBounds` 会把主窗搬走。唯一的口子是
 * `setDevToolsWebContents`:把 DevTools 前端装进我们自己建的窗里,那扇窗就随便摆。
 */

/** 目标 `WebContents` → 装着它 DevTools 的那扇窗。也是去重的唯一依据,见下。 */
const hosts = new Map<WebContents, BrowserWindow>()
let anchor: BrowserWindow | null = null

/**
 * 总闸:`COACH_DEVTOOLS_ANCHOR=0` 退回 Electron 内置行为(位置交给 Electron 决定)。
 *
 * 2026-09-22 这一天来回过一次,记在这里免得下一个人再绕一遍:上午整条路被**撤回、默认关**
 * (原因就是当时 `placeHost` 里那句 `setParentWindow` 把 DevTools 焊在主窗上);同日 Ral 选了
 * 折中方案 —— 去掉 parent、只按主窗所在显示器落位 —— 于是重新默认开启。
 *
 * **要把 parent 加回来之前,先解决「子窗不可拖动」这一条**,否则回来的还是同一个 bug。
 */
const isAnchored = (): boolean => process.env.COACH_DEVTOOLS_ANCHOR !== '0'

const liveAnchor = (): BrowserWindow | null => (anchor && !anchor.isDestroyed() ? anchor : null)

/**
 * 落位依据。主窗还没建时(隐藏的 sqlite 宿主窗比主窗先开)退而求其次用**主窗记住的几何** ——
 * 它上次关在哪块屏,就将要开在哪块屏,比 `getPrimaryDisplay()` 准。猜错也只是短暂的:
 * `setDevToolsAnchor` 会把已开的全部重排一遍。
 */
const anchorWorkArea = (): DevToolsHostRect => {
  const win = liveAnchor()
  if (win) return screen.getDisplayMatching(win.getBounds()).workArea
  const remembered = windowStateService.resolve('maestro')?.bounds
  if (remembered) return screen.getDisplayMatching(remembered).workArea
  return screen.getPrimaryDisplay().workArea
}

const placeHost = (host: BrowserWindow, index: number): void => {
  if (host.isDestroyed()) return
  // **只摆位置,不建父子关系。** `host.setParentWindow(mainWindow)` 能换来 macOS 的「同一个
  // Space」(子窗随父窗换桌面/进全屏),但同一条也让子窗随父窗移动、永远压在父窗上面、而且自己
  // 不能被拖走 —— Ral 2026-09-22 实机报了这三条,需求随即收窄成只保「同一块显示器」。
  // 想把 Space 那一层找回来,要找的是一条不牺牲可拖动性的绑定方式,**不是把这一行加回来**。
  // `devtoolsPlacement.test.mjs` 里有一条源码断言钉着这里不出现 `setParentWindow`。
  host.setBounds(devToolsHostBounds({ workArea: anchorWorkArea(), index }))
}

const placeAll = (): void => {
  let index = 0
  for (const host of hosts.values()) {
    if (host.isDestroyed()) continue
    placeHost(host, index)
    index += 1
  }
}

/** 主窗建好后调一次:此后所有 DevTools 锚到它,此前已开的全部重排过来。 */
export const setDevToolsAnchor = (win: BrowserWindow): void => {
  if (!isAnchored()) return
  anchor = win
  win.once('closed', () => {
    if (anchor === win) anchor = null
  })
  placeAll()
}

/**
 * 给 `target` 开一扇锚在主窗上的 DevTools。
 *
 * **调用点不要再写 `if (!wc.isDevToolsOpened())`** —— 自托管之后那个方法恒为 `false`(实测),
 * 那道闸会把每次调用都判成"还没开",于是开出第二扇、第三扇。去重由上面的 `hosts` 映射负责。
 */
export const openAnchoredDevTools = (target: WebContents, options: { title: string }): void => {
  if (target.isDestroyed()) return
  if (!isAnchored()) {
    if (!target.isDevToolsOpened()) target.openDevTools({ mode: 'detach', activate: false })
    return
  }

  const existing = hosts.get(target)
  if (existing && !existing.isDestroyed()) {
    existing.showInactive()
    return
  }

  const index = hosts.size
  const host = new BrowserWindow({
    show: false,
    backgroundColor: '#ffffff',
    ...devToolsHostBounds({ workArea: anchorWorkArea(), index })
  })
  hosts.set(target, host)

  // DevTools 页面会把 host 的标题改成 `DevTools`,五扇同时开着时没法分辨谁是谁。
  host.on('page-title-updated', (event) => {
    event.preventDefault()
  })
  host.setTitle(`DevTools — ${options.title}`)

  target.setDevToolsWebContents(host.webContents)
  // 仍然 detach + 不激活:激活会把键盘从主窗/终端上夺走。
  target.openDevTools({ mode: 'detach', activate: false })
  placeHost(host, index)
  host.showInactive()

  // DevTools 被从别处关掉(Cmd+Opt+I 再按一次)时,host 会留在屏幕上变成一扇空白窗;
  // 目标 view 被拆掉时同理。两个监听都要在 host 关掉时摘掉 —— 同一个 target 可以再开一扇,
  // 不摘就会攒下一串指着旧 host 的监听。
  const closeHost = (): void => {
    if (!host.isDestroyed()) host.destroy()
  }
  target.on('devtools-closed', closeHost)
  target.on('destroyed', closeHost)
  host.once('closed', () => {
    hosts.delete(target)
    if (target.isDestroyed()) return
    target.removeListener('devtools-closed', closeHost)
    target.removeListener('destroyed', closeHost)
  })
}
