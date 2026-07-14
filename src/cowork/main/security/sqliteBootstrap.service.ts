import { randomBytes } from 'crypto'
import { mkdirSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'

let sqliteBootstrapToken = ''
const SQLITE_BOOTSTRAP_FILE = 'sqlite-bootstrap-token'

export const rotateSqliteBootstrapToken = (): string => {
  sqliteBootstrapToken = randomBytes(24).toString('hex')
  return sqliteBootstrapToken
}

export const isSqliteBootstrapTokenValid = (token: string): boolean => {
  return token.length > 0 && token === sqliteBootstrapToken
}

export const writeSqliteBootstrapTokenFile = (userData: string): string => {
  const token = rotateSqliteBootstrapToken()
  const tokenPath = join(userData, 'config', SQLITE_BOOTSTRAP_FILE)
  mkdirSync(dirname(tokenPath), { recursive: true })
  writeFileSync(tokenPath, token, { mode: 0o600 })
  return tokenPath
}
