import { BrowserWindow, screen, type WebContents } from 'electron'
import { windowStateService } from '@main/windows/windowState.service'
import { devToolsHostBounds, type DevToolsHostRect } from './devtoolsPlacement'

/**
 * Maestro 的 DevTools 一律跟着主窗走 —— 同一块显示器,macOS 下同一个桌面(Space)。
 * 全文判据见 docs/features/maestro-devtools-follow-main-window.md。
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

/** 退回 Electron 内置行为的总闸(连带退回原来的乱跑)。 */
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
  host.setBounds(devToolsHostBounds({ workArea: anchorWorkArea(), index }))
  // 同一个桌面靠**父子窗**,不靠猜:macOS 的子窗随父窗排序,父窗换 Space / 进全屏 / 隐藏显示,
  // 子窗一并跟着。`setVisibleOnAllWorkspaces(true→false)` 只能钉到**当前活动**的 Space,
  // 主窗不在前台时就钉错了。代价是子窗永远盖在父窗上面 —— 不想要就 COACH_DEVTOOLS_ANCHOR=0。
  const parent = liveAnchor()
  if (parent && host.getParentWindow() !== parent) host.setParentWindow(parent)
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
