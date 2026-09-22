import { shouldOpenDevTools } from '@maestro-main/windows/devtoolsGate'
import { WebContentsView } from 'electron'
import type { BrowserWindow } from 'electron'
import { is } from '@electron-toolkit/utils'
import { xpcMain } from 'electron-xpc/main'
import { injectable } from 'inversify'
import { join } from 'path'
import { CommonService } from '@maestro-shared/iocHelper/ioc.helper'
import type { ViewRect, WorkbenchTabState } from '@maestro-shared/coach.api'
import type { TraceEvent } from '@maestro-shared/trace.types'
import { MAESTRO_PARTITION } from '@maestro-main/data/maestroDataRoot'
import { createBoundsApplier } from './viewBounds'


export interface MaestroWorkbenchViewServiceState {
  browserWindow: BrowserWindow | null
  operationView: WebContentsView | null
  opBounds: ViewRect | null
  emitTrace(event: TraceEvent): void
  layout(): void
  setOperationContentCovered(covered: boolean): void
}

@injectable()
export class MaestroWorkbenchViewService extends CommonService<MaestroWorkbenchViewServiceState> {
  private view: WebContentsView | null = null
  private open = false
  private visible = false
  private readonly applyBounds = createBoundsApplier()

  create(): Promise<void> {
    const win = this._state.browserWindow
    if (!win) return Promise.reject(new Error('Maestro window is not available.'))
    const view = new WebContentsView({
      webPreferences: {
        preload: join(__dirname, '../preload/maestroWorkbench.js'),
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false,
        partition: MAESTRO_PARTITION
      }
    })
    view.setBackgroundColor('#f8fafc')
    view.setVisible(this.visible)
    this.view = view
    win.contentView.addChildView(view)
    this._state.layout()

    if (shouldOpenDevTools('workbench')) {
      view.webContents.once('did-finish-load', () => {
        try {
          view.webContents.openDevTools({ mode: 'detach', activate: false })
        } catch (err) {
          this._state.emitTrace({ kind: 'error', msg: 'workbench devtools: ' + (err as Error).message, ts: Date.now() })
        }
      })
    }

    const load =
      is.dev && process.env['ELECTRON_RENDERER_URL']
        ? view.webContents.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/maestro/workbench/index.html`)
        : view.webContents.loadFile(join(__dirname, '../renderer/maestro/workbench/index.html'))
    return load.catch((err) => {
      this._state.emitTrace({ kind: 'error', msg: 'workbench load: ' + (err as Error).message, ts: Date.now() })
      throw err
    })
  }

  getState(): WorkbenchTabState {
    return { open: this.open, visible: this.visible }
  }

  isVisible(): boolean {
    return this.visible
  }

  openTab(): WorkbenchTabState {
    this.open = true
    this.visible = true
    if (this._state.opBounds) this.applyBounds(this.view, this._state.opBounds)
    else this._state.layout()
    this.applyVisibility()
    this.broadcastVisibility()
    return this.getState()
  }

  // Switching tabs preserves the Workbench chip and its renderer's in-memory recording state.
  backgroundTab(): WorkbenchTabState {
    if (!this.visible) return this.getState()
    this.visible = false
    this.applyVisibility()
    this.broadcastVisibility()
    return this.getState()
  }

  closeTab(): WorkbenchTabState {
    if (!this.open) return this.getState()
    const wasVisible = this.visible
    this.open = false
    this.visible = false
    this.applyVisibility()
    if (wasVisible) {
      const wc = this._state.operationView?.webContents
      if (wc && !wc.isDestroyed()) wc.focus()
    }
    this.broadcastVisibility()
    return this.getState()
  }

  private applyVisibility(): void {
    this._state.setOperationContentCovered(this.visible)
    if (this.view && !this.view.webContents.isDestroyed()) {
      this.view.setVisible(this.visible)
      const window = this._state.browserWindow
      if (this.visible && window && !window.isDestroyed()) {
        window.contentView.removeChildView(this.view)
        window.contentView.addChildView(this.view)
      }
    }
  }

  layout(bounds: { x: number; y: number; width: number; height: number }): void {
    this.setBounds(bounds)
  }

  setBounds(rect: ViewRect): void {
    this.applyBounds(this.view, rect)
  }

  broadcastVisibility(): void {
    xpcMain.broadcast('coach/workbench-visibility', this.getState())
  }

  reset(): void {
    const view = this.view
    this.view = null
    this.open = false
    this.visible = false
    if (!view || view.webContents.isDestroyed()) return
    try {
      view.webContents.close()
    } catch {
      // Best effort: the parent window may already have destroyed the view.
    }
  }
}
