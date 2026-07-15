import { BrowserWindow, BrowserWindowConstructorOptions, app, shell } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { WindowStateStore, captureWindowState, computeRestoreBounds, throttle } from './windowState'
import { MAESTRO_PARTITION, maestroDataRoot } from '@maestro-main/data/maestroDataRoot'

/**
 * Lean window base (bitterless WindowHelper pattern, trimmed for the MVP):
 * concrete helpers set the preload file + renderer entry and export a singleton.
 */
export abstract class WindowHelper {
  browserWindow: BrowserWindow | null = null

  /** preload bundle name under out/preload, e.g. 'maestroCoach.js' */
  protected abstract preloadFile: string
  /** renderer html under out/renderer, e.g. 'maestro/home/index.html' */
  protected abstract rendererPath: string
  protected windowOptions: Partial<BrowserWindowConstructorOptions> = {}
  /** Show on ready-to-show. Hidden helper windows (e.g. the sqlite DB host) set false. */
  protected showOnReady = true
  /** Resolves only after the first-party renderer finished loading; rejects on did-fail-load. */
  protected rendererReady: Promise<void> = Promise.resolve()
  /**
   * Stable id under which this window's geometry (size + position + display) is
   * remembered across restarts. Leave null to opt out of persistence.
   */
  protected windowStateKey: string | null = null

  private static stateStore: WindowStateStore | null = null
  private static getStateStore(): WindowStateStore {
    if (!WindowHelper.stateStore) WindowHelper.stateStore = new WindowStateStore(maestroDataRoot())
    return WindowHelper.stateStore
  }

  create(): BrowserWindow {
    // Maestro uses in-window chrome. Bitterless retains ownership of the application menu.

    // Restore remembered geometry: size always, position only when it still lands
    // on a connected display (else mapped onto the primary display, same relative
    // spot — see windowState.ts). null key / no saved state -> constructor defaults.
    const store = this.windowStateKey ? WindowHelper.getStateStore() : null
    const saved = store ? store.read(this.windowStateKey!) : null
    const restored = computeRestoreBounds(saved)

    const win = new BrowserWindow({
      show: false,
      // White so nothing dark shows before the renderer paints (the app is white throughout).
      backgroundColor: '#ffffff',
      autoHideMenuBar: true,
      width: 1360,
      height: 900,
      // The 96px chrome + operation/control split needs room; clamp the floor so the layout
      // never collapses (also clamps any restored geometry saved smaller than this).
      minWidth: 800,
      minHeight: 600,
      titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : undefined,
      // y=11: centered in the 48px MenuBar header (~18px light block ⇒ 15), nudged up 4px.
      trafficLightPosition: process.platform === 'darwin' ? { x: 16, y: 13 } : undefined,
      ...this.windowOptions,
      ...(restored ?? {}),
      webPreferences: {
        preload: join(__dirname, `../preload/${this.preloadFile}`),
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false,
        partition: MAESTRO_PARTITION,
        ...this.windowOptions.webPreferences
      }
    })
    this.browserWindow = win

    // Persist geometry while dragging/resizing — throttled (leading + trailing) so a
    // drag stream caps at one write per interval yet still saves the final size/
    // position — and once more on close.
    if (store) {
      const key = this.windowStateKey!
      const persist = throttle(() => {
        const state = captureWindowState(win)
        if (state) store.save(key, state)
      }, 400)
      win.on('resize', persist)
      win.on('move', persist)
      win.on('close', () => {
        const state = captureWindowState(win)
        if (state) store.save(key, state)
      })
    }

    // Apply the saved window mode + position on ready-to-show, when the screen config has
    // settled — NOT only at construction. macOS otherwise drops construction-time bounds for
    // a window placed on a secondary / negative-coordinate display and reopens it on the
    // primary; re-asserting the restored bounds here keeps it where it was. Maximize/
    // fullscreen are applied here too (fullscreen must run after show()).
    if (this.showOnReady) {
      win.once('ready-to-show', () => {
        if (saved?.fullScreen) {
          win.show()
          win.setFullScreen(true)
        } else if (saved?.maximized) {
          win.maximize()
          win.show()
        } else {
          if (restored && restored.x != null && restored.y != null) {
            win.setBounds({ x: restored.x, y: restored.y, width: restored.width, height: restored.height })
          }
          win.show()
        }
      })
    }
    win.webContents.once('did-finish-load', () => {
      if (shouldOpenDevTools() && !win.webContents.isDevToolsOpened()) {
        win.webContents.openDevTools({ mode: 'detach', activate: false })
      }
    })
    win.webContents.setWindowOpenHandler((details) => {
      shell.openExternal(details.url)
      return { action: 'deny' }
    })

    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      this.rendererReady = win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/${this.rendererPath}`)
    } else {
      this.rendererReady = win.loadFile(join(__dirname, `../renderer/${this.rendererPath}`))
    }

    return win
  }

  show(): void {
    const win = this.browserWindow
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore()
      win.show()
      if (process.platform === 'darwin') {
        app.focus({ steal: true })
        win.moveTop()
      }
      win.focus()
    }
  }

  destroy(): void {
    if (this.browserWindow && !this.browserWindow.isDestroyed()) {
      this.browserWindow.destroy()
    }
    this.browserWindow = null
  }
}

function shouldOpenDevTools(): boolean {
  if (process.env.COACH_DEMO_SMOKE_OUT) return false
  if (process.env.COACH_OPEN_DEVTOOLS === '0') return false
  return is.dev || process.env.COACH_OPEN_DEVTOOLS === '1'
}
