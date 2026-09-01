import { BrowserWindow } from 'electron'
import { XpcMainHandler, createXpcMainEmitter } from 'electron-xpc/main'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { maestroWindowHelper } from '@maestro-main/windows/main/maestroWindow.controller'
import { sqliteWindowHelper as maestroSqliteWindowHelper } from '@maestro-main/windows/sqliteWindow.helper'
import { initMaestroXpc } from '@maestro-main/xpc/xpc.helper'
import { acquireMaestroProxyDispatcher } from '@maestro-main/net/proxy'
import { activateShortcuts } from '@maestro-main/common/shortcutsHelper/shortcuts.helper'
import { ensureMicromeetCliIntegration, writeMicromeetCliCredential } from '@maestro-main/cli/micromeetCli.service'
import { authBridge } from '@maestro-main/auth/authBridge'
import { maestroDataRoot } from '@maestro-main/data/maestroDataRoot'
import { deviceHelper } from '@maestro-shared/deviceHelper/device.helper'
import type { SqliteBootApi } from '@maestro-shared/sqliteKey.api'
import type { SessionApi } from '@maestro-shared/session.api'

const sqliteBoot = createXpcMainEmitter<SqliteBootApi>('SqliteBootDao')
const maestroSession = createXpcMainEmitter<SessionApi>('MaestroSessionDao')
const authInvalidationMarker = (): string => join(maestroDataRoot(), '.auth-invalidated')
const SQLITE_READY_TIMEOUT_MS = 10_000
const MAESTRO_READY_TIMEOUT_MS = 30_000

const withTimeout = async <T>(operation: Promise<T>, timeoutMs: number, message: string): Promise<T> => {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error(message)), timeoutMs)
  })
  try {
    return await Promise.race([operation, timeout])
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle)
  }
}

const persistAuthInvalidation = (): void => {
  const root = maestroDataRoot()
  mkdirSync(root, { recursive: true, mode: 0o700 })
  writeFileSync(authInvalidationMarker(), `${Date.now()}\n`, { mode: 0o600 })
}

const clearAuthInvalidation = (): void => {
  rmSync(authInvalidationMarker(), { force: true })
}

const waitForWindowLoad = (window: BrowserWindow, timeoutMs: number): Promise<void> =>
  new Promise((resolve, reject) => {
    const webContents = window.webContents
    let settled = false
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined
    const cleanup = (): void => {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle)
      webContents.removeListener('did-finish-load', onLoaded)
      webContents.removeListener('did-fail-load', onFailed)
      webContents.removeListener('destroyed', onDestroyed)
    }
    const settle = (error?: Error): void => {
      if (settled) return
      settled = true
      cleanup()
      if (error) reject(error)
      else resolve()
    }
    const onLoaded = (): void => settle()
    const onFailed = (_event: Electron.Event, code: number, description: string): void => {
      settle(new Error(`[maestro sqlite] hidden window failed to load: ${code} ${description}`))
    }
    const onDestroyed = (): void => {
      settle(new Error('[maestro sqlite] hidden window was destroyed before loading'))
    }

    if (window.isDestroyed() || webContents.isDestroyed()) {
      onDestroyed()
      return
    }
    webContents.once('did-finish-load', onLoaded)
    webContents.once('did-fail-load', onFailed)
    webContents.once('destroyed', onDestroyed)
    timeoutHandle = setTimeout(() => {
      settle(new Error('[maestro sqlite] hidden window load timed out after 10 seconds'))
    }, timeoutMs)
  })

class MaestroWindowHandler extends XpcMainHandler {
  private runtimeInitialized = false
  private bootPromise: Promise<void> | null = null
  private cleanupPromise: Promise<void> | null = null
  private sqliteReadyPromise: Promise<void> | null = null
  private authCleanupPromise: Promise<void> | null = null
  private authInvalidated = false
  private releaseProxy: (() => void) | null = null

  async openMaestroWindow(): Promise<void> {
    if (this.authCleanupPromise) throw new Error('[maestro auth] session cleanup is still running')
    await this.cleanupPromise
    if (this.isAuthInvalidated()) await this.runAuthCleanup()
    this.assertAuthReady()
    if (this.bootPromise) {
      await this.bootPromise
      this.assertAuthReady()
      maestroWindowHelper.show()
      return
    }
    const current = maestroWindowHelper.browserWindow
    if (current && !current.isDestroyed()) {
      maestroWindowHelper.show()
      return
    }

    if (!this.bootPromise) {
      this.bootPromise = this.boot().finally(() => {
        this.bootPromise = null
      })
    }
    await this.bootPromise
    this.assertAuthReady()
    maestroWindowHelper.show()
  }

  async _destroyForAuth(): Promise<void> {
    this.authInvalidated = true
    persistAuthInvalidation()
    await maestroWindowHelper.prepareForAuthShutdown()
    await this.runAuthCleanup()
  }

