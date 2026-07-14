import { app } from 'electron'
import { createCipheriv, randomBytes } from 'crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { dirname, join } from 'path'
import type { AuthSession } from '@cowork-shared/session.api'

const MICROMEET_DIR = join(homedir(), '.micromeet')
const MICROMEET_BIN_DIR = join(MICROMEET_DIR, 'bin')
const CREDENTIAL_DIR = join(MICROMEET_DIR, 'credentials')
const CRMS_CREDENTIAL_FILE = join(CREDENTIAL_DIR, 'crms.json')
const CREDENTIAL_KEY_FILE = join(CREDENTIAL_DIR, '.credential-key-v2')
const LEGACY_SESSION_FILE = join(MICROMEET_DIR, 'session.json')

const cliFileName = (): string => (process.platform === 'win32' ? 'micromeet.exe' : 'micromeet')

export const micromeetCliCredentialFile = (): string => CRMS_CREDENTIAL_FILE

export const bundledMicromeetCliPath = (): string => {
  const override = process.env.MICROMEET_CLI_PATH?.trim()
  if (override) return override
  if (app.isPackaged) return join(process.resourcesPath, 'cowork-tools', cliFileName())
  return join(app.getAppPath(), 'build', 'cowork-tools', cliFileName())
}

const ensurePrivateDir = (dir: string): void => {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  if (process.platform !== 'win32') chmodSync(dir, 0o700)
}

const shellQuote = (value: string): string => `'${value.replace(/'/g, "'\\''")}'`

const writeShim = (cliPath: string): void => {
  ensurePrivateDir(MICROMEET_BIN_DIR)
  if (process.platform === 'win32') {
    const shim = join(MICROMEET_BIN_DIR, 'micromeet.cmd')
    writeFileSync(shim, `@echo off\r\n"${cliPath}" %*\r\n`, { mode: 0o755 })
    return
  }
  const shim = join(MICROMEET_BIN_DIR, 'micromeet')
  writeFileSync(shim, `#!/bin/sh\nexec ${shellQuote(cliPath)} "$@"\n`, { mode: 0o755 })
  chmodSync(shim, 0o755)
}

const prependPath = (dir: string): void => {
  const delimiter = process.platform === 'win32' ? ';' : ':'
  const current = process.env.PATH || ''
  const parts = current.split(delimiter).filter(Boolean)
  if (!parts.includes(dir)) process.env.PATH = [dir, ...parts].join(delimiter)
}

const normalizeEmail = (email: string): string => {
  const normalized = email.trim().toLowerCase()
  if (!normalized || !normalized.includes('@')) throw new Error('CRMS JWT email claim is missing or invalid')
  return normalized
}

const jwtEmail = (token: string): string => {
  const payloadPart = token.split('.')[1]
  if (!payloadPart) throw new Error('CRMS JWT payload is missing')
  const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8')) as { email?: string }
  return normalizeEmail(payload.email || '')
}

const readCredentialKey = (): Buffer => {
  const key = readFileSync(CREDENTIAL_KEY_FILE)
  if (key.length !== 32) throw new Error('Micromeet CLI credential key file must contain exactly 32 bytes')
  if (process.platform !== 'win32') chmodSync(CREDENTIAL_KEY_FILE, 0o600)
  return key
}

const getOrCreateCredentialKey = (): Buffer => {
  if (existsSync(CREDENTIAL_KEY_FILE)) return readCredentialKey()
  const key = randomBytes(32)
  try {
    writeFileSync(CREDENTIAL_KEY_FILE, key, { flag: 'wx', mode: 0o600 })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
    return readCredentialKey()
  }
  if (process.platform !== 'win32') chmodSync(CREDENTIAL_KEY_FILE, 0o600)
  return key
}

const encryptCrmsCredential = (session: AuthSession, key: Buffer): Record<string, unknown> => {
  const email = jwtEmail(session.jwt_token)
  const iv = randomBytes(12)
  const aad = Buffer.from('micromeet-credential:v2:crms', 'utf8')
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(aad)
  const payload = {
    realm: 'crms',
    email,
    token: session.jwt_token,
    workspace_id: session.tenant_id || undefined,
    region: session.region?.trim().toUpperCase() || undefined,
    auth_source: 'cowork',
    updated_at: session.ts || Date.now()
  }
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()])
  return {
    version: 2,
    realm: 'crms',
    algorithm: 'aes-256-gcm',
    key_storage: 'local-file-v2',
    iv: iv.toString('base64'),
    auth_tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64')
  }
}

export const ensureMicromeetCliIntegration = (): void => {
  try {
    ensurePrivateDir(MICROMEET_DIR)
    ensurePrivateDir(CREDENTIAL_DIR)
    const cliPath = bundledMicromeetCliPath()
    const toolsDir = dirname(cliPath)
    if (existsSync(cliPath) && process.platform !== 'win32') chmodSync(cliPath, 0o755)
    if (existsSync(cliPath)) writeShim(cliPath)
    else console.warn('[micromeet cli] bundled CLI not found:', cliPath)
    prependPath(MICROMEET_BIN_DIR)
    prependPath(toolsDir)
    if (!process.env.MICROMEET_CRMS_CREDENTIAL_FILE) {
      process.env.MICROMEET_CRMS_CREDENTIAL_FILE = CRMS_CREDENTIAL_FILE
    }
    rmSync(LEGACY_SESSION_FILE, { force: true })
    console.log('[micromeet cli] initialized', {
      cliPath,
      shimDir: MICROMEET_BIN_DIR,
      credentialFile: CRMS_CREDENTIAL_FILE,
      cliExists: existsSync(cliPath)
    })
  } catch (err) {
    console.warn('[micromeet cli] init failed:', err)
  }
}

export const writeMicromeetCliCredential = (session: AuthSession | null): boolean => {
  const tempFile = `${CRMS_CREDENTIAL_FILE}.tmp-${process.pid}`
  try {
    ensurePrivateDir(MICROMEET_DIR)
    ensurePrivateDir(CREDENTIAL_DIR)
    rmSync(LEGACY_SESSION_FILE, { force: true })
    if (!session?.jwt_token) {
      rmSync(CRMS_CREDENTIAL_FILE, { force: true })
      console.log('[micromeet cli] CRMS credential cleared')
      return true
    }
    const envelope = encryptCrmsCredential(session, getOrCreateCredentialKey())
    writeFileSync(tempFile, `${JSON.stringify(envelope, null, 2)}\n`, { mode: 0o600 })
    if (process.platform !== 'win32') chmodSync(tempFile, 0o600)
    renameSync(tempFile, CRMS_CREDENTIAL_FILE)
    if (process.platform !== 'win32') chmodSync(CRMS_CREDENTIAL_FILE, 0o600)
    console.log('[micromeet cli] encrypted CRMS credential synced')
    return true
  } catch (err) {
    console.warn('[micromeet cli] CRMS credential sync failed:', err)
    return false
  } finally {
    rmSync(tempFile, { force: true })
  }
}
