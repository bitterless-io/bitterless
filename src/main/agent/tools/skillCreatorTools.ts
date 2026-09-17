import { lstatSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { AgentToolSpec } from '../runtime/agentRuntime.types'
import { checkSkill, initializeSkill } from '../../maestro/skills/skillCreator'

interface SkillCreatorHost {
  workspace(): string | undefined
  sharedRoot(): string
  libraryRoot(): string
  changed(): void
}
const inside = (root: string, file: string): boolean => file === root || file.startsWith(root + sep)
const canonical = (file: string): string => {
  let ancestor = resolve(file)
  for (;;) {
    try { lstatSync(ancestor); break }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || dirname(ancestor) === ancestor) throw error
      ancestor = dirname(ancestor)
    }
  }
  return resolve(realpathSync(ancestor), relative(ancestor, resolve(file)))
}

export const buildSkillCreatorTools = (host: SkillCreatorHost): AgentToolSpec[] => [{
  name: 'skill_creator',
  description: 'Create a reusable standard SKILL.md package with action=init, then fill its TODOs with existing file tools and call action=check for fast Pi format validation. ' +
    'Use the selected Chat workspace, otherwise profile Shared; no institution destination or implicit overwrite. Ask only essential missing task details. ' +
    'Instruction template creates SKILL.md only; script template adds scripts/run.mjs. Optional frontmatter entry/resources declare relative files to check. ' +
    'Choose representative input and an expected observable outcome; use existing tools for behavior checks only when appropriate and authorized. ' +
    'Report generated, formatChecked and behaviorVerified separately. This tool never runs scripts; behaviorVerified remains false until a separately observed run. ' +
    'check is read-only; edited content enters the catalog after Skills Refresh or a new Chat.',
  params: [
    { name: 'action', required: true, description: 'init or check.' },
    { name: 'name', required: false, description: 'init: lowercase skill name (letters, digits, hyphens).' },
    { name: 'description', required: false, description: 'init: what the skill does and when it should be used.' },
    { name: 'template', required: false, description: 'init: instruction (default) or script; create only needed resources.' },
    { name: 'path', required: false, description: 'check: package directory, absolute or relative to the current authoring root.' }
  ],
  execute: async args => {
    try {
      const workspace = host.workspace(), shared = resolve(host.sharedRoot()), library = canonical(host.libraryRoot())
      const root = workspace ? join(resolve(workspace), '.agents', 'skills') : shared
      const actualRoot = canonical(root), actualShared = canonical(shared)
      if (!inside(library, actualShared) || (workspace && !inside(canonical(workspace), actualRoot))) throw new Error('Skill authoring root escapes its configured workspace or Shared storage')
      const checkPath = (path: string): void => {
        const actual = canonical(path)
        if (!inside(actualRoot, actual)) throw new Error('Skill creator only accesses the current authoring root')
        if ((inside(library, actual) && !inside(actualShared, actual)) || inside(join(actualShared, 'cloud'), actual)) throw new Error('Institution and cloud-managed skill packages are read-only for the creator')
      }
      checkPath(root)
      if (args.action === 'init') {
        checkPath(resolve(root, String(args.name ?? '')))
        const result = initializeSkill({ root, name: String(args.name ?? ''), description: String(args.description ?? ''), template: String(args.template ?? 'instruction') as 'instruction' | 'script' })
        host.changed()
        return JSON.stringify(result)
      }
      if (args.action !== 'check' || !String(args.path ?? '').trim()) throw new Error('Use action=init with name/description, or action=check with a package path')
      const path = isAbsolute(String(args.path)) ? resolve(String(args.path)) : resolve(root, String(args.path))
      checkPath(path)
      return JSON.stringify(checkSkill(path))
    } catch (error) {
      return JSON.stringify({ ok: false, generated: false, formatChecked: false, behaviorVerified: false, diagnostics: [(error as Error).message] })
    }
  }
}]
