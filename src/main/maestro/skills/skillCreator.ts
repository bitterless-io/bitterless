import { lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve, sep } from 'node:path'
import { loadSkillsFromDir, parseFrontmatter } from './piSkillSdk'

const marker = 'SKILL_CREATOR_TODO'
const inside = (root: string, file: string): boolean => file === root || file.startsWith(root + sep)
const exists = (file: string): boolean => {
  try { lstatSync(file); return true }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error }
}

export interface SkillCreatorResult {
  ok: boolean
  path: string
  generated: boolean
  formatChecked: boolean
  behaviorVerified: false
  diagnostics: string[]
}

/** Format evidence only. Scripts are never executed or treated as behavior evidence here. */
export const checkSkill = (directory: string): SkillCreatorResult => {
  const result: SkillCreatorResult = { ok: false, path: resolve(directory), generated: false, formatChecked: false, behaviorVerified: false, diagnostics: [] }
  try {
    const root = realpathSync(result.path)
    const resource = (value: unknown): string => {
      if (typeof value !== 'string' || !value.trim() || isAbsolute(value) || value.split(/[\\/]/).includes('..')) throw new Error('Declared entry/resources must be relative package paths')
      const file = realpathSync(resolve(root, value))
      if (!inside(root, file) || !statSync(file).isFile()) throw new Error(`Declared resource is not a file inside this package: ${value}`)
      return file
    }
    const document = resource('SKILL.md'), raw = readFileSync(document, 'utf8')
    result.generated = true
    const native = loadSkillsFromDir({ dir: result.path, source: 'path' })
    result.diagnostics.push(...native.diagnostics.map(item => item.message))
    if (!native.skills.some(skill => resolve(skill.filePath) === join(result.path, 'SKILL.md'))) result.diagnostics.push('Pi did not load this SKILL.md')
    const { frontmatter } = parseFrontmatter<Record<string, unknown>>(raw)
    for (const key of ['name', 'description']) if (typeof frontmatter[key] !== 'string' || !(frontmatter[key] as string).trim()) result.diagnostics.push(`${key} is required`)
    if (raw.includes(marker)) result.diagnostics.push('SKILL.md contains unfinished SKILL_CREATOR_TODO markers')
    // Optional creator hints; Pi otherwise accepts ordinary standard SKILL.md packages unchanged.
    if (frontmatter.entry !== undefined) {
      const entry = resource(frontmatter.entry)
      if (readFileSync(entry, 'utf8').includes(marker)) result.diagnostics.push('Declared entry contains unfinished SKILL_CREATOR_TODO markers')
    }
    if (frontmatter.resources !== undefined) {
      if (!Array.isArray(frontmatter.resources)) throw new Error('resources must be a list of relative package file paths')
      for (const value of frontmatter.resources) resource(value)
    }
  } catch (error) { result.diagnostics.push((error as Error).message) }
  result.diagnostics = [...new Set(result.diagnostics)]
  result.ok = result.formatChecked = result.diagnostics.length === 0
  return result
}

export const initializeSkill = (options: { root: string; name: string; description: string; template: 'instruction' | 'script' }): SkillCreatorResult => {
  const { name, description, template } = options
  if (!name || name !== name.trim() || /[<>:"\\/|?*\x00-\x1f]/.test(name) || name === '.' || name === '..' || /[. ]$/.test(name)) throw new Error('Provide a safe single-directory skill name; Pi expects lowercase letters, digits and hyphens')
  if (!description?.trim()) throw new Error('Provide a description stating what the skill does and when to use it')
  if (template !== 'instruction' && template !== 'script') throw new Error('Choose instruction or script template')
  const root = resolve(options.root), destination = join(root, name)
  if (exists(destination)) throw new Error('Skill destination already exists; inspect/edit it explicitly or choose another name')
  mkdirSync(root, { recursive: true })
  const stage = mkdtempSync(join(root, '.skill-create-'))
  try {
    writeFileSync(join(stage, 'SKILL.md'), [
      '---', `name: ${JSON.stringify(name)}`, `description: ${JSON.stringify(description.trim())}`,
      ...(template === 'script' ? ['entry: scripts/run.mjs'] : []), '---', '', `# ${name}`, '',
      '## Inputs and outcome', `${marker}: Define required inputs and the observable successful result.`, '',
      '## Procedure', ...(template === 'script' ? ['Use scripts/run.mjs with a JSON object as its first argument. Resolve the script relative to this package.'] : []),
      `${marker}: Write concrete steps, relevant boundaries, and expected output.`, '',
      '## Representative check', `${marker}: Choose a representative input and expected observable result; verify with existing tools only when appropriate and authorized.`,
      'Report generated, format-checked and behavior-verified separately. Unexecuted behavior remains not verified.', ''
    ].join('\n'), { flag: 'wx' })
    if (template === 'script') {
      mkdirSync(join(stage, 'scripts'))
      writeFileSync(join(stage, 'scripts/run.mjs'), [
        'const input = JSON.parse(process.argv[2] ?? "{}")',
        `// ${marker}: Implement the requested transformation and meaningful input checks.`,
        'throw new Error("Skill implementation is unfinished")',
        '// Emit a useful, observable result after implementation, e.g. console.log(JSON.stringify(result)).', ''
      ].join('\n'), { flag: 'wx' })
    }
    const native = loadSkillsFromDir({ dir: stage, source: 'path' })
    if (!native.skills.length || native.diagnostics.length) throw new Error(native.diagnostics.map(item => item.message).join('; ') || 'Pi could not load the generated metadata')
    if (exists(destination)) throw new Error('Skill destination appeared during initialization; nothing was overwritten')
    renameSync(stage, destination)
    return { ...checkSkill(destination), ok: true }
  } finally { rmSync(stage, { recursive: true, force: true }) }
}
