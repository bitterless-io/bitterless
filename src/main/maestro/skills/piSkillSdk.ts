/// <reference path="./piSkills.d.ts" />

// The main build bundles these pure SDK APIs through the narrow piSkillSdkPlugin bridge.
// Pi's package is ESM-only; session/model APIs keep their existing dynamic imports.
export { loadSkillsFromDir, formatSkillsForPrompt, parseFrontmatter, createSyntheticSourceInfo } from 'virtual:bitterless-pi-skills'
export type { Skill, LoadSkillsResult } from '@earendil-works/pi-coding-agent'
