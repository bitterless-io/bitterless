import { WebContentsView } from 'electron'
import type { BrowserWindow } from 'electron'
import { is } from '@electron-toolkit/utils'
import { randomUUID } from 'crypto'
import { injectable } from 'inversify'
import { join } from 'path'
import { xpcMain } from 'electron-xpc/main'
import { CommonService } from '@maestro-shared/iocHelper/ioc.helper'
import type { ViewRect } from '@maestro-shared/coach.api'
import {
  MAESTRO_TAB_ALIAS_MAX_LENGTH,
  MAESTRO_TAB_ALIAS_STATE_EVENT,
  type MaestroTabAliasDialog,
  type MaestroTabAliasSnapshot
} from '@maestro-shared/tabAlias.api'
import type { TraceEvent } from '@maestro-shared/trace.types'
import { MAESTRO_PARTITION } from '@maestro-main/data/maestroDataRoot'
import { moduleLog } from '@main/logging/moduleLog'
import { createBoundsApplier } from './viewBounds'

/** 与 `maestroBrowserView.service.ts` 同一个 scope —— 一次改名的全部步骤要在一条 grep 里连起来。 */
const tabAliasLog = moduleLog('tab-alias')

export interface MaestroTabAliasViewServiceState {
  browserWindow: BrowserWindow | null
  opBounds: ViewRect | null
  /** 首帧兜底:一次矩形都还没量出来时催 controller 重跑一遍摆位(同 composite tab 那条路)。 */
  layout(): void
  emitTrace(event: TraceEvent): void
}

/**
 * 别名表单的覆盖层。一个 `WebContentsView`,盖在**操作区**上。
 *
 * 形制照 `MaestroWorkbenchViewService`(自己的 view、自己的 bounds applier、由 controller 统一
 * 摆位),对话框语义照 OnlyPreview 的 alert 层(main 持有 Promise,渲染层拉快照后回 resolve)。
 * 四条硬约束写在各自的方法上 —— 每一条都来自仓里一次真实的失败,别照着别处的写法改。
 */
@injectable()
export class MaestroTabAliasViewService extends CommonService<MaestroTabAliasViewServiceState> {
  private view: WebContentsView | null = null
  private readonly applyBounds = createBoundsApplier()
  private bounds: ViewRect | null = null
  /**
   * 页面已经加载完 —— 没有它不许挂进子节点列表。
   *
   * 约束 (i) 的另一半:一个还没绘制过的透明全矩形 view 挂上去,在 macOS 上会沉到最底,而它仍然
   * 吃满整块矩形的点击与按键 —— 用户看到的是「操作区突然不响应了」,而且没有任何报错。
   */
  private ready = false
  private attached = false
  /**
   * 这一层**这扇窗内**已经起不来了(加载失败 / 渲染进程没了)。
   *
   * 没有这个闩,一次失败就把功能永久毒死:`ready` 停在 `false` 而 view 还活着,于是
   * `ensureView()` 复用它、永远不再加载,下一次 `requestAlias` 存下 `settle` 后**谁也结不掉** ——
   * `promptTabAlias` 永远 await 在那儿,而此后每一次点 `Alias…` 都因为 `this.dialog` 还占着直接
   * 返回 `null`:菜单项照样可点,点了什么也不发生,一行日志都没有
   * (docs/issues/maestro-tab-alias-does-nothing.md;cowork 的 `ShellAlertViewService` 同款闩)。
   */
  private unavailable = false
  private revision = 0
  private dialog: MaestroTabAliasDialog | null = null
  private settle: ((value: string | null) => void) | null = null

  /**
   * 开窗时预建预载,把渲染进程的启动成本从「点开菜单那一刻」挪走。
   *
   * 也把第一次弹窗的链路缩短一节:`ready` 早就为真,`requestAlias` 一次 `present()` 就挂上,
   * 不必再依赖加载完成后的那次补挂。失败照样走 `unavailable` 闩。
   */
  preload(): void {
    tabAliasLog.info('layer preload requested')
    this.ensureView()
  }

