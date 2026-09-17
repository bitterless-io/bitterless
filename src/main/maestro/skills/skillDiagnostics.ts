import { accessSync, constants, existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { delimiter, extname, isAbsolute, join, resolve, sep } from 'node:path'
import { parseFrontmatter } from './piSkillSdk'

export interface SkillDiagnostic {
  kind: 'entry' | 'interpreter' | 'command' | 'package' | 'metadata'
  subject: string
  status: 'ready' | 'missing' | 'unknown'
  detail: string
  repair: string
}
export interface SkillDiagnostics {
  status: 'ready' | 'missing' | 'unknown'
  behaviorVerified: false
  checks: SkillDiagnostic[]
}

/** Declaration checks only: no process, network, secret inspection or dependency installation. */
export const diagnoseSkill = (options: { directory: string; bunPath: string; env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform }): SkillDiagnostics => {
  const checks: SkillDiagnostic[] = [], root = resolve(options.directory), env = options.env || process.env, platform = options.platform || process.platform
  const add = (kind: SkillDiagnostic['kind'], subject: string, status: SkillDiagnostic['status'], detail: string, repair = ''): void => { checks.push({ kind, subject, status, detail, repair }) }
  const executable = (name: string): string | undefined => {
    if (!name || (!isAbsolute(name) && !/^[a-zA-Z0-9_.+-]+$/.test(name))) return undefined
    const candidates = name === 'bun' ? [options.bunPath] : isAbsolute(name) ? [name] : (env.PATH || '').split(delimiter).filter(Boolean).flatMap(directory => platform === 'win32' ? (env.PATHEXT || '.EXE;.CMD;.BAT').split(';').map(extension => join(directory, name + extension.toLowerCase())) : [join(directory, name)])
    return candidates.find(file => { try { accessSync(file, platform === 'win32' ? constants.F_OK : constants.X_OK); return statSync(file).isFile() } catch { return false } })
  }
  try {
    const realRoot = realpathSync(root), file = realpathSync(join(root, 'SKILL.md'))
    if (!file.startsWith(realRoot + sep)) throw new Error('SKILL.md escapes the package directory')
    const { frontmatter } = parseFrontmatter<Record<string, unknown>>(readFileSync(file, 'utf8'))
    let entry = ''
    if (frontmatter.entry === undefined) add('entry', 'SKILL.md', 'ready', 'No script entry declared; instruction-only skills need no script. Undeclared script requirements are not checked.')
    else if (typeof frontmatter.entry !== 'string' || !frontmatter.entry.trim() || isAbsolute(frontmatter.entry) || frontmatter.entry.split(/[\\/]/).includes('..')) add('entry', String(frontmatter.entry), 'missing', 'The declared entry must be a relative file inside this package.', 'Fix the SKILL.md entry field.')
    else {
      entry = frontmatter.entry
      try {
        const target = realpathSync(join(root, entry))
        if (!target.startsWith(realRoot + sep) || !statSync(target).isFile()) throw new Error('Entry escapes the package or is not a file')
        add('entry', entry, 'ready', 'Declared entry file exists inside this package.')
      } catch { add('entry', entry, 'missing', 'Declared entry is missing, inaccessible or outside the package.', 'Restore the entry file or correct SKILL.md; do not execute an escaped link.') }
    }
    const inferred = /\.[cm]?[jt]s$/.test(entry) ? 'bun' : extname(entry) === '.py' ? 'python3' : extname(entry) === '.sh' ? 'bash' : extname(entry) === '.ps1' ? 'pwsh' : undefined
    const interpreter = typeof frontmatter.interpreter === 'string' ? frontmatter.interpreter : inferred
    if (interpreter) {
      const binary = executable(interpreter)
      add('interpreter', interpreter, binary ? 'ready' : 'missing', binary ? `Executable found: ${binary}. Compatibility has not been executed.` : 'Required interpreter executable was not found.', interpreter === 'bun' ? 'Repair the application bundled Bun runtime.' : 'Use an existing compatible interpreter or explicitly prepare the required application-private runtime; no installation was performed.')
    } else if (entry || frontmatter.interpreter !== undefined) add('interpreter', String(frontmatter.interpreter || entry), 'unknown', 'The interpreter cannot be established from this declaration.', 'Declare interpreter in SKILL.md and verify compatibility before execution.')
    if (frontmatter.dependencies !== undefined) {
      if (!Array.isArray(frontmatter.dependencies) || frontmatter.dependencies.some(value => typeof value !== 'string' || !/^[a-zA-Z0-9_.+-]+$/.test(value))) add('metadata', 'dependencies', 'unknown', 'Command dependencies must be a list of executable names, not shell commands.', 'Use dependencies: [command-name]; declare JavaScript package dependencies in package.json.')
      else for (const name of frontmatter.dependencies as string[]) {
        const binary = executable(name)
        add('command', name, binary ? 'ready' : 'missing', binary ? `Executable found: ${binary}.` : 'Declared command is not available.', 'Use an existing compatible tool or explicitly prepare the necessary dependency; no command was run or installed.')
      }
    }
    const packageFile = join(root, 'package.json')
    if (existsSync(packageFile)) {
      const actual = realpathSync(packageFile)
      if (!actual.startsWith(realRoot + sep)) throw new Error('package.json escapes the package directory')
      const metadata = JSON.parse(readFileSync(actual, 'utf8')), require = createRequire(packageFile)
      if (metadata.dependencies !== undefined && (!metadata.dependencies || typeof metadata.dependencies !== 'object' || Array.isArray(metadata.dependencies))) throw new Error('package.json dependencies must be an object')
      for (const [name, version] of Object.entries(metadata.dependencies || {})) {
        if (!/^(?:@[a-zA-Z0-9_.-]+\/)?[a-zA-Z0-9_.-]+$/.test(name) || name === '..') { add('package', name, 'unknown', 'Invalid package dependency name.', 'Correct package.json.'); continue }
        const installed = require.resolve.paths(name)?.find(directory => existsSync(join(directory, name, 'package.json')))
        add('package', `${name}@${String(version)}`, installed ? 'ready' : 'missing', installed ? 'Package manifest found in the resolution path; version compatibility and execution are not verified.' : 'Declared package dependency was not found in the resolution path.', 'Follow this package’s documented dependency setup in its own directory with the supported runtime. No lifecycle script or package install was run.')
      }
    }
  } catch (error) { add('metadata', 'SKILL.md / package.json', 'missing', (error as Error).message, 'Repair the declared metadata or restore the package, then run diagnostics again.') }
  return { status: checks.some(item => item.status === 'missing') ? 'missing' : checks.some(item => item.status === 'unknown') ? 'unknown' : 'ready', behaviorVerified: false, checks }
}
