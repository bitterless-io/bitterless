import { xpcMain } from 'electron-xpc/main'
import type {
  AgentActivityStep,
  AgentThinkingState,
  CodexDebugEvent
} from '@maestro-shared/coach.api'

const formatDebugDuration = (detail: unknown): string => {
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return ''
  const ms = Number((detail as { durationMs?: unknown }).durationMs)
  if (!Number.isFinite(ms) || ms < 0) return ''
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`
}

/** One step in the activity strip rendered above the active Maestro reply. */
export const broadcastAgentActivity = (
  phase: AgentActivityStep['phase'],
  label: string,
  ok = true
): void => {
  xpcMain.broadcast('coach/agent-activity', { phase, label, ok, ts: Date.now() })
}

/** Structured provider/runtime diagnostics for console and the Workbench log stream. */
export const broadcastCodexDebug = (event: CodexDebugEvent): void => {
  const duration = formatDebugDuration(event.detail)
  const prefix = `[coach:${event.scope}:${event.phase}${duration ? ` ${duration}` : ''}]`
  const detail = event.detail === undefined ? '' : event.detail
  if (event.level === 'error') console.error(prefix, event.message, detail)
  else if (event.level === 'warn') console.warn(prefix, event.message, detail)
  else console.log(prefix, event.message, detail)
  xpcMain.broadcast('coach/codex-log', event)
}

/** Streamed assistant text for one normalized Maestro session key. */
export const broadcastAgentStream = (sessionId: string, delta: string): void => {
  if (!delta) return
  xpcMain.broadcast('coach/agent-stream', { sessionId, delta, ts: Date.now() })
}

/** Provider thinking-state transitions for one normalized Maestro session key. */
export const broadcastAgentThinking = (
  sessionId: string,
  state: Omit<AgentThinkingState, 'sessionId'>
): void => {
  xpcMain.broadcast('coach/agent-thinking', {
    sessionId,
    active: state.active,
    ts: state.ts || Date.now()
  })
}
