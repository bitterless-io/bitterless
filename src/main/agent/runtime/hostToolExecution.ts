import type { AgentToolSpec } from './agentRuntime.types'
import { sanitizeRuntimeError } from './errorSanitizer'

export type HostToolExecutionEvent =
  | { status: 'success'; durationMs: number; outputChars: number }
  | { status: 'error'; durationMs: number; error: string }

/** Execute the host tool once; providers only encode the returned observation. */
export const executeHostTool = async (
  tool: Pick<AgentToolSpec, 'execute'>,
  params: Record<string, unknown>,
  onResult?: (event: HostToolExecutionEvent) => void
): Promise<{ text: string; durationMs: number }> => {
  const startedAt = Date.now()
  try {
    const text = await tool.execute(params || {})
    const durationMs = Date.now() - startedAt
    onResult?.({ status: 'success', durationMs, outputChars: text.length })
    return { text, durationMs }
  } catch (err) {
    const durationMs = Date.now() - startedAt
    const error = sanitizeRuntimeError(err instanceof Error ? err.message : String(err), 'tool')
    onResult?.({ status: 'error', durationMs, error })
    throw new Error(error)
  }
}
