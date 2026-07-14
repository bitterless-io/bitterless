import { existsSync, readFileSync, rmSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { optionString } from './args'
import { defaultCredentialFile, loadCredential, saveCredential } from './credentialStore'
import { CliError } from './errors'
import type { AuthRealm, CredentialPayload, LegacySessionFile, ParsedArgv, RegionCode, RuntimeConfig } from './types'

const REGION_DEFAULTS: Record<RegionCode, string> = {
  SG: 'https://crms-api.micromeet.ai',
  HK: 'https://crms-api-hk.micromeet.ai',
  ID: 'https://crms-api-id.micromeet.ai'
}

const regionCodes: RegionCode[] = ['SG', 'HK', 'ID']

export const regionBaseUrl = (region: RegionCode): string => REGION_DEFAULTS[region]

export const parseRegionCode = (value: string | undefined, fallback: RegionCode = 'SG'): RegionCode => {
  const region = (value || fallback).trim().toUpperCase()
  if (!regionCodes.includes(region as RegionCode)) {
    throw new CliError(`Invalid region "${value}". Expected SG, HK, or ID.`)
  }
  return region as RegionCode
}

const defaultSessionFile = (): string => join(homedir(), '.micromeet', 'session.json')

const normalizeRegion = (value: string | undefined, source: string): { value: RegionCode; source: string } => {
  return { value: parseRegionCode(value), source }
}

const normalizeBaseUrl = (value: string): string => {
  const trimmed = value.trim().replace(/\/+$/, '')
  if (!trimmed) throw new CliError('API base URL cannot be empty')
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  return `https://${trimmed}`
}

const readSession = (path: string, realm: AuthRealm): { session: LegacySessionFile; exists: boolean } => {
  if (realm !== 'crms' || !existsSync(path)) return { session: {}, exists: false }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as LegacySessionFile
    return { session: parsed || {}, exists: true }
  } catch (err) {
    throw new CliError(`Failed to read legacy session file ${path}: ${(err as Error).message}`)
  }
}

const readCredential = (
  path: string,
  realm: AuthRealm
): { credential?: CredentialPayload; exists: boolean; error?: string } => {
  const exists = existsSync(path)
  if (!exists) return { exists }
  try {
    return { credential: loadCredential(path, realm) || undefined, exists }
  } catch (err) {
    return { exists, error: (err as Error).message }
  }
}

const pickString = (...values: Array<string | undefined>): string | undefined => {
  for (const value of values) {
    const trimmed = value?.trim()
    if (trimmed) return trimmed
  }
  return undefined
}

const realmEnvironment = (realm: AuthRealm, suffix: string): string | undefined =>
  process.env[`MICROMEET_${realm.toUpperCase()}_${suffix}`]

const jwtEmail = (token: string): string => {
  const payloadPart = token.split('.')[1]
  if (!payloadPart) throw new Error('JWT payload is missing')
  const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8')) as { email?: string }
  const email = payload.email?.trim().toLowerCase()
  if (!email || !email.includes('@')) throw new Error('JWT email claim is missing')
  return email
}

const migrateLegacySession = (
  credentialFile: string,
  sessionFile: string,
  session: LegacySessionFile
): CredentialPayload | undefined => {
  if (!session.jwt_token) return undefined
  const email = jwtEmail(session.jwt_token)
  const rawRegion = session.region?.trim().toUpperCase()
  const region = regionCodes.includes(rawRegion as RegionCode) ? (rawRegion as RegionCode) : undefined
  const payload: CredentialPayload = {
    realm: 'crms',
    email,
    token: session.jwt_token,
    workspace_id: session.tenant_id,
    region,
    api_base_url: session.api_base_url,
    updated_at: session.updated_at || session.ts || Date.now()
  }
  saveCredential(credentialFile, payload)
  rmSync(sessionFile, { force: true })
  return payload
}

export const resolveCommandRealm = (argv: ParsedArgv): AuthRealm =>
  argv.positionals[0] === 'sys' ? 'sys' : 'crms'

