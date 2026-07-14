import { randomBytes } from 'crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { app, safeStorage } from 'electron'
import { XpcMainHandler } from 'electron-xpc/main'
import { isSqliteBootstrapTokenValid } from './sqliteBootstrap.service'
import type { SqliteKeyApi, SqliteKeyRequest } from '@cowork-shared/sqliteKey.api'
import { coworkDataRoot } from '@cowork-main/data/coworkDataRoot'

const PRODUCTION_SQLITE_KEY_FILE = 'sqlite-key.bin'
const DEVELOPMENT_SQLITE_KEY_FILE = 'sqlite-key.dev.hex'
const E2E_SQLITE_KEY = process.env.BITTERLESS_E2E === '1' ? randomBytes(32).toString('hex') : ''

const assertSafeStorageAvailable = (): void => {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('[coach sqlite] Electron safeStorage is not available; refusing to open customer data with an unprotected DB key')
  }
}

const makeSqliteKey = (): string => randomBytes(32).toString('hex')

const ensurePrivateDirectory = (directory: string): void => {
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  if (process.platform !== 'win32') chmodSync(directory, 0o700)
}

const assertSqliteKeyFormat = (key: string, source: string): string => {
  if (!/^[0-9a-f]{64}$/.test(key)) {
    throw new Error(`[coach sqlite] ${source} is invalid; expected exactly 64 hexadecimal characters`)
  }
  return key
}

const isAlreadyExistsError = (err: unknown): boolean => (err as NodeJS.ErrnoException)?.code === 'EEXIST'

const readEncryptedKey = (keyPath: string): string => {
  assertSafeStorageAvailable()
  return assertSqliteKeyFormat(
    safeStorage.decryptString(readFileSync(keyPath)),
    'production SQLCipher key file'
  )
}

const writeEncryptedKey = (keyPath: string, key: string): boolean => {
  assertSafeStorageAvailable()
  ensurePrivateDirectory(dirname(keyPath))
  const encryptedKey = safeStorage.encryptString(key)
  try {
    writeFileSync(keyPath, encryptedKey, { flag: 'wx', mode: 0o600 })
  } catch (err) {
    if (isAlreadyExistsError(err)) return false
    throw err
  }
  if (process.platform !== 'win32') chmodSync(keyPath, 0o600)
  return true
}

const getOrCreateProductionSqliteKey = (configDirectory: string, dbPath: string): string => {
  const keyPath = join(configDirectory, PRODUCTION_SQLITE_KEY_FILE)
  if (existsSync(keyPath)) return readEncryptedKey(keyPath)
  if (existsSync(dbPath)) {
    throw new Error(
      '[coach sqlite] config.db exists but its encrypted key file is missing; refusing to guess a legacy key'
    )
  }

  const key = makeSqliteKey()
  if (!writeEncryptedKey(keyPath, key)) return readEncryptedKey(keyPath)
  console.log('[coach sqlite] created random SQLCipher key in Electron safeStorage')
  return key
}

const readDevelopmentKey = (keyPath: string): string => {
  if (process.platform !== 'win32') chmodSync(keyPath, 0o600)
  return assertSqliteKeyFormat(readFileSync(keyPath, 'utf8'), 'development SQLCipher key file')
}

const getOrCreateDevelopmentSqliteKey = (configDirectory: string, dbPath: string): string => {
  const keyPath = join(configDirectory, DEVELOPMENT_SQLITE_KEY_FILE)
  if (existsSync(keyPath)) {
    ensurePrivateDirectory(configDirectory)
    return readDevelopmentKey(keyPath)
  }
  if (existsSync(dbPath)) {
    throw new Error(
      '[coach sqlite] config.db exists but its development key file is missing; refusing to create or reuse another environment key'
    )
  }

  ensurePrivateDirectory(configDirectory)
  const key = makeSqliteKey()
  try {
    writeFileSync(keyPath, key, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
  } catch (err) {
    if (isAlreadyExistsError(err)) return readDevelopmentKey(keyPath)
    throw err
  }
  if (process.platform !== 'win32') chmodSync(keyPath, 0o600)
  console.log('[coach sqlite] created random development SQLCipher key')
  return key
}

const getOrCreateSqliteKey = (): string => {
  if (process.env.BITTERLESS_E2E === '1') {
    if (app.isPackaged) throw new Error('[coach sqlite] E2E key mode is unavailable in packaged builds')
    console.log('[coach sqlite] using an ephemeral random E2E SQLCipher key')
    return E2E_SQLITE_KEY
  }

  const configDirectory = join(coworkDataRoot(), 'config')
  const dbPath = join(configDirectory, 'config.db')
  const viteEnv: string = import.meta.env.VITE_ENV
  if (viteEnv === 'prod') return getOrCreateProductionSqliteKey(configDirectory, dbPath)
  if (viteEnv === 'dev') return getOrCreateDevelopmentSqliteKey(configDirectory, dbPath)
  throw new Error(`[coach sqlite] unsupported VITE_ENV "${viteEnv}"; refusing to select a SQLCipher key store`)
}

export class SqliteKeyService extends XpcMainHandler implements SqliteKeyApi {
  async getSqliteKey(params: SqliteKeyRequest): Promise<string> {
    if (!isSqliteBootstrapTokenValid(params.bootstrapToken)) {
      throw new Error('[coach sqlite] rejected SQLite key request with invalid bootstrap token')
    }
    return getOrCreateSqliteKey()
  }
}

export const sqliteKeyService = new SqliteKeyService()
