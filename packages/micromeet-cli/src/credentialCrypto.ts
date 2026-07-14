import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'
import { CliError } from './errors'
import type { AuthRealm, CredentialEnvelope, CredentialPayload } from './types'

const ALGORITHM = 'aes-256-gcm'
const KEY_STORAGE = 'local-file-v2'
const KEY_BYTES = 32

export const normalizeCredentialEmail = (email: string): string => {
  const normalized = email.trim().toLowerCase()
  if (!normalized || !normalized.includes('@')) throw new CliError('A valid login email is required')
  return normalized
}

const assertCredentialKey = (key: Buffer): Buffer => {
  if (key.length !== KEY_BYTES) throw new CliError('Credential key file must contain exactly 32 bytes')
  return key
}

const additionalData = (realm: AuthRealm): Buffer => Buffer.from(`micromeet-credential:v2:${realm}`, 'utf8')

export const encryptCredentialPayload = (payload: CredentialPayload, key: Buffer): CredentialEnvelope => {
  const normalizedPayload = { ...payload, email: normalizeCredentialEmail(payload.email) }
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGORITHM, assertCredentialKey(key), iv)
  cipher.setAAD(additionalData(payload.realm))
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(normalizedPayload), 'utf8'), cipher.final()])

  return {
    version: 2,
    realm: payload.realm,
    algorithm: ALGORITHM,
    key_storage: KEY_STORAGE,
    iv: iv.toString('base64'),
    auth_tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64')
  }
}

export const decryptCredentialEnvelope = (envelope: CredentialEnvelope, key: Buffer): CredentialPayload => {
  if (envelope.version !== 2) throw new CliError(`Unsupported credential version: ${String(envelope.version)}`)
  if (envelope.algorithm !== ALGORITHM || envelope.key_storage !== KEY_STORAGE) {
    throw new CliError('Unsupported credential encryption format')
  }
  try {
    const decipher = createDecipheriv(ALGORITHM, assertCredentialKey(key), Buffer.from(envelope.iv, 'base64'))
    decipher.setAAD(additionalData(envelope.realm))
    decipher.setAuthTag(Buffer.from(envelope.auth_tag, 'base64'))
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
      decipher.final()
    ]).toString('utf8')
    const payload = JSON.parse(plaintext) as CredentialPayload
    if (payload.realm !== envelope.realm || !payload.token) {
      throw new CliError('Credential payload does not match its envelope')
    }
    payload.email = normalizeCredentialEmail(payload.email)
    return payload
  } catch (err) {
    if (err instanceof CliError) throw err
    throw new CliError('Credential decryption failed; the file, key, or authentication tag may be damaged')
  }
}
