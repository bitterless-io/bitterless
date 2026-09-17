import { readFileSync } from 'node:fs'
import type { SkillRegistryService } from './skillRegistry.service'
import { resolveAuthorizedSkill } from './skillScope.context'

/** A picker selection is an exact current identity, never a same-name fallback. */
export const selectedSkillPrompt = async (registry: SkillRegistryService, reference?: string): Promise<string> => {
  if (!reference) return ''
  const candidate = registry.catalog().skills.find(skill => skill.reference === reference)
  if (!candidate || candidate.status !== 'ready' || candidate.scope === 'unassigned' || candidate.enabled === false) throw new Error('Selected skill is disabled or unavailable; choose it again from the current catalog')
  const { skill, guard } = await resolveAuthorizedSkill(registry, reference)
  let body: string
  try { body = readFileSync(skill.path, 'utf8') }
  catch { throw new Error('Selected skill was deleted or cannot be read; refresh the skill catalog') }
  await guard()
  return '\n\n[Explicitly selected skill]\n' + JSON.stringify({ reference: skill.reference, name: skill.name, source: skill.layer, path: skill.path }) +
    '\nThe user explicitly selected this exact skill, including when it is explicit-only. Follow its current instructions for this request; do not substitute a same-name source.\n' + body
}