  /**
   * 弹出别名表单,`null` = 取消(Escape / 取消按钮 / 表单被拆掉)。
   *
   * 一次只准有一个:第二个请求直接判为「无改动」而不是排队 —— 菜单是异步弹的,排队只会让一个
   * 早就过期的表单在半秒后自己跳出来。
   */
  requestAlias(params: { tabLabel: string; alias: string }): Promise<string | null> {
    tabAliasLog.info('dialog requested', { ready: this.ready, attached: this.attached, unavailable: this.unavailable, busy: Boolean(this.dialog) })
    if (this.dialog) {
      this._state.emitTrace({ kind: 'info', msg: 'tab alias: a dialog is already open', ts: Date.now() })
      return Promise.resolve(null)
    }
    // 起不来就**当场认**,而不是存下 settle 去等一个永远不会到的 ready。每次都记一行:
    // 否则「点了没反应」在 trace 里是一片空白。
    if (this.unavailable) {
      tabAliasLog.error('layer unavailable — answering as no change')
      this._state.emitTrace({ kind: 'error', msg: 'tab alias: the dialog layer is unavailable in this window', ts: Date.now() })
      return Promise.resolve(null)
    }
    const dialog: MaestroTabAliasDialog = {
      dialogId: randomUUID(),
      tabLabel: String(params.tabLabel || ''),
      alias: String(params.alias || '').slice(0, MAESTRO_TAB_ALIAS_MAX_LENGTH)
    }
    return new Promise<string | null>((settle) => {
      this.settle = settle
      this.dialog = dialog
      this.publish()
      this.present()
    })
  }

  snapshot(): MaestroTabAliasSnapshot {
    return { revision: this.revision, dialog: this.dialog ? { ...this.dialog } : null }
  }

  /** 渲染层的答复。`dialogId` 不匹配 = 一条过期的答复,丢掉(窗口可能已经在它手上关掉了)。 */
  resolveDialog(params: { dialogId: string; outcome: 'confirm' | 'cancel'; value?: string }): void {
    const dialog = this.dialog
    if (!dialog || dialog.dialogId !== params.dialogId) {
      tabAliasLog.warn('stale answer ignored', { open: Boolean(dialog), outcome: params.outcome })
      return
    }
    tabAliasLog.info('answer received', { outcome: params.outcome, length: params.value?.length ?? 0 })
    const settle = this.settle
    this.dialog = null
    this.settle = null
    this.publish()
    this.present()
    // `cancel` 交回 `null`(不动 alias),`confirm` 交回字符串 —— 空串是**删除**,不是取消。
    settle?.(params.outcome === 'confirm' ? String(params.value ?? '').slice(0, MAESTRO_TAB_ALIAS_MAX_LENGTH) : null)
  }

  /**
   * 约束 (iii)/(iv):矩形由 controller 的两条摆位路径推进来,取的是**操作区**矩形而不是整窗。
   *
   * 取整窗会让控制面板在对话框打开期间整个不可点;不接进 `applyContentBounds` 与首帧兜底,则
   * 第一次弹窗时它是 0×0(OnlyPreview 为此专门记过一个 `gate=bounds` 日志)。
   */
  setBounds(rect: ViewRect): void {
    this.bounds = { ...rect }
    if (this.attached) this.applyBounds(this.view, rect)
  }

  reset(): void {
    const view = this.view
    this.detach()
    this.view = null
    this.ready = false
    this.bounds = null
    this.revision = 0
    // 新窗口 = 一次全新的加载尝试。闩住的是**这一个 view 的加载结果**,不是「这台机器上这个
    // 功能永久坏了」。
    this.unavailable = false
    this.failOpen()
    if (!view || view.webContents.isDestroyed()) return
    try {
      view.webContents.close()
    } catch {
      // 窗口可能已经把子 view 销毁了,拆不动就算了。
    }
  }

  private present(): void {
    if (!this.dialog) {
      this.detach()
      return
    }
    // 一次矩形都没有就先催一次布局 —— 不催的话这一发只会卡在 `gate=bounds` 上,而调用方还
    // await 着那个永远不会被结掉的 Promise(约束 3)。
    if (!this.bounds && !this._state.opBounds) this._state.layout()
    const view = this.ensureView()
    this.attach()
    if (view && this.attached && !view.webContents.isDestroyed()) view.webContents.focus()
  }

