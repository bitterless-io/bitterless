// Preload for the hidden "sqlite" window. It owns the encrypted config DB (Node context,
// sandbox:false) and exposes it over electron-xpc via ConfigDao — reached from the control
// renderer with createXpcRendererEmitter<ConfigApi>('ConfigDao'). Mirrors bitterless's
// "sqlite lives in a preload" pattern, trimmed to one config table.
import { createXpcPreloadEmitter, XpcPreloadHandler } from 'electron-xpc/preload'
import { readFileSync, unlinkSync } from 'fs'
import { sqliteManager } from './sqlite/sqliteManager'
import type { SqliteBootApi, SqliteBootResult, SqliteKeyApi } from '@maestro-shared/sqliteKey.api'

const getArgValue = (prefix: string): string => {
  const arg = process.argv.find((a) => a.startsWith(prefix))
  return arg ? arg.slice(prefix.length) : ''
}

const readBootstrapToken = (): string => {
  const tokenPath = getArgValue('--coach-sqlite-bootstrap-file=')
  if (!tokenPath) throw new Error('[maestro sqlite] missing sqlite bootstrap token file')
  const token = readFileSync(tokenPath, 'utf-8').trim()
  try {
    unlinkSync(tokenPath)
  } catch {
    // Non-fatal: the token value is already in memory and the file is mode 0600.
  }
  return token
}

const sqliteKeyService = createXpcPreloadEmitter<SqliteKeyApi>('SqliteKeyService')

let bootResult: SqliteBootResult = { ok: false, error: 'SQLite preload has not finished booting.' }

const bootSqlite = async (): Promise<void> => {
  try {
    const bootstrapToken = readBootstrapToken()
    if (!bootstrapToken) throw new Error('[maestro sqlite] missing sqlite bootstrap token')

    const sqliteKey = await sqliteKeyService.getSqliteKey({ bootstrapToken })
    if (!sqliteKey) throw new Error('[maestro sqlite] main process returned an empty SQLite key')

    sqliteManager.init(__BITTERLESS_VERSION_CODE__, sqliteKey)

    // Importing each DAO instantiates its XpcPreloadHandler and registers its channels.
    await import('./sqlite/config.dao')
    await import('./sqlite/capture_filter.dao')
    await import('./sqlite/tabs.dao')
    // 这里原来 import 的是 session.dao(随 AI-CRMS 退役删除)。它写的四个 localStorage 键落在
    // 这个隐藏窗口的 partition 里,只有这个 preload 够得着 —— 换成一次性清理,不注册任何通道。
    const { clearCrmsSessionResidue } = await import('./sqlite/crmsSessionResidue')
    clearCrmsSessionResidue()
    await import('./sqlite/maestroChat.dao')
    await import('./sqlite/inject_btn.dao')
    // apidoc 台账(drill-001)。注册是**构造副作用** —— 不 import 就等于没注册,
    // 而症状是运行期 `xpc:ApidocDao/*` 找不到,不是编译错误。
    await import('./sqlite/apidoc.dao')

    bootResult = { ok: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    bootResult = { ok: false, error: message }
    console.error('[maestro sqlite] init failed:', err)
  }
}

// Electron can evaluate a BrowserWindow preload for its initial about:blank document before the
// requested file navigation. Only the actual hidden SQLite renderer may consume the one-time
// bootstrap token; otherwise the target document's second preload evaluation finds it missing.
const isSqliteRendererDocument = location.pathname.endsWith('/maestro/sqlite/index.html')
const bootPromise = isSqliteRendererDocument ? bootSqlite() : Promise.resolve()

export class SqliteBootDao extends XpcPreloadHandler implements SqliteBootApi {
  async ready(): Promise<SqliteBootResult> {
    await bootPromise.catch(() => undefined)
    return bootResult
  }
}

export const sqliteBootDao = new SqliteBootDao()
