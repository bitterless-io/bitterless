import { BrowserWindow } from 'electron'
import { WindowHelper } from './window.helper'
import { writeSqliteBootstrapTokenFile } from '@cowork-main/security/sqliteBootstrap.service'
import { coworkDataRoot } from '@cowork-main/data/coworkDataRoot'

/**
 * Hidden window whose preload (coworkSqlite.js) owns the encrypted config DB. Never shown — other
 * windows reach the DB over electron-xpc (ConfigDao). The host's "sqlite in a preload"
 * pattern: a renderer process exists only to host the Node-context preload.
 */
class SqliteWindowHelper extends WindowHelper {
  protected preloadFile = 'coworkSqlite.js'
  protected rendererPath = 'coworkSqlite/index.html'
  protected showOnReady = false

  create(): BrowserWindow {
    // The preload has no `app`, so hand it userData via additionalArguments to locate the DB.
    // The bootstrap token gates the one-time main-process key request; it is not the DB key.
    // Only the token file path is passed via argv; the token itself lives in a 0600 temp file.
    const userData = coworkDataRoot()
    const bootstrapFile = writeSqliteBootstrapTokenFile(userData)
    this.windowOptions = {
      width: 480,
      height: 320,
      webPreferences: {
        additionalArguments: ['--coach-userdata=' + userData, '--coach-sqlite-bootstrap-file=' + bootstrapFile]
      }
    }
    return super.create()
  }
}

export const sqliteWindowHelper = new SqliteWindowHelper()
