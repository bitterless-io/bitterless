import { createWorkflow, createStep } from '@kimchi-dev/kimchi-workflows/flow'
import { Type, type Static } from 'typebox'
import { createAgentTask, type AgentOutcome } from '../author'

/**
 * Plan a workflow from a goal, without writing or running anything.
 *
 * The contract below is Kimchi's own authoring contract, reproduced rather than imported: its
 * `workflowPlanSchema`, `renderWorkflowPlan` and `designPrompt` live in
 * `host/builtin/` and are NOT in the package's public exports map — only the whole
 * `createWorkflowWorkflow` is, and that workflow is built from interactive and questionnaire steps
 * which this desktop host rejects (see `validateWorkflow`). Reaching into the private module to
 * borrow three symbols would bind us to one patch release's internal file layout.
 *
 * So the schema field descriptions and the design instructions are copied verbatim from Kimchi
 * 0.0.9, minus the parts that only make sense with an interviewer. Keep them in sync by hand when
 * the pinned version changes; do not reword them to taste.
 */
const StepPlanSchema = Type.Object({
  title: Type.String({ description: 'Short, user-facing name for this part of the workflow.' }),
  purpose: Type.String({ description: 'What this part accomplishes.' }),
  receives: Type.Array(Type.String(), {
    description: 'Information available to this part. Empty when it starts from project or ambient context.'
  }),
  produces: Type.Array(Type.String(), {
    description: 'Information made available to later parts. Empty when this part only performs an effect.'
  }),
  delivers: Type.Array(Type.String(), {
    description: 'User-visible results or observable effects delivered here, not necessarily at the end.'
  })
})

export const WorkflowPlanSchema = Type.Object({
  goal: Type.String({ description: 'The overall outcome the user wants.' }),
  summary: Type.String({ description: 'A short explanation of how the workflow achieves the goal.' }),
  acceptanceCriteria: Type.Array(Type.String(), {
    minItems: 1,
    description: 'Observable conditions that make the first version successful.'
  }),
  decisions: Type.Array(Type.String(), {
    description: 'Behaviourally relevant choices. Without an interviewer every one of these is inferred, so each entry must say so and name what it assumed.'
  }),
  openQuestions: Type.Array(Type.String(), {
    description: 'Ambiguities a conversation would have resolved. These are what the user should correct before the plan is built.'
  }),
  name: Type.String({ description: "The concise kebab-case workflow name derived from the user's goal." }),
  steps: Type.Array(StepPlanSchema, { minItems: 1 })
})
export type WorkflowPlan = Static<typeof WorkflowPlanSchema>

/**
 * Kimchi's `designPrompt`, with the question-batching paragraphs replaced.
 *
 * Those paragraphs instruct the model to interview the user; there is no interviewer here, so the
 * same material has to surface as explicit inferences and open questions instead of being silently
 * decided. Everything else — including the ban on implementation detail — is kept word for word,
 * because that ban is exactly what keeps a plan reviewable by a human.
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

const list = (values: readonly string[], empty: string): string => (values.length ? values.join('; ') : empty)

/** Port of Kimchi's `renderWorkflowPlan`, plus the open questions its interactive version never needs. */
export function renderWorkflowPlan(plan: WorkflowPlan): string {
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

export default createWorkflow({
  name: 'plan-workflow',
  description: 'Turn a goal into a reviewable workflow plan. Produces a proposal only; it creates and runs nothing.',
  input: Type.String()
})
  .then(createAgentTask({
    name: 'design',
    label: '行为设计',
    input: Type.String(),
    output: WorkflowPlanSchema,
    tools: ['read', 'grep', 'find', 'ls'],
    retries: 0,
    prompt: ({ input }) => `${WORKFLOW_DESIGN_PROMPT}\n\nGOAL: ${input.trim()}`
  }))
  .then(createStep({
    name: 'proposal',
    run: ({ ctx }) => {
      const outcome = ctx.getStepResult<AgentOutcome<WorkflowPlan>>('design')
      // A stopped or failed design is not a plan; saying so beats rendering an empty proposal.
      if (!outcome || outcome.status !== 'completed') {
        throw new Error(`Workflow planning did not complete: ${outcome && 'error' in outcome ? outcome.error : 'no plan was produced'}`)
      }
      return renderWorkflowPlan(outcome.output)
    }
  }))
  .commit()
