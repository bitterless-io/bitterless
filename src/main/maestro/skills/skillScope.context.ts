import { assetScope } from '@main/workflowLibrary/assetScope.service'
import type { SkillInstitutionContext, SkillScopeContext } from './skillScope.storage'
import type { SkillSummary } from '@maestro-shared/coach.api'

const current = (): SkillInstitutionContext | null => {
  const value = assetScope.current
  return value ? { accountScope: value.namespace, institutionId: String(value.institutionId), institutionName: value.institutionName, generation: value.generation } : null
}
export const skillScopeContext: SkillScopeContext = {
  current,
  authorize: async () => { await assetScope.revalidate(); return current() }
}
export const onSkillContextChanged = assetScope.subscribe

export const authorizeSkillReference = async (reference: string): Promise<SkillInstitutionContext | null> => {
  if (reference.startsWith('unassigned:')) throw new Error('Assign this skill a scope in Workbench first')
  if (!reference.startsWith('institution:')) return null
  const expected = skillScopeContext.current()
  if (!expected) throw new Error('Institution skill is unavailable in this account')
  const verified = await skillScopeContext.authorize()
  if (!verified || verified.accountScope !== expected.accountScope || verified.institutionId !== expected.institutionId || verified.generation !== expected.generation || !reference.startsWith(`institution:${verified.accountScope}:${verified.institutionId}:`)) throw new Error('Skill institution changed or access was revoked')
  return verified
}

export const assertSkillContext = (expected: SkillInstitutionContext | null): void => {
  if (!expected) return
  const current = skillScopeContext.current()
  if (!current || current.accountScope !== expected.accountScope || current.institutionId !== expected.institutionId || current.generation !== expected.generation) throw new Error('Skill institution changed during execution')
}

export const skillExecutionGuard = async (reference: string): Promise<() => Promise<void>> => {
  const expected = await authorizeSkillReference(reference)
  return async () => {
    assertSkillContext(expected)
    if (expected) await authorizeSkillReference(reference)
    assertSkillContext(expected)
  }
}

/** Pin an alias to its qualified source before any authorization or asynchronous work. */
export const resolveAuthorizedSkill = async (
  registry: { resolveSkill(reference: string, includeUnassigned?: boolean): SkillSummary | undefined },
  input: string,
  allowUnassigned = false
) => {
  const candidate = registry.resolveSkill(input, allowUnassigned)
  if (!candidate) throw new Error('Skill not found or unavailable in this workspace')
  const reference = candidate.reference || candidate.id
  const context = allowUnassigned && candidate.scope === 'unassigned' ? null : await authorizeSkillReference(reference)
  assertSkillContext(context)
  const skill = registry.resolveSkill(reference, allowUnassigned)
  if (!skill || skill.skillRevision !== candidate.skillRevision) throw new Error('Skill changed during authorization; retry the current catalog')
  const guard = async (): Promise<void> => {
    assertSkillContext(context)
    if (context) await authorizeSkillReference(reference)
    assertSkillContext(context)
  }
  return { skill, reference, context, guard }
}
