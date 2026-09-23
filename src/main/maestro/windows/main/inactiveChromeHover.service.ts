import { screen, type BrowserWindow } from 'electron'

/**
 * Hover for the window chrome while the window is NOT focused.
 *
 * 为什么需要这一层:Chromium 在非 key 窗口上**主动丢掉** `NSEventTypeMouseMoved`
 * (`render_widget_host_view_cocoa.mm` 的 `shouldIgnoreMouseEvent:` —— 事件是 mouse-moved、
 * 视图不 `acceptsMouseEventsWhenInactive`(判据是窗口 level > `NSNormalWindowLevel`)、窗口既不是
 * main 也不是 key,三条同时成立就忽略)。于是后台窗口的网页内容收不到 `mousemove`,Blink 不更新
 * hover 链,`:hover` 永远不生效 —— tab 条是 DOM,所以它整条失灵;Chrome 的 tab 条是原生 Views
 * 控件,不走这条判据,这就是「Chrome 可以我们不行」的全部原因
 * (docs/issues/inactive-window-chrome-has-no-hover-and-eats-the-first-click.md)。
 *
 * 唯一不改产品形态的解法:主进程自己采样光标,用 `sendInputEvent` 把这一次移动**补**给 chrome 的
 * webContents。`sendInputEvent` 直接进 RenderWidgetHost,不经过上面那条 Cocoa 判据,所以 `:hover`
 * 回到普通 CSS 行为 —— tab、关闭按钮、地址栏按钮全部照常,**渲染层不需要任何新的 hover class**。
 *
 * 刻意只补 chrome 那一条(操作区之上):网页内容与控制面板是另外的 webContents,把合成 hover 灌进
 * 任意网站既没必要也不便宜。
 */

/** 后台采样周期。60ms ≈ 16Hz:够跟手,而每一拍的活是一次 `getCursorScreenPoint()` 加一次矩形比较。 */
const SAMPLE_MS = 60

export interface InactiveHoverPoint {
  x: number
  y: number
}

export type InactiveHoverAction =
  | { kind: 'move'; point: InactiveHoverPoint }
  | { kind: 'leave'; point: InactiveHoverPoint }
  | { kind: 'none' }

/**
 * 这一拍该给 chrome 的 webContents 发什么。
 *
 * 纯函数,判据全部显式传进来 —— 采样循环只负责取值与发事件,所有边界条件在
 * `tests/maestro/inactiveChromeHover.test.mjs` 里按表钉死。
 *
 * `previous` 同时当「上一拍光标在不在 chrome 条里」的标志:非 null 才需要补 `leave`,
 * 相同坐标则整拍跳过(静止的光标不必每 60ms 重发一次 move)。
 */
export const resolveInactiveHover = (params: {
  /** 光标的屏幕坐标(DIP)。 */
  cursor: InactiveHoverPoint
  /** 窗口内容区的屏幕矩形(DIP),即 `BrowserWindow.getContentBounds()`。 */
  content: { x: number; y: number; width: number; height: number }
  /** 内容区顶部属于 chrome 的高度 —— 操作区占位的 y。 */
  chromeHeight: number
  /** 上一拍报给渲染层的内容区坐标,没有则 null。 */
  previous: InactiveHoverPoint | null
}): InactiveHoverAction => {
  const { cursor, content, chromeHeight, previous } = params
  const point = {
    x: Math.round(cursor.x - content.x),
    y: Math.round(cursor.y - content.y)
  }
  const band = Math.min(chromeHeight, content.height)
  const inside =
    band > 0 &&
    point.x >= 0 &&
    point.x < content.width &&
    point.y >= 0 &&
    point.y < band
  if (inside) {
    if (previous && previous.x === point.x && previous.y === point.y) return { kind: 'none' }
    return { kind: 'move', point }
  }
  // 出了 chrome 条就补一次 `mouseLeave`,否则最后停留的那个 tab 会一直亮着。只补一次 —— `previous`
  // 清空之后后面的拍子都是 `none`。
  if (!previous) return { kind: 'none' }
  return { kind: 'leave', point: previous }
}

/**
 * 给一扇窗装上后台 hover 采样。监听器随窗口一起消失,所以不返回 dispose —— 每次重开窗都重新装。
 *
 * `chromeHeight` 是个取值函数而不是常量:渲染层量出来的占位 rect 才是权威(`setViewBounds`),
 * 侧栏折叠、窗口缩放都会改它。
 */
export const attachInactiveChromeHover = (
  win: BrowserWindow,
  chromeHeight: () => number
): void => {
  let timer: ReturnType<typeof setInterval> | null = null
  let previous: InactiveHoverPoint | null = null

  const stop = (): void => {
    if (timer) clearInterval(timer)
    timer = null
    // **不补 `leave`**:此刻 hover 要么本来就没设(光标不在 chrome 上),要么设得是对的
    // (光标就停在那个 tab 上)。清掉标志就够,重新开跑时第一拍会照实补一次 move。
    previous = null
  }

  const tick = (): void => {
    if (win.isDestroyed() || win.isFocused() || !win.isVisible() || win.isMinimized()) {
      stop()
      return
    }
    const content = win.getContentBounds()
    // 已知边界:这里只看几何,不看遮挡 —— 别的应用的窗口压在我们上面时,光标落在那块区域仍然会被
    // 当成 hover。代价是后台窗口偶尔亮一个 tab,换的是不引入一层窗口遮挡跟踪。
    const action = resolveInactiveHover({
      cursor: screen.getCursorScreenPoint(),
      content,
      chromeHeight: chromeHeight(),
      previous
    })
    if (action.kind === 'none') return
    if (win.webContents.isDestroyed()) {
      stop()
      return
    }
    if (action.kind === 'move') {
      previous = action.point
      win.webContents.sendInputEvent({ type: 'mouseMove', x: action.point.x, y: action.point.y })
      return
    }
    previous = null
    win.webContents.sendInputEvent({ type: 'mouseLeave', x: action.point.x, y: action.point.y })
  }

  const start = (): void => {
    if (timer || win.isDestroyed() || win.isFocused() || !win.isVisible() || win.isMinimized()) return
    timer = setInterval(tick, SAMPLE_MS)
  }

  win.on('blur', start)
  win.on('show', start)
  win.on('restore', start)
  win.on('focus', stop)
  win.on('hide', stop)
  win.on('minimize', stop)
  win.on('closed', stop)
  start()
}
