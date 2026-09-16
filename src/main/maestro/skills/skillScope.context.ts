import { assetScope } from '@main/workflowLibrary/assetScope.service'
import type { SkillInstitutionContext, SkillScopeContext } from './skillScope.storage'

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
