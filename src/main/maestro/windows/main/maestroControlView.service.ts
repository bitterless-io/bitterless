import { WebContentsView } from 'electron'
import type { BrowserWindow } from 'electron'
import { is } from '@electron-toolkit/utils'
import { injectable } from 'inversify'
import { join } from 'path'
import { CommonService } from '@maestro-shared/iocHelper/ioc.helper'
import type { ViewRect } from '@maestro-shared/coach.api'
import type { TraceEvent } from '@maestro-shared/trace.types'
import { MAESTRO_PARTITION } from '@maestro-main/data/maestroDataRoot'
import { createBoundsApplier } from './viewBounds'

export interface MaestroControlViewServiceState {
  browserWindow: BrowserWindow | null
  emitTrace(event: TraceEvent): void
}

@injectable()
export class MaestroControlViewService extends CommonService<MaestroControlViewServiceState> {
  private view: WebContentsView | null = null
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
    this.view = view
    win.contentView.addChildView(view)
    const load =
      is.dev && process.env['ELECTRON_RENDERER_URL']
        ? view.webContents.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/maestro/control/index.html`)
        : view.webContents.loadFile(join(__dirname, '../renderer/maestro/control/index.html'))

    if (process.env.BITTERLESS_E2E !== '1' && (is.dev || process.env.COACH_DEVTOOLS === '1')) {
      view.webContents.once('did-finish-load', () => {
        if (!view.webContents.isDestroyed() && !view.webContents.isDevToolsOpened()) {
          view.webContents.openDevTools({ mode: 'detach', activate: false })
        }
      })
    }

    return load.catch((err) => {
      this._state.emitTrace({ kind: 'error', msg: 'control load: ' + (err as Error).message, ts: Date.now() })
      throw err
    })
  }

  layout(bounds: { x: number; y: number; width: number; height: number }): void {
    this.view?.setBounds(bounds)
  }

  setBounds(rect: ViewRect): void {
    this.applyBounds(this.view, rect)
  }

  reset(): void {
    const view = this.view
    this.view = null
    if (!view || view.webContents.isDestroyed()) return
    try {
      view.webContents.close()
    } catch {
      // Best effort: the parent window may already have destroyed the view.
    }
  }
}
