export interface SqliteKeyRequest {
  bootstrapToken: string
}

export interface SqliteKeyApi {
  getSqliteKey(params: SqliteKeyRequest): Promise<string>
}

export interface SqliteBootResult {
  ok: boolean
  error?: string
}

export interface SqliteBootApi {
  ready(): Promise<SqliteBootResult>
}
