import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs'
import { randomBytes } from 'crypto'
import { homedir } from 'os'
import { dirname, join, resolve, sep } from 'path'
import { decryptCredentialEnvelope, encryptCredentialPayload } from './credentialCrypto'
import { CliError } from './errors'
import type { AuthRealm, CredentialEnvelope, CredentialPayload } from './types'

export const defaultMicromeetDir = (): string => join(homedir(), '.micromeet')

export const defaultCredentialFile = (realm: AuthRealm): string =>
  join(defaultMicromeetDir(), 'credentials', `${realm}.json`)

export const credentialKeyFile = (credentialFile: string): string =>
  join(dirname(credentialFile), '.credential-key-v2')

const ensurePrivateDir = (dir: string): void => {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  if (process.platform !== 'win32') chmodSync(dir, 0o700)
}

export const readCredentialEnvelope = (file: string): CredentialEnvelope | null => {
  if (!existsSync(file)) return null
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as CredentialEnvelope
  } catch (err) {
    throw new CliError(`Failed to read credential file ${file}: ${(err as Error).message}`)
  }
}

const readCredentialKey = (file: string): Buffer => {
  const keyFile = credentialKeyFile(file)
  if (!existsSync(keyFile)) throw new CliError(`Credential key file is missing for ${file}`)
  const key = readFileSync(keyFile)
  if (key.length !== 32) throw new CliError(`Credential key file is invalid for ${file}`)
  if (process.platform !== 'win32') chmodSync(keyFile, 0o600)
  return key
}

const getOrCreateCredentialKey = (file: string): Buffer => {
  const keyFile = credentialKeyFile(file)
  if (existsSync(keyFile)) return readCredentialKey(file)
  const key = randomBytes(32)
  try {
    writeFileSync(keyFile, key, { flag: 'wx', mode: 0o600 })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
    return readCredentialKey(file)
  }
  if (process.platform !== 'win32') chmodSync(keyFile, 0o600)
  return key
}

export const loadCredential = (file: string, realm: AuthRealm): CredentialPayload | null => {
  const envelope = readCredentialEnvelope(file)
  if (!envelope) return null
  if (envelope.realm !== realm) {
    throw new CliError(`Credential file ${file} belongs to ${envelope.realm}, not ${realm}`)
  }
  return decryptCredentialEnvelope(envelope, readCredentialKey(file))
}

export const saveCredential = (file: string, payload: CredentialPayload): void => {
  const dir = dirname(file)
  const root = resolve(defaultMicromeetDir())
  const target = resolve(file)
  if (target.startsWith(`${root}${sep}`)) ensurePrivateDir(root)
  ensurePrivateDir(dir)
  const key = getOrCreateCredentialKey(file)
  const tempFile = `${file}.tmp-${process.pid}`
  try {
    writeFileSync(tempFile, `${JSON.stringify(encryptCredentialPayload(payload, key), null, 2)}\n`, { mode: 0o600 })
    if (process.platform !== 'win32') chmodSync(tempFile, 0o600)
    renameSync(tempFile, file)
    if (process.platform !== 'win32') chmodSync(file, 0o600)
  } finally {
    rmSync(tempFile, { force: true })
  }
}

export const removeCredential = (file: string): boolean => {
  const existed = existsSync(file)
  rmSync(file, { force: true })
  return existed
}
