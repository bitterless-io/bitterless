import { createWorkflow, createStep } from '@kimchi-dev/kimchi-workflows/flow'
import { Type } from 'typebox'
import { createAgentTask, type AgentOutcome } from '../author'
import { ResearchPlanSchema, ResearchLaneResultSchema, ResearchVerificationSchema, ResearchReportSchema, type ResearchPlan, type ResearchLaneResult, type ResearchLane, type ResearchClaimCandidate, type ResearchVerification, type ResearchReport } from './research-contract'
import { normalizeResearchLanes, sanitizeLaneResults, buildClaimCandidates, sanitizeVerification, unavailableVerification, sanitizeResearchReport, fallbackResearchReport } from './research-evidence'
const tools = ['web_search', 'web_fetch']
const gather = createWorkflow({ name: 'gather-body' }).then(createAgentTask({ name: 'gather-lane', label: '检索直接来源', output: ResearchLaneResultSchema, tools, thinkingLevel: 'low', prompt: ({ ctx }) => {
  const lane = ctx.scope('gather')?.input as ResearchLane
  const plan = ctx.getStepResult<ResearchPlan>('plan-ready')!
  return `Research one bounded lane using web_search/web_fetch.\nQuestion and constraints: ${ctx.getInitData<string>()}\nScope constraints: ${plan.scopeConstraints.join('; ')}\nLane: ${JSON.stringify(lane)}\nOpen supporting pages, never cite search-results pages. Prefer primary authoritative sources, independent evidence and credible counterevidence. Return concrete claims, importance, supports/conflicts, a short passage or precise paraphrase, exact page title and direct URL. State gaps. Never invent URLs or claims unsupported by opened pages. No downloads, code execution or file edits.`
} })).commit()
const verify = createWorkflow({ name: 'verify-body' })
  .then(createAgentTask({ name: 'verify-claim', label: '独立核验引用', output: ResearchVerificationSchema, tools, thinkingLevel: 'medium', prompt: ({ ctx }) => `Independently verify this research claim.\nQuestion: ${ctx.getInitData<string>()}\nCandidate and gather-stage evidence (context, not proof): ${JSON.stringify(ctx.scope('verify')?.input)}\nSearch independently, open direct pages, prefer primary authoritative sources and actively seek counterevidence. Return SUPPORTED only with direct support; CONFLICTED for credible disagreement; UNCERTAIN for insufficient evidence; INFERENCE for a reasoned conclusion; REJECTED if refuted. Include exact titles/direct HTTP(S) URLs; never search-result URLs. No file edits.` }))
  .then(createStep({ name: 'verified-claim', input: Type.Unknown(), run: ({ input, ctx }) => {
    const candidate = ctx.scope('verify')?.input as ResearchClaimCandidate
    const outcome = input as AgentOutcome<ResearchVerification>
    return { outcome, verification: outcome.status === 'completed' ? sanitizeVerification(outcome.output, candidate) : unavailableVerification(candidate) }
  } })).commit()
export default createWorkflow({ name: 'research', description: 'Bounded external research with direct-page evidence, independent claim verification and citation-bound synthesis.', input: Type.String(), maxConcurrency: 4 })
  .then(createAgentTask({ name: 'plan', label: '拆分研究问题', output: ResearchPlanSchema, tools, thinkingLevel: 'medium', prompt: ({ ctx }) => `Plan bounded, source-grounded research.\nQuestion and constraints (verbatim): ${ctx.getInitData<string>()}\nCreate at most 4 non-overlapping lanes, each with stable short id, title, objective and 1–4 concrete search queries. Separate primary discovery, current status, counterevidence or jurisdiction/timeframe only when relevant. Never claim exhaustive coverage. No file edits.` }))
  .then(createStep({ name: 'plan-ready', run: ({ ctx }) => {
    const result = ctx.getStepResult<AgentOutcome<ResearchPlan>>('plan')
    if (!result || result.status !== 'completed') throw new Error('Research plan unavailable; dependent research was not started')
    return result.output
  } }))
  .foreach(gather, ctx => normalizeResearchLanes(ctx.getStepResult<ResearchPlan>('plan-ready')!), { name: 'gather', concurrency: 4 })
  .then(createStep({ name: 'claims', run: ({ ctx }) => {
    const outcomes = ctx.getStepResult<AgentOutcome<ResearchLaneResult>[]>('gather') ?? []
    return buildClaimCandidates(sanitizeLaneResults(outcomes.flatMap(result => result.status === 'completed' ? [result.output] : [])))
  } }))
  .foreach(verify, ctx => ctx.getStepResult<ResearchClaimCandidate[]>('claims') ?? [], { name: 'verify', concurrency: 4 })
  .then(createAgentTask({ name: 'synthesize', label: '综合已核验证据', output: ResearchReportSchema, tools: [], thinkingLevel: 'medium', prompt: ({ ctx }) => {
    const results = ctx.getStepResult<Array<{ verification: ResearchVerification }>>('verify') ?? []
    return `Answer the question using ONLY the independently verified handoff.\nQuestion: ${ctx.getInitData<string>()}\nVerified claims: ${JSON.stringify(results.map(item => item.verification).filter(item => item.verdict !== 'REJECTED'))}\nKeep SUPPORTED, CONFLICTED, UNCERTAIN and INFERENCE separate. Exclude REJECTED. Copy each claim string exactly; copy exact title/URL objects from verification. No new URL, no search-result citation, no inference recast as fact. Disclose limited coverage/gaps and useful next steps.`
  } }))
  .then(createStep({ name: 'report', run: ({ ctx }) => {
    const gathered = ctx.getStepResult<AgentOutcome<ResearchLaneResult>[]>('gather') ?? []
    const verified = ctx.getStepResult<Array<{ outcome: AgentOutcome<ResearchVerification>; verification: ResearchVerification }>>('verify') ?? []
    const synthesis = ctx.getStepResult<AgentOutcome<ResearchReport>>('synthesize')
    const handoff = verified.map(item => item.verification).filter(item => item.verdict !== 'REJECTED')
    const missing = [...gathered, ...verified.map(item => item.outcome), synthesis].filter(item => !item || item.status !== 'completed')
    const report = sanitizeResearchReport(synthesis?.status === 'completed' ? synthesis.output : fallbackResearchReport(handoff, 'Synthesis unavailable; only verified handoff retained.'), handoff)
    return { ...report, partial: missing.length > 0, missing }
  } })).commit()
