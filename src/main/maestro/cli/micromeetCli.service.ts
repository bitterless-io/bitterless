import { app } from 'electron'
import { createCipheriv, randomBytes } from 'crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { dirname } from 'path'
import type { AuthSession } from '@maestro-shared/session.api'
import {
  resolveMicromeetCliEnvironment,
  resolveMicromeetCliExecutablePath,
  resolveMicromeetCliPaths,
  runWithMicromeetCliEnvironment,
  type MicromeetCliEnvironment,
  type MicromeetCliPaths
} from '@maestro-main/cli/micromeetCliPath.service'

const runtimeMicromeetCliPaths = (): MicromeetCliPaths => {
  const releaseChannel = import.meta.env.VITE_RELEASE_CHANNEL
  return resolveMicromeetCliPaths({
    releaseChannel,
    appUserDataPath: app.getPath('userData'),
    homeDirectory: releaseChannel === 'preview' ? undefined : homedir(),
    platform: process.platform
  })
}

export const micromeetCliCredentialFile = (): string =>
  runtimeMicromeetCliPaths().crmsCredentialFile

export const bundledMicromeetCliPath = (
  paths: MicromeetCliPaths = runtimeMicromeetCliPaths()
): string =>
  resolveMicromeetCliExecutablePath({
    paths,
    inheritedCliPath: process.env.MICROMEET_CLI_PATH,
    packaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
    platform: process.platform
  })

export const micromeetCliChildEnvironment = (): MicromeetCliEnvironment => {
  const paths = runtimeMicromeetCliPaths()
  return resolveMicromeetCliEnvironment(paths, process.env, bundledMicromeetCliPath(paths))
}

const ensurePrivateDir = (dir: string): void => {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  if (process.platform !== 'win32') chmodSync(dir, 0o700)
}

const shellQuote = (value: string): string => `'${value.replace(/'/g, "'\\''")}'`

const writeShim = (cliPath: string, paths: MicromeetCliPaths): void => {
  ensurePrivateDir(paths.binDir)
  if (process.platform === 'win32') {
    writeFileSync(paths.shimFile, `@echo off\r\n"${cliPath}" %*\r\n`, { mode: 0o755 })
    return
  }
  writeFileSync(paths.shimFile, `#!/bin/sh\nexec ${shellQuote(cliPath)} "$@"\n`, { mode: 0o755 })
  chmodSync(paths.shimFile, 0o755)
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

const readCredentialKey = (paths: MicromeetCliPaths): Buffer => {
  const key = readFileSync(paths.credentialKeyFile)
  if (key.length !== 32) throw new Error('Micromeet CLI credential key file must contain exactly 32 bytes')
  if (process.platform !== 'win32') chmodSync(paths.credentialKeyFile, 0o600)
  return key
}

const getOrCreateCredentialKey = (paths: MicromeetCliPaths): Buffer => {
  if (existsSync(paths.credentialKeyFile)) return readCredentialKey(paths)
  const key = randomBytes(32)
  try {
    writeFileSync(paths.credentialKeyFile, key, { flag: 'wx', mode: 0o600 })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
    return readCredentialKey(paths)
  }
  if (process.platform !== 'win32') chmodSync(paths.credentialKeyFile, 0o600)
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
  const paths = runtimeMicromeetCliPaths()
  const cliPath = bundledMicromeetCliPath(paths)
  runWithMicromeetCliEnvironment(paths, process.env, cliPath, process.env, () => {
    ensurePrivateDir(paths.rootDir)
    ensurePrivateDir(paths.credentialDir)
    const toolsDir = dirname(cliPath)
    const cliExists = existsSync(cliPath)
    if (!cliExists && paths.previewIsolated) {
      throw new Error(`[micromeet cli] Preview bundled CLI not found: ${cliPath}`)
    }
    if (cliExists && process.platform !== 'win32') chmodSync(cliPath, 0o755)
    if (cliExists) writeShim(cliPath, paths)
    else console.warn('[micromeet cli] bundled CLI not found:', cliPath)
    prependPath(toolsDir)
    prependPath(paths.binDir)
    rmSync(paths.legacySessionFile, { force: true })
    console.log('[micromeet cli] initialized', {
      cliPath,
      shimDir: paths.binDir,
      crmsCredentialFile: paths.crmsCredentialFile,
      sysCredentialFile: paths.sysCredentialFile,
      sessionFile: paths.legacySessionFile,
      cliExists
    })
  })
}

export const writeMicromeetCliCredential = (session: AuthSession | null): boolean => {
  const paths = runtimeMicromeetCliPaths()
  const tempFile = `${paths.crmsCredentialFile}.tmp-${process.pid}`
  try {
    ensurePrivateDir(paths.rootDir)
    ensurePrivateDir(paths.credentialDir)
    rmSync(paths.legacySessionFile, { force: true })
    if (!session?.jwt_token) {
      rmSync(paths.crmsCredentialFile, { force: true })
      console.log('[micromeet cli] CRMS credential cleared')
      return true
    }
    const envelope = encryptCrmsCredential(session, getOrCreateCredentialKey(paths))
    writeFileSync(tempFile, `${JSON.stringify(envelope, null, 2)}\n`, { mode: 0o600 })
    if (process.platform !== 'win32') chmodSync(tempFile, 0o600)
    renameSync(tempFile, paths.crmsCredentialFile)
    if (process.platform !== 'win32') chmodSync(paths.crmsCredentialFile, 0o600)
    console.log('[micromeet cli] encrypted CRMS credential synced')
    return true
  } catch (err) {
    console.warn('[micromeet cli] CRMS credential sync failed:', err)
    return false
  } finally {
    rmSync(tempFile, { force: true })
  }
}
