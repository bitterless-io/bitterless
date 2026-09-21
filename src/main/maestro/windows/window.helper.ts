import { BrowserWindow, BrowserWindowConstructorOptions, app, shell } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { WindowStateStore as LegacyWindowStateStore } from './windowState'
import { MAESTRO_PARTITION, maestroDataRoot } from '@maestro-main/data/maestroDataRoot'
import {
  windowStateService,
  type WindowStateController
} from '@main/windows/windowState.service'
import type { WindowStateKey } from '@shared/window/window.types'
import {
  openAnchoredDevTools,
  setDevToolsAnchor
} from '@maestro-main/windows/devtoolsAnchor.service'

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
  /** Query values delivered only to this helper's first-party renderer entry. */
  protected rendererQuery: Record<string, string> | undefined
  /** Resolves only after the first-party renderer finished loading; rejects on did-fail-load. */
  protected rendererReady: Promise<void> = Promise.resolve()
  /**
   * Stable id under which this window's geometry (size + position + display) is
   * remembered across restarts. Leave null to opt out of persistence.
   */
  protected windowStateKey: WindowStateKey | null = null
  /**
   * 这一扇是不是 DevTools 要跟着走的那个主窗。只有 Maestro 主窗设 true ——
   * 隐藏的 sqlite 宿主窗比主窗先开,它的 DevTools 要锚到**主窗**,不是锚到它自己。
   */
  protected isDevToolsAnchor = false
  private windowStateController: WindowStateController | null = null

  create(): BrowserWindow {
    // Maestro uses in-window chrome. Bitterless retains ownership of the application menu.

    // Restore remembered geometry: size always, position only when it still lands
    // on a connected display (else mapped onto the primary display, same relative
    // spot — see windowState.ts). null key / no saved state -> constructor defaults.
    if (this.windowStateKey === 'maestro' && !windowStateService.has('maestro')) {
      const legacy = new LegacyWindowStateStore(maestroDataRoot()).read('cowork-main')
      if (legacy) windowStateService.importLegacy('maestro', legacy)
    }
    const restored = this.windowStateKey
      ? windowStateService.resolve(this.windowStateKey)
      : null

    const win = new BrowserWindow({
      show: false,
      // White so nothing dark shows before the renderer paints (the app is white throughout).
      backgroundColor: '#ffffff',
      autoHideMenuBar: true,
      width: 1360,
      height: 900,
      // The 78px chrome + operation/control split needs room; clamp the floor so the layout
      // never collapses (also clamps any restored geometry saved smaller than this).
      minWidth: 800,
      minHeight: 600,
      titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : undefined,
      // Omni's x position, with Ral's requested 1px downward optical adjustment.
      trafficLightPosition: process.platform === 'darwin' ? { x: 12, y: 11 } : undefined,
      ...this.windowOptions,
      ...(restored?.bounds ?? {}),
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
    // 在加载之前就注册:窗口自己的 DevTools 要到 did-finish-load 才开,而 sqlite 宿主窗那扇
    // 更早,两者都要能看到这个锚。
    if (this.isDevToolsAnchor) setDevToolsAnchor(win)
    this.windowStateController = this.windowStateKey
      ? windowStateService.register(this.windowStateKey, win)
      : null

    // Apply the saved window mode + position on ready-to-show, when the screen config has
    // settled — NOT only at construction. macOS otherwise drops construction-time bounds for
    // a window placed on a secondary / negative-coordinate display and reopens it on the
    // primary; re-asserting the restored bounds here keeps it where it was. Maximize/
    // fullscreen are applied here too (fullscreen must run after show()).
    if (this.showOnReady) {
      win.once('ready-to-show', () => {
        if (this.windowStateController) {
          this.windowStateController.show()
        } else {
          win.show()
        }
      })
    }
    win.webContents.once('did-finish-load', () => {
      // 去重由 openAnchoredDevTools 自己的映射负责 —— 自托管之后 `isDevToolsOpened()` 恒为
      // false,拿它当闸等于每次都判成"还没开"。
      if (shouldOpenDevTools()) {
        openAnchoredDevTools(win.webContents, { title: this.rendererPath })
      }
    })
    win.webContents.setWindowOpenHandler((details) => {
      shell.openExternal(details.url)
      return { action: 'deny' }
    })

    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      const rendererUrl = new URL(`${process.env['ELECTRON_RENDERER_URL']}/${this.rendererPath}`)
      for (const [key, value] of Object.entries(this.rendererQuery ?? {})) {
        rendererUrl.searchParams.set(key, value)
      }
      this.rendererReady = win.loadURL(rendererUrl.toString())
    } else {
      const rendererFile = join(__dirname, `../renderer/${this.rendererPath}`)
      this.rendererReady = this.rendererQuery
        ? win.loadFile(rendererFile, { query: this.rendererQuery })
        : win.loadFile(rendererFile)
    }

    return win
  }

  show(): void {
    const win = this.browserWindow
    if (win && !win.isDestroyed()) {
      if (this.windowStateController) {
        this.windowStateController.show()
      } else {
        if (win.isMinimized()) win.restore()
        win.show()
      }
      if (process.platform === 'darwin') {
        app.focus({ steal: true })
        win.moveTop()
      }
      win.focus()
    }
  }

  destroy(): void {
    if (this.browserWindow && !this.browserWindow.isDestroyed()) {
      this.windowStateController?.flushAndDispose()
      this.browserWindow.destroy()
    }
    this.browserWindow = null
    this.windowStateController = null
  }
}

export const shouldOpenDevTools = (): boolean => {
  if (import.meta.env.VITE_MODE !== 'debug') return false
  if (process.env.BITTERLESS_E2E === '1') return false
  if (process.env.COACH_DEMO_SMOKE_OUT) return false
  if (process.env.COACH_OPEN_DEVTOOLS === '0') return false
  return is.dev || process.env.COACH_OPEN_DEVTOOLS === '1'
}
