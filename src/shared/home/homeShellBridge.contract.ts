export interface HomeShellSessionSummary {
  email: string
}

export interface HomeShellCommandAck {
  ok: true
}

export interface HomeShellBridgeApi {
  getSessionSummary(): Promise<HomeShellSessionSummary>
  openTodo(): Promise<HomeShellCommandAck>
  prepareLogout(): Promise<HomeShellCommandAck>
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

export const parseHomeShellSessionSummary = (value: unknown): HomeShellSessionSummary => {
  if (!isRecord(value) || Object.keys(value).length !== 1 || typeof value.email !== 'string') {
    throw new Error('Home shell returned an invalid session summary')
  }
  return { email: value.email }
}

export const parseHomeShellCommandAck = (value: unknown): HomeShellCommandAck => {
  if (!isRecord(value) || Object.keys(value).length !== 1 || value.ok !== true) {
    throw new Error('Home shell command was not acknowledged')
  }
  return { ok: true }
}
