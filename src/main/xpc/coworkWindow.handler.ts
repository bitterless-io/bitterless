import { BrowserWindow } from 'electron'
import { XpcMainHandler, createXpcMainEmitter } from 'electron-xpc/main'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { coworkWindowHelper } from '@cowork-main/windows/coworkWindow.helper'
import { sqliteWindowHelper as coworkSqliteWindowHelper } from '@cowork-main/windows/sqliteWindow.helper'
import { initCoworkXpc } from '@cowork-main/xpc/xpc.helper'
import { acquireCoworkProxyDispatcher } from '@cowork-main/net/proxy'
import { activateShortcuts } from '@cowork-main/common/shortcutsHelper/shortcuts.helper'
import { ensureMicromeetCliIntegration, writeMicromeetCliCredential } from '@cowork-main/cli/micromeetCli.service'
import { authBridge } from '@cowork-main/auth/authBridge'
import { coworkDataRoot } from '@cowork-main/data/coworkDataRoot'
import { deviceHelper } from '@cowork-shared/deviceHelper/device.helper'
import type { SqliteBootApi } from '@cowork-shared/sqliteKey.api'
import type { SessionApi } from '@cowork-shared/session.api'

const sqliteBoot = createXpcMainEmitter<SqliteBootApi>('SqliteBootDao')
const coworkSession = createXpcMainEmitter<SessionApi>('CoworkSessionDao')
const authInvalidationMarker = (): string => join(coworkDataRoot(), '.auth-invalidated')

const persistAuthInvalidation = (): void => {
  const root = coworkDataRoot()
  mkdirSync(root, { recursive: true, mode: 0o700 })
  writeFileSync(authInvalidationMarker(), `${Date.now()}\n`, { mode: 0o600 })
}

const clearAuthInvalidation = (): void => {
  rmSync(authInvalidationMarker(), { force: true })
}

const waitForWindowLoad = (window: BrowserWindow): Promise<void> =>
  new Promise((resolve, reject) => {
    const cleanup = (): void => {
      window.webContents.removeListener('did-finish-load', onLoaded)
      window.webContents.removeListener('did-fail-load', onFailed)
    }
    const onLoaded = (): void => {
      cleanup()
      resolve()
    }
    const onFailed = (_event: Electron.Event, code: number, description: string): void => {
      cleanup()
      reject(new Error(`[cowork sqlite] hidden window failed to load: ${code} ${description}`))
    }
    window.webContents.once('did-finish-load', onLoaded)
    window.webContents.once('did-fail-load', onFailed)
  })

class CoworkWindowHandler extends XpcMainHandler {
  private runtimeInitialized = false
  private bootPromise: Promise<void> | null = null
  private cleanupPromise: Promise<void> | null = null
  private sqliteReadyPromise: Promise<void> | null = null
  private authCleanupPromise: Promise<void> | null = null
  private authInvalidated = false
  private releaseProxy: (() => void) | null = null

  async openCoworkWindow(): Promise<void> {
    if (this.authCleanupPromise) throw new Error('[cowork auth] session cleanup is still running')
    await this.cleanupPromise
    if (this.isAuthInvalidated()) await this.runAuthCleanup()
    this.assertAuthReady()
    const current = coworkWindowHelper.browserWindow
    if (current && !current.isDestroyed()) {
      coworkWindowHelper.show()
      return
    }

    if (!this.bootPromise) {
      this.bootPromise = this.boot().finally(() => {
        this.bootPromise = null
      })
    }
    await this.bootPromise
    this.assertAuthReady()
    coworkWindowHelper.show()
  }

  async _destroyForAuth(): Promise<void> {
    this.authInvalidated = true
    persistAuthInvalidation()
    await this.runAuthCleanup()
  }

  async prepareForAuthenticatedSession(): Promise<void> {
    if (!this.isAuthInvalidated()) return
    await this.runAuthCleanup()
  }