  private ensureView(): WebContentsView | null {
    const win = this._state.browserWindow
    if (!win || win.isDestroyed()) return null
    if (this.view && !this.view.webContents.isDestroyed()) return this.view
    const view = new WebContentsView({
      webPreferences: {
        preload: join(__dirname, '../preload/maestroCoach.js'),
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false,
        partition: MAESTRO_PARTITION
      }
    })
    // 透明:表单自己画一层 scrim,底下的操作区要透出来 —— 这是「对话框」而不是「另一个页面」。
    view.setBackgroundColor('#00000000')
    // 没有对话框的时候它既不在子节点列表里、也不可见 —— 两道都要,和 cowork 那份一致。
    view.setVisible(false)
    this.view = view
    this.ready = false
    // 渲染进程死在半路:`.catch` 管加载失败、`reset()` 管关窗,这一条谁都不走 —— `settle` 还存着,
    // 而能调它的那个页面已经没了。不收场就和加载失败一模一样地把功能毒死。
    view.webContents.on('render-process-gone', (_event, details) => {
      if (this.view !== view) return
      tabAliasLog.error('renderer gone', { reason: details.reason })
      this._state.emitTrace({ kind: 'error', msg: `tab alias renderer gone (${details.reason}) — resolving as cancelled`, ts: Date.now() })
      this.unavailable = true
      this.detach()
      this.failOpen()
    })
    const entryFile = join(__dirname, '../renderer/maestro/tabAlias/index.html')
    const load =
      is.dev && process.env['ELECTRON_RENDERER_URL']
        ? view.webContents.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/maestro/tabAlias/index.html`)
        : view.webContents.loadFile(entryFile)
    void load
      .then(() => {
        if (this.view !== view) return
        this.ready = true
        tabAliasLog.info('layer loaded', { pending: Boolean(this.dialog) })
        // 加载是异步的,请求多半比它先到 —— 加载完必须自己补挂一次,否则第一次弹窗永远不出现。
        this.present()
      })
      .catch((err) => {
        if (this.view !== view) return
        tabAliasLog.error('layer load failed', { error: (err as Error).message })
        this._state.emitTrace({ kind: 'error', msg: 'tab alias load: ' + (err as Error).message, ts: Date.now() })
        // **先闩后结**:闩管的是这之后的每一次请求,少了它 `ready` 停在 false、view 却还活着,
        // 下一次请求就挂在一个没人能 resolve 的 Promise 上。
        this.unavailable = true
        this.failOpen()
      })
    return view
  }

  /** 这一层不可用时的收场:等着的那个 Promise 按「什么都不改」结掉,而不是把调用方永远吊住。 */
  private failOpen(): void {
    const settle = this.settle
    this.dialog = null
    this.settle = null
    this.revision += 1
    settle?.(null)
  }

  /**
   * 约束 (i)/(ii):只有「有对话框 ＋ 页面已加载 ＋ 有矩形」三闸全开才挂进子节点列表,
   * 而且置顶靠**对已挂载的子节点再 `addChildView` 一次**(那是重排),绝不 remove 再 add。
   *
   * `MaestroWorkbenchViewService.applyVisibility()` 里那对 remove+add 能用,只因为它的 view
   * 早就绘制过了;摘掉再挂会走「新挂」路径,而一个还没绘制过的 view 在 macOS 上会沉到最底 ——
   * 照抄那一行到这里,症状是「表单弹了,但你看不见它」。
   */
  private attach(): void {
    const win = this._state.browserWindow
    const view = this.view
    const bounds = this.bounds ?? this._state.opBounds
    const gate = !this.dialog
      ? 'closed'
      : !this.ready
        ? 'unloaded'
        : !win || win.isDestroyed()
          ? 'window'
          : !view || view.webContents.isDestroyed()
            ? 'view'
            : !bounds
              ? 'bounds'
              : null
    if (gate) {
      // 「对话框在页面底下」和「对话框根本没挂上」是两件完全不同的事,不点名就要靠猜。
      // 两路都发:`tab-alias` scope 进日志文件(打包版里唯一查得到的地方),trace 进 Control 面板。
      tabAliasLog.info(`not attached gate=${gate}`)
      if (gate !== 'closed') {
        this._state.emitTrace({ kind: 'info', msg: `tab alias: dialog not attached (gate=${gate})`, ts: Date.now() })
      }
      return
    }
    if (!win || !view || !bounds) return
    this.applyBounds(view, bounds)
    win.contentView.addChildView(view)
    this.attached = true
    // 挂上之后才显 —— 建的时候是 `setVisible(false)`。成对,和 cowork 那份一致。
    view.setVisible(true)
    tabAliasLog.info('dialog attached', { width: Math.round(bounds.width), height: Math.round(bounds.height) })
  }

  private detach(): void {
    const win = this._state.browserWindow
    const view = this.view
    this.attached = false
    if (!win || win.isDestroyed() || !view) return
    if (!view.webContents.isDestroyed()) view.setVisible(false)
    try {
      // 摘掉而不是销毁:渲染进程留着,下一次弹窗是即时的。
      win.contentView.removeChildView(view)
    } catch {
      // 窗口可能已经释放了这个子节点。
    }
  }

  private publish(): void {
    this.revision += 1
    xpcMain.broadcast(MAESTRO_TAB_ALIAS_STATE_EVENT, { revision: this.revision })
  }
}