export const resolveConfig = (argv: ParsedArgv, realm: AuthRealm = resolveCommandRealm(argv)): RuntimeConfig => {
  const credentialFile =
    optionString(argv, 'credential-file') ||
    realmEnvironment(realm, 'CREDENTIAL_FILE') ||
    process.env.MICROMEET_CREDENTIAL_FILE ||
    defaultCredentialFile(realm)
  let credentialState = readCredential(credentialFile, realm)

  const sessionFile = optionString(argv, 'session-file') || process.env.MICROMEET_SESSION_FILE || defaultSessionFile()
  let { session, exists: sessionExists } = readSession(sessionFile, realm)
  if (realm === 'crms' && !credentialState.credential && !credentialState.error && session.jwt_token) {
    try {
      const migrated = migrateLegacySession(credentialFile, sessionFile, session)
      if (migrated) {
        credentialState = { credential: migrated, exists: true }
        session = {}
        sessionExists = false
      }
    } catch {
      // Legacy tokens without an email claim remain readable until the next explicit login.
    }
  } else if (realm === 'crms' && credentialState.credential && sessionExists) {
    rmSync(sessionFile, { force: true })
    session = {}
    sessionExists = false
  }
  const credential = credentialState.credential

  const cliRegion = optionString(argv, 'region')
  const realmRegion = realmEnvironment(realm, 'REGION')
  const envRegion = process.env.MICROMEET_REGION
  const credentialRegion = credential?.region
  const sessionRegion = session.region
  const regionSource = cliRegion
    ? 'cli'
    : realmRegion
      ? `env:${realm}`
      : envRegion
        ? 'env'
        : credentialRegion
          ? 'credential'
          : sessionRegion
            ? 'legacy-session'
            : 'default'
  const region = normalizeRegion(
    pickString(cliRegion, realmRegion, envRegion, credentialRegion, sessionRegion),
    regionSource
  )

  const cliBase = optionString(argv, 'base-url')
  const realmBase = realmEnvironment(realm, 'API_BASE_URL')
  const envBase = process.env.MICROMEET_API_BASE_URL
  const credentialBase = credential?.api_base_url
  const sessionBase = session.api_base_url
  const rawBaseUrl = pickString(cliBase, realmBase, envBase, credentialBase, sessionBase)
  const baseUrlSource = cliBase
    ? 'cli'
    : realmBase
      ? `env:${realm}`
      : envBase
        ? 'env'
        : credentialBase
          ? 'credential'
          : sessionBase
            ? 'legacy-session'
            : `region:${region.value}`
  const baseUrl = normalizeBaseUrl(rawBaseUrl || REGION_DEFAULTS[region.value])

  const cliToken = optionString(argv, 'token')
  const realmToken = realmEnvironment(realm, 'TOKEN')
  const envToken = process.env.MICROMEET_TOKEN
  const credentialToken = credential?.token
  const sessionToken = session.jwt_token
  const token = pickString(cliToken, realmToken, envToken, credentialToken, sessionToken)
  const tokenSource = cliToken
    ? 'cli'
    : realmToken
      ? `env:${realm}`
      : envToken
        ? 'env'
        : credentialToken
          ? 'credential'
          : sessionToken
            ? 'legacy-session'
            : 'missing'

  const cliWorkspaceId = optionString(argv, 'workspace-id')
  const realmWorkspaceId = realmEnvironment(realm, 'WORKSPACE_ID')
  const envWorkspaceId = process.env.MICROMEET_WORKSPACE_ID
  const credentialWorkspaceId = credential?.workspace_id
  const sessionWorkspaceId = session.tenant_id
  const workspaceId = pickString(
    cliWorkspaceId,
    realmWorkspaceId,
    envWorkspaceId,
    credentialWorkspaceId,
    sessionWorkspaceId
  )
  const workspaceIdSource = cliWorkspaceId
    ? 'cli'
    : realmWorkspaceId
      ? `env:${realm}`
      : envWorkspaceId
        ? 'env'
        : credentialWorkspaceId
          ? 'credential'
          : sessionWorkspaceId
            ? 'legacy-session'
            : 'missing'

  return {
    realm,
    baseUrl,
    baseUrlSource,
    region: region.value,
    regionSource: region.source,
    token,
    tokenSource,
    workspaceId,
    workspaceIdSource,
    email: credential?.email,
    emailSource: credential?.email ? 'credential' : 'missing',
    credentialAuthSource: credential?.auth_source,
    credentialFile,
    credentialFileExists: credentialState.exists,
    credentialError: credentialState.error,
    sessionFile,
    sessionFileExists: sessionExists,
    sessionUpdatedAt: session.updated_at || session.ts
  }
}

export const requireToken = (config: RuntimeConfig): string => {
  if (!config.token) {
    const credentialHint = config.credentialError ? ` Credential error: ${config.credentialError}` : ''
    throw new CliError(
      `No ${config.realm.toUpperCase()} token is available. Run micromeet ${config.realm} login or provide MICROMEET_${config.realm.toUpperCase()}_TOKEN.${credentialHint}`
    )
  }
  return config.token
}

export const redactToken = (token: string | undefined): string => {
  if (!token) return ''
  if (token.length <= 12) return `${token.slice(0, 2)}...${token.slice(-2)}`
  return `${token.slice(0, 8)}...${token.slice(-4)}`
}
