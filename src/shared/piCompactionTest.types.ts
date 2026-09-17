export interface AutoCompactionTestReport {
  phase: string
  phases: Array<{ phase: string; elapsedMs: number }>
  requests: number
  responseStatus?: number
  ok: boolean
  provider: string
  model: string
  summaryChars: number
  realContextWindow: number
  testContextWindow: number
  sourceBytes: number
  sourceBytesRead: number
  sourceTruncated: boolean
  reserveTokens: number
  keepRecentTokens: number
  thresholdTokens: number
  paddingChars: number
  tokensBefore: number
  tokensAfter?: number
  compactions: number
  reason?: string
  systemUnchanged: boolean
  contextChanged: boolean
  aborted?: boolean
  error?: string
}

