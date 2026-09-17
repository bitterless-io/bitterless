import { createHash } from 'node:crypto'
import { lstatSync, realpathSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import type { AgentToolSpec } from '../runtime/agentRuntime.types'
import { parseSkillInstallInput, SkillInstaller, SkillInstallError } from '../../maestro/skills/skillInstaller'
import type { SkillInstallerOptions, SkillSourceInput } from '../../maestro/skills/skillInstaller'
import { createGitSourceFetcher } from '../../maestro/skills/skillInstallerGit'

export interface SkillInstallHost {
  workspace(): string | undefined
  sharedRoot(): string
  libraryRoot(): string
  stateRoot(): string
  identity(): string
  changed(): void
  fetch?: SkillInstallerOptions['fetch']
  git?: SkillInstallerOptions['git']
}
const inside = (root: string, file: string) => file === root || file.startsWith(root + sep)
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

export const buildSkillInstallTools = (host: SkillInstallHost): AgentToolSpec[] => [{
  name: 'skill_install',
  description: 'Manage standard skill sources without executing source CLIs: inspect GitHub HTTPS archives, npm:name@version tarballs or general HTTPS Git; install selected candidates; list, update or remove ledger-owned installations. ' +
    'Known npx/bunx/yarn dlx skills add commands are parsed as installation intent, never executed. Use inspect first to see resolved source/version and candidate paths; pass those paths in skills_json to disambiguate. ' +
    'Default destination is this Chat’s selected workspace/.agents/skills, otherwise profile Shared. --global or scope=shared chooses Shared; repeat returned scope with inspection/installation IDs. ' +
    'Updates/removals preserve local modifications by refusing the operation. Files/resources are retained; only selected SKILL.md entries activate. No lifecycle scripts, dependency installation, global runtime or PATH changes. ' +
    'Mutations follow configured host approval policy; installation does not verify behavior. Missing/private source access is reported, never replaced with account credentials.',
  params: [
    { name: 'action', required: true, description: 'inspect, install, list, update or remove' },
    { name: 'input', description: 'Source or known skills add command. inspect, or install without inspection_id.' },
    { name: 'request_json', description: 'Alternative JSON object {source,ref?,path?,skills?}.' },
    { name: 'inspection_id', description: 'ID returned by inspect.' },
    { name: 'installation_id', description: 'Ledger ID returned by install/list.' },
    { name: 'skills_json', description: 'JSON array of source-relative candidate directory paths.' },
    { name: 'scope', description: 'workspace or shared; defaults to selected workspace, otherwise shared.' }
  ],
  deferConfirmation: true,
  timeoutMs: 180_000,
  timeoutHint: 'Source retrieval timed out; retry inspect with a smaller package or reachable HTTPS source.',
  execute: async (args, signal, context) => {
    signal?.throwIfAborted()
    const input = args.request_json ? JSON.parse(String(args.request_json)) as SkillSourceInput : args.input ? String(args.input) : undefined
    const parsed = input ? parseSkillInstallInput(input) : undefined
    if (args.scope && args.scope !== 'shared' && args.scope !== 'workspace') throw new Error('Use scope=workspace or shared')
    const workspace = host.workspace(), identity = host.identity()
    const scope = parsed?.requestedScope || (args.scope as 'shared' | 'workspace' | undefined) || (workspace ? 'workspace' : 'shared')
    if (scope === 'workspace' && !workspace) throw new Error('Select a Chat workspace first, or use scope=shared')
    const shared = canonical(host.sharedRoot()), library = canonical(host.libraryRoot())
    const root = scope === 'workspace' ? join(resolve(workspace!), '.agents', 'skills') : resolve(host.sharedRoot())
    const actualRoot = canonical(root)
    if (!inside(library, shared) || (scope === 'workspace' && !inside(canonical(workspace!), actualRoot)) ||
      (inside(library, actualRoot) && !inside(shared, actualRoot)) || inside(join(shared, 'cloud'), actualRoot)) {
      throw new Error('Skill installation root escapes its workspace or Shared storage; institution/cloud packages are read-only')
    }
    const guard = () => {
      signal?.throwIfAborted()
      if (host.workspace() !== workspace || host.identity() !== identity || canonical(root) !== actualRoot) throw new SkillInstallError('scope-changed', 'Skill installation context changed; inspect again in the current Chat')
    }
    const installer = new SkillInstaller({ authoringRoot: root, stateRoot: join(host.stateRoot(), createHash('sha256').update(actualRoot).digest('hex')), guard, fetch: host.fetch, git: host.git || createGitSourceFetcher() })
    const approve = async (details: Record<string, unknown>) => {
      guard()
      const allowed = context?.confirm ? await context.confirm({ action: args.action, scope, authoringRoot: root, ...details }) : true
      guard()
      if (!allowed) throw new Error('Skill installation mutation was denied by the operator')
      return true
    }
    const result = (value: Record<string, unknown>) => { guard(); return JSON.stringify({ ok: true, scope, authoringRoot: root, ...value }) }
    switch (args.action) {
      case 'list': return result({ installations: await installer.list() })
      case 'inspect': {
        if (!input) throw new Error('inspect requires input or request_json')
        return result({ inspection: await installer.inspect(input, { signal }) })
      }
      case 'install': {
        const inspection = args.inspection_id ? await installer.getInspection(String(args.inspection_id)) : input ? await installer.inspect(input, { signal }) : undefined
        if (!inspection) throw new Error('install requires inspection_id, input or request_json')
        if (inspection.listOnly) return result({ inspection })
        const skills: unknown = args.skills_json ? JSON.parse(String(args.skills_json)) : undefined
        if (skills !== undefined && (!Array.isArray(skills) || skills.some(value => typeof value !== 'string'))) throw new Error('skills_json must be a JSON array of candidate paths')
        const selectedSkills = skills as string[] | undefined || inspection.suggestedSkills
        if (!selectedSkills.length && inspection.candidates.length !== 1) throw new Error('Choose candidate paths from inspect using skills_json before installing')
        await approve({ source: inspection.source, candidates: inspection.candidates, selectedSkills: selectedSkills.length ? selectedSkills : [inspection.candidates[0].path] })
        const installation = await installer.install({ inspectionId: inspection.id, skills: skills as string[] | undefined, signal })
        host.changed()
        return result({ installation })
      }
      case 'update': {
        const installation = await installer.update(String(args.installation_id || ''), { signal, confirm: async (previous, next) => approve({ installationId: previous.id, destination: previous.destination, previousSource: previous.source, source: next.source, candidates: next.candidates }) })
        host.changed()
        return result({ installation })
      }
      case 'remove': {
        const previous = (await installer.list()).find(item => item.id === args.installation_id)
        if (!previous) throw new Error('Unknown installation in this skill scope')
        await approve({ installationId: previous.id, destination: previous.destination, source: previous.source })
        await installer.remove(previous.id, { signal })
        host.changed()
        return result({ removed: previous.id })
      }
      default: throw new Error('Use inspect, install, list, update or remove')
    }
  }
}]
