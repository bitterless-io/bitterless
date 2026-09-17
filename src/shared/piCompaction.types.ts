export interface CompactionRetry {
  attempt: number
  maxAttempts: number
  delayMs: number
  error: string
}

export interface CompactionStatus {
  active: boolean
  retry?: CompactionRetry
  errorMessage?: string
  aborted?: boolean
}
