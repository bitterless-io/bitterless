import { createSyntheticSourceInfo, type Skill } from './piSkillSdk'
import { dirname } from 'node:path'
import type { SkillSummary } from '@maestro-shared/coach.api'

/** Qualified refs remain host metadata; Pi receives the same complete, authorized package list. */
export const toPiSkills = (skills: SkillSummary[]): Skill[] => skills
  .filter(skill => skill.status !== 'error' && skill.scope !== 'unassigned' && skill.enabled !== false)
  .map(skill => ({
    name: skill.canonicalName || skill.name,
    description: skill.description,
    filePath: skill.path,
    baseDir: dirname(skill.path),
    sourceInfo: createSyntheticSourceInfo(skill.path, { source: skill.layer || 'global', baseDir: skill.root || dirname(skill.path), scope: skill.layer === 'workspace' ? 'project' : 'user' }),
    disableModelInvocation: skill.allowImplicitInvocation === false
  }))
