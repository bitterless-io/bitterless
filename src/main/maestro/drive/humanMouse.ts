// 拟人化的 CDP 指针(Ral 2026-08-13:「cdp 的鼠标移动需要轨迹,移动到位后再做点击」)。
//
// 修的是什么:原来 `clickStep` 全程只发**一次** `Input.dispatchMouseEvent{mouseMoved}`,而且就落在目标点上
// —— 指针是瞬移的。页面从没收到过路径上的移动,于是 hover 才出现的二级菜单、行内操作按钮、tooltip 都
// 打不开(管理后台里这类控件很多,钻探因此少覆盖一批入口),而且单点跳变是最好认的自动化特征。
// 更别扭的是:可见的蓝光标靠 CSS transition 滑过去,页面对它一无所知 —— 看到的和页面收到的是两回事。
//
// 轨迹算法在 `./algorithm`(Bézier + Fitts's Law,出处见那里的 readme)。**它住在 maestro 树内**:
// 最初放在 `src/shared/algorithmHelper` 下,被 `assertMaestroAliasBoundary` 判为越界 ——
// maestro 子树要能整体搬走,一个只有它用的纯算法库不能留在宿主侧。
// 这个文件只管两件事:把算出来的点派发成 CDP 事件,以及把**同一条**轨迹画给人看。
import type { WebContents } from 'electron'
import { humanPath, randomPointInBox } from '@maestro-main/drive/algorithm/humanPath.helper'
import type { Box, Vector } from '@maestro-main/drive/algorithm/algorithm.type'
import { timerHelper } from '@shared/timerHelper/timer.helper'
// bl 走 `String(fn)` 注入(与 snapshotWalker 同形),不是 cowork 的 vite 虚拟模块 ——
// 理由写在被引的那个文件头部(keepNames 那一段)。
import { MOUSE_OVERLAY } from './inject/mouseOverlay.inject'

/**
 * 绑在一个 WebContents 上的指针。**持有当前坐标** —— 下一次移动从上一次的落点出发,
 * 否则每次都从原点起跳,轨迹就没有连续性可言。
 */
export class HumanMouse {
  private pos: Vector = { x: 0, y: 0 }

  constructor(private readonly wc: WebContents) {}

  /**
   * 沿拟人轨迹移动到目标。**到位才返回** —— 调用方在 await 之后才 press,这就是
   * 「移动结束后才是点击」。
   */
  async moveTo(box: Box): Promise<Vector> {
    await this.ensureOverlay()
    const path = humanPath(this.pos, randomPointInBox(box), { targetWidth: box.width })
    // 过冲可能把点甩到视口外(负坐标),夹回来;可见轨迹和真实事件用的是同一份点。
    const points = path.points.map((point) => ({ x: Math.max(0, point.x), y: Math.max(0, point.y) }))

    // 覆盖层按同一条轨迹与节奏自己跑动画(一次注入,不是每步一个 round trip)——
    // 于是"看到的"和"页面收到的"是同一条线。
    void this.paintTrail(points, path.delays)
    for (let i = 1; i < points.length; i += 1) {
      const point = points[i]
      await this.wc.debugger
        .sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y, buttons: 0 })
        .catch(() => undefined)
      this.pos = point
      await timerHelper.delay(path.delays[i - 1])
    }
    return this.position
  }

  /** 移动 → 到位 → 按下 → 抬起。press/release 一定在 moveTo 之后。 */
  async click(box: Box): Promise<Vector> {
    const point = await this.moveTo(box)
    // 人按下去之前有个极短的停顿(瞄准到按下)。
    await timerHelper.delay(40 + Math.random() * 90)
    await this.wc.debugger.sendCommand('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: point.x,
      y: point.y,
      button: 'left',
      buttons: 1,
      clickCount: 1
    })
    void this.ripple(point)
    await timerHelper.delay(45 + Math.random() * 70)
    await this.wc.debugger.sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: point.x,
      y: point.y,
      button: 'left',
      buttons: 0,
      clickCount: 1
    })
    return point
  }

  /** 当前指针位置 —— 供调用方在别处复用(例如拖拽的起点)。 */
  get position(): Vector {
    return { ...this.pos }
  }

  /**
   * 覆盖层已经连续注入失败几次。**不是为了改行为,是为了留证据**
   * (`docs/issues/drill-virtual-cursor-only-on-click.md`)。
   *
   * 原来这里是个光秃秃的 `catch {}`,理由「纯视觉,不影响真实点击」——「不影响点击」是对的,
   * 「所以不必留痕」是错的:可见光标是操作者判断"agent 到底在不在动"的唯一视觉证据,
   * 它没了的时候日志里零行,查的人分不出"没注入成功"和"没有产生移动"。
   * 同 `drill-recording-stops-between-ingest-rounds.md` 修 2「开录失败不许静默」的判据。
   */
  private overlayFailures = 0

  private async evaluate(expression: string): Promise<void> {
    try {
      await this.wc.debugger.sendCommand('Runtime.evaluate', { expression, awaitPromise: false })
      this.overlayFailures = 0
    } catch (err) {
      // 纯视觉,注入失败不影响真实点击 —— 但**只在 0→1 那一次**记一行:钻探一轮几百次移动,
      // 每次都打会把日志淹掉,而这条要说的事("光标不再显示了")只需要说一次。
      this.overlayFailures += 1
      if (this.overlayFailures === 1) {
        console.error('[maestro cursor] overlay injection failed — the visible cursor will stop moving (clicks are unaffected): ' + (err as Error).message)
      }
    }
  }

  private async paintTrail(points: Vector[], delays: number[]): Promise<void> {
    await this.evaluate(
      `window.__maestroCursor && window.__maestroCursor.follow(${JSON.stringify(points)},${JSON.stringify(delays)})`
    )
  }

  private async ripple(point: Vector): Promise<void> {
    await this.evaluate(`window.__maestroCursor && window.__maestroCursor.ripple(${point.x},${point.y})`)
  }

  /**
   * 每次移动前跑一遍注入。**不缓存"已注入"标志** —— 页面一导航覆盖层就没了,而钻探本来就是
   * 一路点着走的;缓存标志会让导航之后的所有轨迹静默消失。注入函数自己在开头判存,
   * 已经在的话是个空操作,代价就是每次移动多一条 Runtime.evaluate。
   */
  private async ensureOverlay(): Promise<void> {
    await this.evaluate(`(${MOUSE_OVERLAY})()`)
  }
}

