/**
 * The workflow planner, as a `@quintinshaw/pi-dynamic-workflows` script.
 *
 * Ral 2026-09-20:「继续将 bl cowork 向 pi 对齐 quintinshaw/pi-dynamic-workflows 的能力」.
 *
 * The planner was almost retired in the migration, on the reading that it "produces a proposal
 * rather than a run". That reading was wrong: what it produces is **markdown**, and markdown does
 * not belong to an engine. Only its old wrapper was Kimchi — one structured-output agent followed by
 * a formatting step, which is one `agent({ schema })` call and a `return` in this engine. Retiring it
 * would have dropped a working capability for a packaging reason.
 *
 * Standalone on purpose. The Kimchi original is left where it is, untouched, so retiring that
 * directory takes nothing here with it — and the schema is a plain JSON Schema object rather than a
 * TypeBox one, because that is what the engine's structured output actually wants and Cowork never
 * had TypeBox to begin with.
 */

const STEP_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'Short, user-facing name for this part of the workflow.' },
    purpose: { type: 'string', description: 'What this part accomplishes.' },
    receives: { type: 'array', items: { type: 'string' }, description: 'Information available to this part. Empty when it starts from project or ambient context.' },
    produces: { type: 'array', items: { type: 'string' }, description: 'Information made available to later parts. Empty when this part only performs an effect.' },
    delivers: { type: 'array', items: { type: 'string' }, description: 'User-visible results or observable effects delivered here, not necessarily at the end.' }
  },
  required: ['title', 'purpose', 'receives', 'produces', 'delivers'],
  additionalProperties: false
} as const

export const WORKFLOW_PLAN_SCHEMA = {
  type: 'object',
  properties: {
    goal: { type: 'string', description: 'The overall outcome the user wants.' },
    summary: { type: 'string', description: 'A short explanation of how the workflow achieves the goal.' },
    acceptanceCriteria: { type: 'array', items: { type: 'string' }, minItems: 1, description: 'Observable conditions that make the first version successful.' },
    decisions: { type: 'array', items: { type: 'string' }, description: 'Choices made without asking, each marked as inferred and stating what was assumed.' },
    openQuestions: { type: 'array', items: { type: 'string' }, description: 'Questions whose answers would change the plan, left for the user to correct.' },
    name: { type: 'string', description: 'Concise kebab-case name derived from the goal.' },
    steps: { type: 'array', items: STEP_SCHEMA, minItems: 1, description: 'The logical parts, in order.' }
  },
  required: ['goal', 'summary', 'acceptanceCriteria', 'decisions', 'openQuestions', 'name', 'steps'],
  additionalProperties: false
} as const

export interface WorkflowPlanStep {
  title: string
  purpose: string
  receives: string[]
  produces: string[]
  delivers: string[]
}

export interface WorkflowPlan {
  goal: string
  summary: string
  acceptanceCriteria: string[]
  decisions: string[]
  openQuestions: string[]
  name: string
  steps: WorkflowPlanStep[]
}

/**
 * Copied verbatim from Kimchi 0.0.9's private `host/builtin/`, minus the parts that only make sense
 * with an interviewer. Do not reword to taste: the ban on implementation detail is exactly what keeps
 * a plan reviewable by a human.
 */
export const WORKFLOW_DESIGN_PROMPT = [
  "Design the first useful version of a workflow from the user's goal.",
  '',
  'First inspect the available project context and infer anything obvious.',
  '',
  'You cannot ask the user anything: there is no interview step. Where a question would have',
  'materially changed the behaviour, acceptance criteria, information flow, or delivery of results',
  'and effects, make the smallest reasonable assumption, record it in decisions marked as inferred',
  'with what you assumed, and put the question itself in openQuestions. Never present an inference',
  'as something the user confirmed.',
  '',
  'Do not decide a file name, framework construct, schema, model, timeout, retry count, token',
  'budget, concurrency, maximum iteration count, or any other implementation choice; those are not',
  'part of a behavioural plan.',
  '',
  'Submit one concise behavioural plan:',
  '- convert the goal into observable acceptance criteria;',
  '- break the behaviour into logical steps and state what information each receives and makes available;',
  '- attach user-visible delivery or observable effects to whichever step performs them;',
  '- do not assume delivery happens at the final step, or that the workflow returns a final value; and',
  '- choose a concise kebab-case name derived from the goal.',
  '',
  'Keep it high-level. Do not encode implementation details or speculative operational constraints.',
  'Do not ask for approval yourself; the plan is presented to the user separately.'
].join('\n')

