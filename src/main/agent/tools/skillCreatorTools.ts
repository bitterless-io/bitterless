import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { AgentToolSpec } from '../runtime/agentRuntime.types'
import { checkSkill, initializeSkill } from '../../maestro/skills/skillCreator'
import { runSkillScript, SKILL_SCRIPT_EXTENSIONS } from '../../maestro/skills/skillScriptRunner.service'
import { assertSkillContext, authorizeSkillReference } from '../../maestro/skills/skillScope.context'
import type { SkillSummary } from '@maestro-shared/coach.api'

interface SkillCreatorHost {
  workspace(): string | undefined
  sharedRoot(): string
  libraryRoot(): string
  changed(): void
  /** Current Chat's usable catalog — a script may only run from a package that is actually available. */
  skills(): SkillSummary[]
  /** Bundled Bun, staged with the app. Null in a checkout that never ran the runtime staging. */
  bunPath(): string | null
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

/**
 * 「SKILL.md 说要**跑**这个文件」,不是「提到过这个文件」。
 *
 * 只做子串匹配是不够的 —— talk_to_contacts 的 SKILL.md 里同样写着
 * `areas/contacts/contacts.index.md`(通讯录,一个 markdown 链接)。那是**资料**,不是入口。
 * 所以要求同一行里、路径**之前**出现解释器名:`node areas/contacts/feishu.mjs …` 命中,
 * 一个 markdown 链接不命中。扩展名那道闸拦得住 `.md`,但边界应该说清楚是「声明为可执行」,
 * 而不是靠后面某一道闸兜底。
 */
const SKILL_RUNNER = /\b(?:node|bun|deno|bash|sh|zsh|pwsh|powershell)\b/
const declaresRun = (text: string, declared: string): boolean => text.split(/\r?\n/).some(line => {
  const at = line.indexOf(declared)
  return at > 0 && SKILL_RUNNER.test(line.slice(0, at))
})

/**
 * The skill that *declares* this script — a package that does not contain the file, but whose
 * SKILL.md names it, verbatim, as the thing to run.
 *
 * Why this exists (Ral 2026-09-18:「cowork bl 能够有路径成功调用 talk_to_contacts 给我发消息，
 * 而不是重新写入脚本」): in real Agent Skills, SKILL.md is the manual and the engine often lives
 * elsewhere in the workspace, shared by several skills. `talk_to_contacts` says
 * `node areas/contacts/feishu.mjs …` twenty-two times, and that engine sits three levels outside
 * its package. Confining execution to the package made skills of that shape discoverable, readable
 * and unrunnable — the model's only way out was to write a forwarding script INTO the package,
 * which turns a read-only skill into one that is rewritten on every use.
 *
 * The boundary is re-anchored, not widened: still inside the selected workspace by realpath (a
 * symlink cannot walk out), and still only a path an AVAILABLE skill's SKILL.md spells out — a
 * declaration committed in the repository, auditable, not something the model asserts at call time.
 * Availability, institution authorization, the timeout and the output cap are unchanged.
 */
const declaringSkill = (skills: SkillSummary[], workspace: string | undefined, file: string): SkillSummary | undefined => {
  if (!workspace) return undefined
  const root = resolve(workspace)
  if (!inside(canonical(root), canonical(file))) return undefined
  const declared = relative(root, file).split(sep).join('/')
  if (!declared || declared.startsWith('..')) return undefined
  return skills.find(skill => {
    try { return declaresRun(readFileSync(skill.path, 'utf8'), declared) } catch { return false }
  })
}

/**
 * The authoring root — the one place this Chat may create or edit a skill.
 * Selected workspace → `<workspace>/.agents/skills`, otherwise profile Shared. Same rule as
 * micromeet-cowork, and the same rule `skill_creator` has always used; it is factored out here so
 * `write_skill_file` cannot drift from it.
 */
const authoringScope = (host: SkillCreatorHost): { root: string; checkPath: (path: string) => void } => {
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
  return { root, checkPath }
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
      const { root, checkPath } = authoringScope(host)
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
}, {
  name: 'write_skill_file',
  description: 'Write one complete UTF-8 file into a skill package in the current authoring root (selected Chat workspace `.agents/skills`, otherwise profile Shared). ' +
    'Use <skill-name>/<file> or an absolute path inside that root. Creates parent directories. Overwrites the named file, so send the whole content, never a fragment. ' +
    'Institution and cloud-managed packages are read-only. Edited content enters the catalog after Skills Refresh or a new Chat.',
  params: [
    { name: 'path', required: true, description: '<skill-name>/<file>, or an absolute path inside the authoring root.' },
    { name: 'content', required: true, description: 'Complete UTF-8 file content.' }
  ],
  execute: async args => {
    try {
      const { root, checkPath } = authoringScope(host)
      const input = String(args.path ?? '')
      if (!input || input.includes('\\') || input.split('/').includes('..')) throw new Error('Use <skill-name>/<file> inside the skill authoring root')
      const file = isAbsolute(input) ? resolve(input) : resolve(root, input)
      const parts = relative(root, file).split(sep)
      if (parts.length < 2 || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(parts[0]) || parts.some(part => part === '.' || part === '..')) throw new Error('Use <skill-name>/<file> inside the skill authoring root')
      checkPath(file)
      // A symlink anywhere on the way out is refused rather than followed: the authoring root is a
      // boundary, and following a link is exactly how a write escapes one.
      let cursor = root
      for (const part of parts) {
        cursor = join(cursor, part)
        try { if (lstatSync(cursor).isSymbolicLink()) throw new Error('Skill writes cannot follow symbolic links') }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      }
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, String(args.content ?? ''), 'utf8')
      host.changed()
      return JSON.stringify({ ok: true, path: file })
    } catch (error) {
      return JSON.stringify({ ok: false, error: (error as Error).message })
    }
  }
}, {
  name: 'run_skill_file',
  description: 'Run one script that belongs to a skill available in this Chat. JavaScript/TypeScript (.mjs, .js, .ts) runs on the bundled Bun, which every install ships, so no developer environment is needed; ' +
    'a shell helper (.sh, .bash) or PowerShell (.ps1) falls back to the same shell resolution Pi uses. Runs with the skill package as the working directory, so relative resources resolve. ' +
    'args_json is a JSON array of string arguments; input_json is a JSON object sent on stdin. Returns stdout, stderr and the exit code, with a 60s timeout. ' +
    'Requires operator approval: this is trusted local code with normal user permissions, not a sandbox. No shell command, runtime choice or dependency install.',
  params: [
    { name: 'path', required: true, description: 'Script path inside an available skill package.' },
    { name: 'args_json', required: false, description: 'Optional JSON array of string arguments.' },
    { name: 'input_json', required: false, description: 'Optional JSON object sent on stdin.' }
  ],
  execute: async (args, signal) => {
    try {
      const input = String(args.path ?? '')
      if (!input) throw new Error('Skill script path is required')
      const file = isAbsolute(input) ? resolve(input) : resolve(authoringScope(host).root, input)
      if (!SKILL_SCRIPT_EXTENSIONS.test(file)) throw new Error('Skill scripts must be .mjs, .js, .ts, .sh, .bash or .ps1 files')
      const argv: unknown = args.args_json ? JSON.parse(String(args.args_json)) : []
      const stdin: unknown = args.input_json ? JSON.parse(String(args.input_json)) : {}
      if (!Array.isArray(argv) || !argv.every(value => typeof value === 'string')) throw new Error('args_json must be an array of strings')
      if (!stdin || typeof stdin !== 'object' || Array.isArray(stdin)) throw new Error('input_json must be an object')
      // The script must belong to a package this Chat can actually use — availability is the
      // catalog's answer, not the filesystem's, so a disabled or unassigned package cannot run.
      const available = host.skills().filter(skill => skill.status === 'ready' && skill.scope !== 'unassigned' && skill.enabled !== false)
      // ① a script inside its own package — the path that always worked. ② an engine outside the
      // package that an available SKILL.md names (see declaringSkill); the workspace is the root then,
      // which is what makes `node areas/contacts/feishu.mjs` resolve the way the skill wrote it.
      const packaged = available.find(skill => inside(canonical(dirname(skill.path)), canonical(file)))
      const owner = packaged || declaringSkill(available, host.workspace(), file)
      if (!owner) throw new Error('Script must belong to a skill available in this Chat, or be a path an available SKILL.md declares inside the selected workspace')
      const reference = owner.reference || owner.id
      // Authorize before running AND re-assert after, so an institution revoked mid-call cannot be
      // the one whose script completed.
      const expected = await authorizeSkillReference(reference)
      const result = await runSkillScript({
        scriptPath: file, packageRoot: packaged ? dirname(owner.path) : resolve(host.workspace() as string), bunPath: host.bunPath(),
        args: argv as string[], input: stdin as Record<string, unknown>, signal
      })
      assertSkillContext(expected)
      return JSON.stringify(result)
    } catch (error) {
      return JSON.stringify({ ok: false, error: (error as Error).message })
    }
  }
}]
