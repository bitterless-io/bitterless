import type { AgentRuntimeSessionOptions } from './agentRuntime.types'
import type { SteeringMode } from '../steering/steeringPolicy'

/** Host policy, explicitly applied instead of inheriting changing SDK defaults. */
export const RUNTIME_SESSION_POLICY = {
  steeringMode: 'one-at-a-time' as SteeringMode,
  autoCompaction: true
} as const

/** One-shot/no-host-tool sessions retain their existing no-builtin-tool boundary. */
export const resolveRuntimeToolPolicy = (options: Pick<AgentRuntimeSessionOptions, 'tools' | 'builtinTools'>): {
  builtinNames: string[]
  allowedToolNames: string[] | undefined
} => {
  const builtinNames = (options.builtinTools || []).filter(Boolean)
  const allowedToolNames = builtinNames.length > 0 && options.tools.length > 0
    ? [...new Set([...builtinNames, ...options.tools.map((spec) => spec.name)])]
    : undefined
  return { builtinNames, allowedToolNames }
}