  async prepareForAuthenticatedSession(): Promise<void> {
    if (!this.isAuthInvalidated()) return
    await this.runAuthCleanup()
  }

  async destroyForHostQuit(): Promise<void> {
    await this.destroyMaestroRuntime()
  }

  private initializeRuntime(): void {
    if (this.runtimeInitialized) return
    ensureMicromeetCliIntegration()
    initMaestroXpc()
    deviceHelper.getDeviceInfo()
    activateShortcuts({
      newTab: () => void maestroWindowHelper.newTab(),
      closeActiveTab: () => void maestroWindowHelper.closeActiveTab()
    })
    this.runtimeInitialized = true
  }

  private async boot(): Promise<void> {
    this.assertAuthReady()
    this.initializeRuntime()
    this.releaseProxy ??= acquireMaestroProxyDispatcher()
    try {
      await this.ensureMaestroSqliteReady()
      this.assertAuthReady()

      const session = await maestroSession.getSession().catch(() => null)
      writeMicromeetCliCredential(session)
      this.assertAuthReady()

      const window = maestroWindowHelper.create()
      window.on('close', (event) => {
        event.preventDefault()
        window.hide()
      })
      window.once('closed', () => {
        void this.destroyMaestroRuntime()
      })
      await withTimeout(
        maestroWindowHelper.whenReady(),
        MAESTRO_READY_TIMEOUT_MS,
        '[maestro] primary window readiness timed out after 30 seconds'
      )
      if (window.isDestroyed()) throw new Error('[maestro] window closed before startup completed')
      this.assertAuthReady()
      maestroWindowHelper.markBootSuccessful()
    } catch (err) {
      await this.destroyMaestroRuntime()
      throw err
    }
  }

  private ensureMaestroSqliteReady(): Promise<void> {
    if (this.sqliteReadyPromise) return this.sqliteReadyPromise
    const ready = (async () => {
      this.initializeRuntime()
      let sqliteWindow = maestroSqliteWindowHelper.browserWindow
      if (!sqliteWindow || sqliteWindow.isDestroyed()) {
        sqliteWindow = maestroSqliteWindowHelper.create()
        await waitForWindowLoad(sqliteWindow, SQLITE_READY_TIMEOUT_MS)
      }
      const result = await withTimeout(
        sqliteBoot.ready(),
        SQLITE_READY_TIMEOUT_MS,
        '[maestro sqlite] preload readiness timed out after 10 seconds'
      )
      if (!result?.ok) {
        throw new Error(result?.error || '[maestro sqlite] hidden preload did not become ready')
      }
    })()
    const tracked = ready.finally(() => {
      if (this.sqliteReadyPromise === tracked) this.sqliteReadyPromise = null
    })
    this.sqliteReadyPromise = tracked
    return tracked
  }

  private isAuthInvalidated(): boolean {
    return this.authInvalidated || existsSync(authInvalidationMarker())
  }

  private assertAuthReady(): void {
    if (this.isAuthInvalidated()) throw new Error('[maestro auth] session is invalidated')
  }

  private runAuthCleanup(): Promise<void> {
    if (this.authCleanupPromise) return this.authCleanupPromise
    this.authInvalidated = true
    const cleanup = this.performAuthCleanup().then(() => {
      clearAuthInvalidation()
      this.authInvalidated = false
    })
    const tracked = cleanup.finally(() => {
      if (this.authCleanupPromise === tracked) this.authCleanupPromise = null
    })
    this.authCleanupPromise = tracked
    return tracked
  }

  private async performAuthCleanup(): Promise<void> {
    await authBridge.quiesce()
    const boot = this.bootPromise
    if (boot) await boot.catch(() => undefined)
    await authBridge.quiesce()
    await this.destroyMaestroRuntime(async () => {
      await this.ensureMaestroSqliteReady()
      const cleared = await maestroSession.clearSession()
      if (!cleared?.ok) throw new Error('[maestro auth] session DAO refused to clear')
      if (!writeMicromeetCliCredential(null)) {
        throw new Error('[maestro auth] Micromeet CLI credential could not be cleared')
      }
    })
  }

  private async destroyMaestroRuntime(beforeFinalize?: () => Promise<void>): Promise<void> {
    if (this.cleanupPromise) {
      await this.cleanupPromise
      if (beforeFinalize) {
        try {
          await beforeFinalize()
        } finally {
          maestroSqliteWindowHelper.destroy()
        }
      }
      return
    }
    if (!this.cleanupPromise) {
      this.cleanupPromise = (async () => {
        try {
          await maestroWindowHelper.shutdown()
          await beforeFinalize?.()
        } finally {
          maestroSqliteWindowHelper.destroy()
          this.releaseProxy?.()
          this.releaseProxy = null
        }
      })().finally(() => {
        this.cleanupPromise = null
      })
    }
    await this.cleanupPromise
  }
}

export const maestroWindowHandler = new MaestroWindowHandler()
export type { MaestroWindowHandler }
