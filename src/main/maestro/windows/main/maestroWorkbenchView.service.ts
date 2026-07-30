import { WebContentsView } from 'electron'
import type { BrowserWindow } from 'electron'
import { is } from '@electron-toolkit/utils'
import { xpcMain } from 'electron-xpc/main'
import { injectable } from 'inversify'
import { join } from 'path'
import { CommonService } from '@maestro-shared/iocHelper/ioc.helper'
import type { ViewRect } from '@maestro-shared/coach.api'
import type { TraceEvent } from '@maestro-shared/trace.types'
import { MAESTRO_PARTITION } from '@maestro-main/data/maestroDataRoot'
import { createBoundsApplier } from './viewBounds'

const shouldOpenWorkbenchDevTools = (): boolean => {
  if (process.env.COACH_DEMO_SMOKE_OUT) return false
  if (process.env.COACH_WORKBENCH_DEVTOOLS === '0') return false
  return is.dev || process.env.COACH_WORKBENCH_DEVTOOLS === '1' || process.env.COACH_DEVTOOLS === '1' || process.env.COACH_OPEN_DEVTOOLS === '1'
}

export interface MaestroWorkbenchViewServiceState {
  browserWindow: BrowserWindow | null
  opBounds: ViewRect | null
  emitTrace(event: TraceEvent): void
  layout(): void
}

@injectable()
export class MaestroWorkbenchViewService extends CommonService<MaestroWorkbenchViewServiceState> {
  private view: WebContentsView | null = null
  private visible = false
  private readonly applyBounds = createBoundsApplier()

  create(): Promise<void> {
    const win = this._state.browserWindow
    if (!win) return Promise.reject(new Error('Maestro window is not available.'))
    const view = new WebContentsView({
      webPreferences: {
        preload: join(__dirname, '../preload/maestroCoach.js'),
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false,
        partition: MAESTRO_PARTITION
      }
    })
    view.setBackgroundColor('#f8fafc')
    view.setVisible(false)
    this.view = view
    win.contentView.addChildView(view)

    if (shouldOpenWorkbenchDevTools()) {
      view.webContents.once('did-finish-load', () => {
        if (view.webContents.isDestroyed() || view.webContents.isDevToolsOpened()) return
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

  getVisible(): { visible: boolean } {
    return { visible: this.visible }
  }

  isVisible(): boolean {
    return this.visible
  }

  setVisible(params: { visible: boolean }): { visible: boolean } {
    this.visible = Boolean(params.visible)
    if (this._state.opBounds) this.applyBounds(this.view, this._state.opBounds)
    else this._state.layout()
    if (this.view && !this.view.webContents.isDestroyed()) {
      this.view.setVisible(this.visible)
    }
    this.broadcastVisibility()
    return { visible: this.visible }
  }

  layout(bounds: { x: number; y: number; width: number; height: number }): void {
    this.view?.setBounds(bounds)
  }

  setBounds(rect: ViewRect): void {
    this.applyBounds(this.view, rect)
  }

  broadcastVisibility(): void {
    xpcMain.broadcast('coach/workbench-visibility', { visible: this.visible })
  }

  reset(): void {
    const view = this.view
    this.view = null
    this.visible = false
    if (!view || view.webContents.isDestroyed()) return
    try {
      view.webContents.close()
    } catch {
      // Best effort: the parent window may already have destroyed the view.
    }
  }
}
