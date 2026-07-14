export type RegionCode = 'SG' | 'HK' | 'ID'
export type AuthRealm = 'crms' | 'sys'
export type CredentialAuthSource = 'cli' | 'cowork'

export interface LegacySessionFile {
  jwt_token?: string
  tenant_id?: string
  region?: string
  api_base_url?: string
  updated_at?: number
  ts?: number
}

export interface CredentialPayload {
  realm: AuthRealm
  email: string
  token: string
  workspace_id?: string
  region?: RegionCode
  api_base_url?: string
  account?: Record<string, unknown>
  auth_source?: CredentialAuthSource
  updated_at: number
}

export interface CredentialEnvelope {
  version: 2
  realm: AuthRealm
  algorithm: 'aes-256-gcm'
  key_storage: 'local-file-v2'
  iv: string
  auth_tag: string
  ciphertext: string
}

export interface ParsedArgv {
  positionals: string[]
  options: Record<string, string | boolean | string[]>
}

export interface RuntimeConfig {
  realm: AuthRealm
  baseUrl: string
  baseUrlSource: string
  region: RegionCode
  regionSource: string
  token?: string
  tokenSource: string
  workspaceId?: string
  workspaceIdSource: string
  email?: string
  emailSource: string
  credentialAuthSource?: CredentialAuthSource
  credentialFile: string
  credentialFileExists: boolean
  credentialError?: string
  sessionFile: string
  sessionFileExists: boolean
  sessionUpdatedAt?: number
}

export interface CommandContext {
  config: RuntimeConfig
  argv: ParsedArgv
}
