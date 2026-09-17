import { randomUUID } from 'node:crypto'
import { chmodSync, constants, copyFileSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, renameSync, rmSync } from 'node:fs'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'

interface PackageEntry { source: string; path: string; directory: boolean; mode: number }

/** Complete portable package tree. Internal links become resources; external links never enter it. */
const packageEntries = (source: string): PackageEntry[] => {
  const root = realpathSync(source), entries: PackageEntry[] = [], names = new Set<string>()
  const visit = (file: string, path: string, ancestors: Set<string>): void => {
    let actual: string
    try { actual = realpathSync(file) }
    catch { throw new Error(`Unreadable or broken Skill package link: ${path || '.'}`) }
    if (actual !== root && !actual.startsWith(root + sep)) throw new Error(`Skill package link escapes its root: ${path}`)
    const stat = lstatSync(actual)
    if (!stat.isDirectory() && !stat.isFile()) throw new Error(`Unsupported Skill package entry: ${path || '.'}`)
    if (!path && !stat.isDirectory()) throw new Error('Skill package source must be a directory')
    if (path) {
      const key = path.normalize('NFC').toLowerCase()
      if (names.has(key)) throw new Error(`Conflicting Skill package paths: ${path}`)
      names.add(key)
      entries.push({ source: actual, path, directory: stat.isDirectory(), mode: stat.mode & 0o777 })
    }
    if (!stat.isDirectory()) return
    if (ancestors.has(actual)) throw new Error(`Cyclic Skill package link: ${path}`)
    const parents = new Set(ancestors).add(actual)
    for (const name of readdirSync(actual).sort()) {
      if (name === '.' || name === '..' || /[<>:"\\|?*\x00-\x1f]/.test(name) || /[. ]$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) {
        throw new Error(`Unsafe Skill package path: ${path ? path + '/' : ''}${name}`)
      }
      visit(join(actual, name), path ? path + '/' + name : name, parents)
    }
  }
  visit(root, '', new Set())
  return entries
}

const exists = (path: string): boolean => {
  try { lstatSync(path); return true }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error }
}

export const skillPackageFileList = (source: string): string[] => packageEntries(source).filter(entry => !entry.directory).map(entry => entry.path)

/** Stage, normalize, then publish synchronously. Existing destinations are never selected. */
export const publishSkillPackage = (source: string, requestedDestination: string, transform: (stage: string) => void): string => {
  const sourceRoot = realpathSync(source), destination = resolve(requestedDestination), parent = dirname(destination)
  const entries = packageEntries(sourceRoot)
  let ancestor = parent
  while (!exists(ancestor)) ancestor = dirname(ancestor)
  const resolvedParent = resolve(realpathSync(ancestor), relative(ancestor, parent))
  if (resolvedParent === sourceRoot || resolvedParent.startsWith(sourceRoot + sep)) throw new Error('Skill package destination is inside its source')
  mkdirSync(parent, { recursive: true })
  const realParent = realpathSync(parent)
  if (realParent === sourceRoot || realParent.startsWith(sourceRoot + sep)) throw new Error('Skill package destination is inside its source')
  const stage = mkdtempSync(join(realParent, '.skill-stage-'))
  try {
    for (const entry of entries) {
      const target = join(stage, entry.path)
      // Recheck before copying in case a source entry changed after inventory construction.
      if (realpathSync(entry.source) !== entry.source) throw new Error(`Skill package source changed: ${entry.path}`)
      if (entry.directory) mkdirSync(target)
      else {
        copyFileSync(entry.source, target, constants.COPYFILE_EXCL)
        chmodSync(target, entry.mode | 0o200) // Host metadata normalization may update read-only documents.
      }
    }
    transform(stage)
    for (const entry of entries) if (!entry.directory) chmodSync(join(stage, entry.path), entry.mode)
    let target = join(realParent, basename(destination))
    while (exists(target)) target = join(realParent, `${basename(destination)}-${randomUUID()}`)
    renameSync(stage, target)
    return join(parent, basename(target)) // Preserve the host's lexical scope root (e.g. /var on macOS).
  } finally { rmSync(stage, { recursive: true, force: true }) }
}