/**
 * Plan → markdown proposal.
 *
 * **Deliberately self-contained** — no imports, no module-scope helpers, no `this`. Its own source is
 * embedded into the generated script (see `planWorkflowScript`), so a reference to anything outside
 * itself would compile here and throw inside the run. Keep it that way; the guard test asserts it.
 */
export function renderWorkflowPlan(plan: WorkflowPlan): string {
  const list = (values: readonly string[], empty: string): string => (values.length ? values.join('; ') : empty)
  const steps = plan.steps.flatMap((step, index) => [
    `${index + 1}. **${step.title}** — ${step.purpose}`,
    `   - Receives: ${list(step.receives, 'nothing from an earlier step')}`,
    `   - Makes available: ${list(step.produces, 'no information for later steps')}`,
    ...(step.delivers.length ? [`   - Delivers here: ${step.delivers.join('; ')}`] : [])
  ])
  return [
    '# Proposed workflow',
    '',
    plan.goal,
    '',
    plan.summary,
    '',
    '## Acceptance criteria',
    '',
    ...plan.acceptanceCriteria.map(criterion => `- ${criterion}`),
    '',
    '## Flow',
    '',
    ...steps,
    ...(plan.decisions.length ? ['', '## Inferred decisions', '', ...plan.decisions.map(item => `- ${item}`)] : []),
    ...(plan.openQuestions.length
      ? ['', '## Worth correcting before this is built', '', ...plan.openQuestions.map(item => `- ${item}`)]
      : []),
    '',
    `Nothing has been created or run. Name this plan would use: \`${plan.name}\`.`
  ].join('\n')
}

/**
 * The script.
 *
 * The renderer is embedded as its own compiled source rather than re-typed as a string literal: a
 * second copy of that formatting would be free to drift from the one the tests pin, and the drift
 * would only show up in a proposal the owner is reading. `Function.prototype.toString()` keeps one
 * source of truth. Mangled identifiers under a production bundle are harmless because the function
 * references nothing but its own parameters and locals.
 *
 * Both the schema and the prompt go through `JSON.stringify` — the prompt is prose the owner's goal
 * is concatenated onto, and a stray backtick or `${` in it would otherwise end the template or
 * interpolate.
 */
export const planWorkflowScript = (): string => `export const meta = {
  name: 'plan_workflow',
  description: 'Turn a goal into a reviewable workflow plan. Produces a proposal only; it creates and runs nothing.',
  phases: [{ title: 'Design', detail: 'one agent turns the goal into a behavioural plan' }],
}

const PLAN_SCHEMA = ${JSON.stringify(WORKFLOW_PLAN_SCHEMA)}
const DESIGN_PROMPT = ${JSON.stringify(WORKFLOW_DESIGN_PROMPT)}
const render = ${renderWorkflowPlan.toString()}

phase('Design')
const goal = String(args ?? '').trim()
if (!goal) return 'No goal was given, so there is nothing to plan. Describe the outcome you want.'
// One agent, structured: the schema is what keeps the plan reviewable instead of loose prose, and the
// engine retries the agent itself when the output does not validate.
const plan = await agent(DESIGN_PROMPT + '\\n\\nGOAL: ' + goal, { label: 'Design', schema: PLAN_SCHEMA })
if (!plan) return 'Workflow planning did not complete, so there is no plan to show.'
return render(plan)
`
