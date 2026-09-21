import {
  generateAdversarialReviewWorkflow,
  generateCodeReviewWorkflow,
  generateDeepResearchWorkflow
} from '@quintinshaw/pi-dynamic-workflows'
import type { WorkflowBuiltinName } from '../../../shared/agentWorkflow.api'
import { planWorkflowScript } from './dynamic/planScript'

/**
 * The built-in workflows, as scripts.
 *
 * They used to be hand-written Kimchi definitions in `./workflows/`. The package ships generators for
 * the same shapes — multi-angle review, adversarial verification, multi-perspective synthesis,
 * source-checked research, parallel audit — maintained alongside the engine that runs them. Keeping
 * our own versions would mean re-deriving those patterns on every engine change, and ours would be
 * the ones that quietly rot.
 *
 * `agent-task` stays ours because it is not a pattern: it is the one-shot "do this one thing in the
 * background" entry the chat's own `workflow_add_task` tool needs, and no library ships that.
 */
const AGENT_TASK = `export const meta = {
  name: 'agent_task',
  description: 'One independent Agent task, run in the background, reporting back into this chat.',
  phases: [{ title: 'Work' }],
}

phase('Work')
// A single agent. The point of this builtin is the background boundary, not a fan-out — the chat
// already has the conversation, this just moves one task off the turn.
return await agent(String(args ?? '').trim() || 'No task was given. Say so rather than inventing one.', { label: 'Task' })
`


/**
 * Make a generated builtin accept this host's input shape.
 *
 * The package's generators assume Pi's convention, where a workflow tool call carries an OBJECT of
 * named args — `generateCodeReviewWorkflow()` opens with `const rawDiff = (args && args.diff) || ''`.
 * This host's `workflow_run` passes the owner's sentence as `args`, a plain STRING, so `args.diff` is
 * always `undefined`. The run does not fail: the seven finders review an empty `<diff>` block and
 * report nothing, which reads exactly like clean code. Ral hit this on 2026-09-21.
 *
 * Rewriting the one line the generator emits, rather than forking the script: the rest of it is the
 * package's to maintain, and a fork would stop tracking their changes. If the line ever moves, the
 * assertion below fails loudly instead of silently shipping the broken contract again.
 */
const acceptStringArgs = (script: string, field: string): string => {
  const original = `const raw${field[0].toUpperCase()}${field.slice(1)} = (args && args.${field}) || ''`
  if (!script.includes(original)) {
    throw new Error(`The generator no longer opens with \`${original}\` — re-check how it reads args before shipping it.`)
  }
  return script.replace(original, `const raw${field[0].toUpperCase()}${field.slice(1)} = (typeof args === 'string' ? args : (args && args.${field})) || ''`)
}

/**
 * Only the generators that read their inputs from `args`.
 *
 * `generateCodebaseAuditWorkflow(scope, checks)` and `generateMultiPerspectiveWorkflow(topic,
 * perspectives)` interpolate a caller-supplied LIST into the script source. The chat hands a
 * workflow one free-text string, so using them here would mean inventing that list — audit checks or
 * review perspectives nobody asked for, presented as if the package had specified them. They stay
 * out until there is a real input for that second argument.
 */
const builtins: Record<string, () => string> = {
  'agent-task': () => AGENT_TASK,
  // Ours too, and NOT retired with Kimchi: what it produces is markdown, which belongs to no engine.
  // Its old wrapper was one structured-output agent plus a formatting step — one `agent({ schema })`
  // call and a `return` here. See `dynamic/planScript.ts`.
  'plan-workflow': planWorkflowScript,
  'code-review': () => acceptStringArgs(generateCodeReviewWorkflow(), 'diff'),
  research: generateDeepResearchWorkflow,
  'adversarial-review': generateAdversarialReviewWorkflow
}

/**
 * Names the retired engine had that this one does not.
 *
 * Mapped rather than dropped: a chat mid-conversation may still say `refactor-scout`, and answering
 * "unknown workflow" would read as the feature breaking. Each points at the shipped workflow whose
 * job actually covers it.
 */
const RETIRED: Record<string, string> = {
  'refactor-scout': 'code-review',
  'perf-review': 'code-review',
  diagnose: 'adversarial-review'
}
/** Retired with nothing that does their job. Named as gone rather than pointed somewhere else. */
const GONE: Record<string, string> = {
  'mini-demo': 'mini-demo demonstrated the previous engine. Run `research` or `code-review` on something real instead.',
  demo: 'demo demonstrated the previous engine. Run `research` or `code-review` on something real instead.',
}

export function builtinWorkflow(name: string): string {
  const generate = builtins[name] ?? builtins[RETIRED[name] ?? '']
  if (generate) return generate()
  if (GONE[name]) throw new Error(GONE[name])
  throw new Error(`Unknown workflow: ${name}. Available: ${Object.keys(builtins).join(', ')}`)
}

export const BUILTIN_NAMES = Object.keys(builtins) as WorkflowBuiltinName[]

/**
 * Builtins that must run without write or execute tools.
 *
 * `plan-workflow` states in its own description that it "creates and runs nothing". That has to be
 * enforced, not merely promised: the retired engine pinned the design Agent to `read/grep/find/ls`,
 * and the port to a script lost that restriction because this engine has no per-agent tool list.
 * Read-only is a property of the whole run here — nothing in a planning run should write.
 */
const READONLY: ReadonlySet<string> = new Set(['plan-workflow'])

/** True when this builtin's run must get the read-only toolset. */
export const builtinIsReadOnly = (name: string): boolean => READONLY.has(RETIRED[name] ?? name)
