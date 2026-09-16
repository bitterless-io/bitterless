import { createWorkflow, createStep, type WorkflowDefinition } from '@kimchi-dev/kimchi-workflows/flow'
import { Type, type TSchema, type Static } from 'typebox'
import { createAgentTask, type AgentOutcome } from '../author'
import { AdvisoryCandidatesSchema, AdvisoryReportSchema, AdvisoryVerdictSchema, type AdvisoryCandidate, type AdvisoryVerdict, type AdvisoryReport } from './advisory-schema'
export const READ_TOOLS = ['read', 'bash', 'grep', 'find', 'ls']
export const READ_ONLY = 'Advisory-only: do not edit files, install dependencies, commit, create/switch branches, upload data or post comments. Follow the exact user scope; do not expand it to parent directories. Run only safe inspection/diagnostic commands and commands explicitly requested by the user.'
export interface Lens { label: string; category: string; text: string }
interface ScopeReady { scope: Record<string, unknown>; context: string }
interface Verified { candidate: AdvisoryCandidate; outcome: AgentOutcome<AdvisoryVerdict> }
export interface AdvisoryOptions {
  name: string
  description: string
  scopeSchema: TSchema
  scopePrompt: string | (() => string)
  lenses: Lens[]
  perLens: number
  finderPrompt: string
  verifierPrompt: string
  synthesisPrompt: string
  prepare?: (scope: Record<string, unknown>, signal: AbortSignal) => Promise<ScopeReady>
  keep?: (candidate: AdvisoryCandidate, scope: ScopeReady) => boolean
}
export function makeAdvisoryWorkflow(options: AdvisoryOptions): WorkflowDefinition {
  const scope = createAgentTask({ name: 'scope', label: '界定范围', output: options.scopeSchema, tools: READ_TOOLS, thinkingLevel: 'medium',
    prompt: ({ ctx }) => `${typeof options.scopePrompt === 'function' ? options.scopePrompt() : options.scopePrompt}\n\nUser target and instructions (verbatim):\n${ctx.getInitData<string>() ?? ''}\n\n${READ_ONLY}` })
  const verifyBody = createWorkflow({ name: 'verify-body' })
    .then(createAgentTask({ name: 'verify-candidate', label: '独立核验', output: AdvisoryVerdictSchema, tools: READ_TOOLS, thinkingLevel: 'medium',
      prompt: ({ ctx }) => `## ${options.name} independent verifier\n${ctx.getStepResult<ScopeReady>('scope-ready')?.context}\nCandidate:\n${JSON.stringify(ctx.scope('verify')?.input)}\n${options.verifierPrompt}\nReturn CONFIRMED / PLAUSIBLE / REFUTED with actual quoted/cited evidence. ${READ_ONLY}` }))
    .then(createStep({ name: 'verified-item', input: Type.Unknown(), run: ({ input, ctx }) => ({ candidate: ctx.scope('verify')?.input, outcome: input }) })).commit()
  return createWorkflow({ name: options.name, description: options.description, input: Type.String(), maxConcurrency: 4 })
    .then(scope)
    .then(createStep({ name: 'scope-ready', run: async ({ ctx, abortSignal }) => {
      const result = ctx.getStepResult<AgentOutcome<Record<string, unknown>>>('scope')
      if (!result || result.status !== 'completed') throw new Error(`Scope unavailable: ${result?.status ?? 'missing'}; dependent investigation was not started`)
      const ready = options.prepare ? await options.prepare(result.output, abortSignal) : { scope: result.output, context: JSON.stringify(result.output) }
      return { ...ready, context: `${ready.context}\nUser constraints: ${ctx.getInitData<string>() ?? ''}` }
    } }))
    .parallel(options.lenses.map(lens => createAgentTask({ name: `find-${lens.label}`, label: `调查：${lens.label}`, output: AdvisoryCandidatesSchema, tools: READ_TOOLS, thinkingLevel: 'low',
      prompt: ({ ctx }) => `## ${options.name} finder — ${lens.label}\n${ctx.getStepResult<ScopeReady>('scope-ready')?.context}\nInvestigate ONLY this lens: ${lens.text}\n${options.finderPrompt}\nSurface up to ${options.perLens} candidates, category exactly "${lens.category}"; include summary, locations, concrete impact and optional recommendation. ${READ_ONLY}` })), { name: 'find' })
    .then(createStep({ name: 'candidates', run: ({ ctx }) => {
      const found = ctx.getStepResult<Record<string, AgentOutcome<Static<typeof AdvisoryCandidatesSchema>>>>('find') ?? {}
      const ready = ctx.getStepResult<ScopeReady>('scope-ready')!
      const seen = new Set<string>()
      return Object.values(found).flatMap(outcome => outcome.status === 'completed' ? outcome.output.candidates.slice(0, options.perLens) : []).filter(candidate => {
        const first = candidate.locations[0]
        const key = `${first?.file}:${first?.line ?? ''}:${candidate.summary.trim().toLowerCase()}`
        if (seen.has(key) || (options.keep && !options.keep(candidate, ready))) return false
        seen.add(key); return true
      }).slice(0, 24)
    } }))
    .foreach(verifyBody, ctx => ctx.getStepResult<AdvisoryCandidate[]>('candidates') ?? [], { name: 'verify', concurrency: 4 })
    .then(createAgentTask({ name: 'synthesize', label: '汇总已核验证据', output: AdvisoryReportSchema, tools: [], thinkingLevel: 'medium',
      prompt: ({ ctx }) => {
        const verified = ctx.getStepResult<Verified[]>('verify') ?? []
        const kept = verified.filter(item => item.outcome.status === 'completed' && item.outcome.output.verdict !== 'REFUTED')
        return `## Final ${options.name} advisory report\nIndependently verified handoff:\n${JSON.stringify(kept)}\nMissing/refuted results are excluded. ${options.synthesisPrompt}\nIf nothing survived, explicitly say no findings survived verification. Merge same-root-cause findings, rank by impact. Copy locations/evidence from the verified handoff; add no finding or evidence. Confidence high only for CONFIRMED; PLAUSIBLE is medium or low. Recommendations are advice, never automatic edits.`
      } }))
    .then(createStep({ name: 'report', run: ({ ctx }) => {
      const found = ctx.getStepResult<Record<string, AgentOutcome>>('find') ?? {}
      const verified = ctx.getStepResult<Verified[]>('verify') ?? []
      const synthesis = ctx.getStepResult<AgentOutcome<AdvisoryReport>>('synthesize')
      const kept = verified.filter((item): item is Verified & { outcome: { status: 'completed'; output: AdvisoryVerdict } } => item.outcome.status === 'completed' && item.outcome.output.verdict !== 'REFUTED')
      const missing: Array<{ name: string; status: string }> = [...Object.entries(found).filter(([, outcome]) => outcome.status !== 'completed').map(([name, outcome]) => ({ name, status: outcome.status })), ...verified.filter(item => item.outcome.status !== 'completed').map(item => ({ name: item.candidate.summary, status: item.outcome.status }))]
      if (!synthesis || synthesis.status !== 'completed') missing.push({ name: 'synthesize', status: synthesis?.status ?? 'missing' })
      // Evidence/locations/confidence are fixed by verification; synthesis may phrase and rank, never invent evidence.
      const report = synthesis?.status === 'completed' ? synthesis.output : { summary: 'Synthesis unavailable; inspect verified evidence.', findings: [], nextSteps: ['Inspect verified evidence or rerun.'] }
      const findings = kept.map(source => {
        const phrasing = report.findings.find(finding => finding.summary === source.candidate.summary)
        return { summary: source.candidate.summary, category: source.candidate.category, severity: phrasing?.severity ?? 'medium', confidence: source.outcome.output.verdict === 'CONFIRMED' ? 'high' : 'medium', locations: source.candidate.locations, evidence: source.outcome.output.evidence, impact: source.candidate.impact, recommendation: phrasing?.recommendation ?? source.candidate.recommendation ?? 'Validate this finding with the smallest scoped check before changing code.' }
      })
      return { ...report, findings, verified: kept, partial: missing.length > 0, missing, stats: { candidates: ctx.getStepResult<AdvisoryCandidate[]>('candidates')?.length ?? 0, verified: verified.filter(item => item.outcome.status === 'completed').length, kept: kept.length, refuted: verified.filter(item => item.outcome.status === 'completed' && item.outcome.output.verdict === 'REFUTED').length } }
    } })).commit()
}
