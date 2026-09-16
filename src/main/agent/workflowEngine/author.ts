import { createAgentStep, type AgentStep, type CreateAgentStepOptions } from '@kimchi-dev/kimchi-workflows/flow'
import { Type, type Static, type TSchema } from 'typebox'
import type { ThinkingLevel } from '@earendil-works/pi-agent-core'

export { createWorkflow, createStep, createAgentStep } from '@kimchi-dev/kimchi-workflows/flow'
export { Type } from 'typebox'
export type { WorkflowDefinition, RunContext } from '@kimchi-dev/kimchi-workflows/flow'

export type AgentOutcome<T = unknown> =
  | { status: 'completed'; output: T }
  | { status: 'stopped'; error: string }
  | { status: 'failed'; error: string }

export interface DesktopAgentOptions {
  label?: string
  tools?: string[]
  thinkingLevel?: ThinkingLevel
  timeoutMs: number
  retries: number
}
export const DESKTOP_AGENT_KEY = 'x-desktop-agent'
export type CreateAgentTaskOptions<TInput extends TSchema | undefined, TOutput extends TSchema> =
  Pick<CreateAgentStepOptions<TInput, TOutput>, 'name' | 'description' | 'input' | 'prompt' | 'model' | 'maxOutputRepairs' | 'maxTokens'> & {
    output: TOutput
    label?: string
    tools?: string[]
    thinkingLevel?: ThinkingLevel
    timeoutMs?: number
    retries?: number
  }

/** Product agent step: manual stop is explicit data, while whole-run cancellation remains cancellation. */
export function createAgentTask<TInput extends TSchema | undefined = undefined, TOutput extends TSchema = TSchema>(options: CreateAgentTaskOptions<TInput, TOutput>): AgentStep {
  const { label, tools, thinkingLevel, timeoutMs = 600_000, retries = 1, output, ...step } = options
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('Agent timeoutMs must be positive')
  if (!Number.isInteger(retries) || retries < 0 || retries > 3) throw new Error('Agent retries must be an integer from 0 to 3')
  const outcome = Type.Union([
    Type.Object({ status: Type.Literal('completed'), output }),
    Type.Object({ status: Type.Literal('stopped'), error: Type.String() }),
    Type.Object({ status: Type.Literal('failed'), error: Type.String() })
  ])
  Object.assign(outcome, { [DESKTOP_AGENT_KEY]: { label, tools, thinkingLevel, timeoutMs, retries } satisfies DesktopAgentOptions })
  return createAgentStep({
    ...step, output: outcome,
    prompt: args => `${options.prompt(args)}\n\nCall workflow_submit_result with {result:{status:"completed",output:<your result>}}. Only the host may mark an Agent stopped or failed; never invent those statuses.`,
    // Retry/time budgets belong to the host, which waits for resource cleanup before retrying.
    retry: { maxRetry: 0 }
  })
}

export function desktopAgentOptions(schema: TSchema | undefined): DesktopAgentOptions | undefined {
  const value = (schema as (TSchema & { 'x-desktop-agent'?: DesktopAgentOptions }) | undefined)?.[DESKTOP_AGENT_KEY]
  if (!value) return undefined
  if (!Number.isFinite(value.timeoutMs) || value.timeoutMs <= 0 || !Number.isInteger(value.retries) || value.retries < 0 || value.retries > 3) throw new Error('Invalid desktop Agent options')
  return value
}

export function completedOutput<T extends TSchema>(outcome: AgentOutcome<Static<T>>, label = 'Agent'): Static<T> {
  if (outcome.status !== 'completed') throw new Error(`${label} did not complete: ${outcome.error}`)
  return outcome.output
}