  async destroyForHostQuit(): Promise<void> {
    await this.destroyCoworkRuntime()
  }

  private initializeRuntime(): void {
    if (this.runtimeInitialized) return
    this.runtimeInitialized = true
    initCoworkXpc()
    deviceHelper.getDeviceInfo()
    ensureMicromeetCliIntegration()
    activateShortcuts({
      newTab: () => void coworkWindowHelper.newTab(),
      closeActiveTab: () => void coworkWindowHelper.closeActiveTab()
    })
  }

  private async boot(): Promise<void> {
    this.assertAuthReady()
    this.initializeRuntime()
    this.releaseProxy ??= acquireCoworkProxyDispatcher()
    try {
      await this.ensureCoworkSqliteReady()
      this.assertAuthReady()

      const session = await coworkSession.getSession().catch(() => null)
      writeMicromeetCliCredential(session)
      this.assertAuthReady()

      const window = coworkWindowHelper.create()
      window.once('closed', () => {
        void this.destroyCoworkRuntime()
      })
      await coworkWindowHelper.whenReady()
      if (window.isDestroyed()) throw new Error('[cowork] window closed before startup completed')
      this.assertAuthReady()
    } catch (err) {
      await this.destroyCoworkRuntime()
      throw err
    }
  }

  private ensureCoworkSqliteReady(): Promise<void> {
    if (this.sqliteReadyPromise) return this.sqliteReadyPromise
    const ready = (async () => {
      this.initializeRuntime()
      let sqliteWindow = coworkSqliteWindowHelper.browserWindow
      if (!sqliteWindow || sqliteWindow.isDestroyed()) {
        sqliteWindow = coworkSqliteWindowHelper.create()
        await waitForWindowLoad(sqliteWindow)
      }
      const result = await sqliteBoot.ready()
      if (!result?.ok) {
        throw new Error(result?.error || '[cowork sqlite] hidden preload did not become ready')
      }
    })()
    let tracked: Promise<void>
    tracked = ready.finally(() => {
      if (this.sqliteReadyPromise === tracked) this.sqliteReadyPromise = null
    })
    this.sqliteReadyPromise = tracked
    return tracked
  }

  private isAuthInvalidated(): boolean {
    return this.authInvalidated || existsSync(authInvalidationMarker())
  }

  private assertAuthReady(): void {
    if (this.isAuthInvalidated()) throw new Error('[cowork auth] session is invalidated')
  }

  private runAuthCleanup(): Promise<void> {
    if (this.authCleanupPromise) return this.authCleanupPromise
    this.authInvalidated = true
    const cleanup = this.performAuthCleanup().then(() => {
      clearAuthInvalidation()
      this.authInvalidated = false
    })
    let tracked: Promise<void>
    tracked = cleanup.finally(() => {
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
    await this.destroyCoworkRuntime(async () => {
      await this.ensureCoworkSqliteReady()
      const cleared = await coworkSession.clearSession()
      if (!cleared?.ok) throw new Error('[cowork auth] session DAO refused to clear')
      if (!writeMicromeetCliCredential(null)) {
        throw new Error('[cowork auth] Micromeet CLI credential could not be cleared')
      }
    })
  }

  private async destroyCoworkRuntime(beforeFinalize?: () => Promise<void>): Promise<void> {
    if (this.cleanupPromise) {
      await this.cleanupPromise
      if (beforeFinalize) {
        try {
          await beforeFinalize()
        } finally {
          coworkSqliteWindowHelper.destroy()
        }
      }
      return
    }
    if (!this.cleanupPromise) {
      this.cleanupPromise = (async () => {
        try {
          await coworkWindowHelper.shutdown()
          await beforeFinalize?.()
        } finally {
          coworkSqliteWindowHelper.destroy()
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

export const coworkWindowHandler = new CoworkWindowHandler()
export type { CoworkWindowHandler }
