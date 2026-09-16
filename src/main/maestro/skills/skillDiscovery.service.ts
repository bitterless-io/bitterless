import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, realpathSync, statSync, watch, type FSWatcher } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { parse } from 'yaml'
import type { SkillSummary } from '@maestro-shared/coach.api'

const skipped = new Set(['.git', 'node_modules', 'archive', '.cache'])
export const fingerprint = (text: string | Buffer): string => createHash('sha256').update(text).digest('hex')

/** Repository discovery is read-only, including linked skills and missing skill roots. */
export const workspaceSkillRoots = (cwd?: string): string[] => {
  if (!cwd) return []
  const start = resolve(cwd), parents = [start]
  let cursor = start
  while (!existsSync(join(cursor, '.git')) && dirname(cursor) !== cursor) {
    cursor = dirname(cursor)
    parents.push(cursor)
  }
  return (existsSync(join(cursor, '.git')) ? parents : [start]).map(path => join(path, '.agents', 'skills'))
}

export const discoverSkillFiles = (roots: string[]): { files: string[]; directories: Set<string> } => {
  const files: string[] = [], directories = new Set<string>(), visited = new Set<string>()
  const visit = (path: string): void => {
    const actual = realpathSync(path)
    if (visited.has(actual)) return
    visited.add(actual)
    const stat = statSync(path)
    if (!stat.isDirectory()) { if (basename(path) === 'SKILL.md') files.push(path); return }
    directories.add(actual)
    for (const name of readdirSync(path).sort()) {
      if (skipped.has(name) || name.startsWith('.')) continue
      const child = join(path, name)
      try { visit(child) } catch (error) {
        // A dangling package link is a discovered error, not a silently missing skill.
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') files.push(join(child, 'SKILL.md'))
        else throw error
      }
    }
  }
  for (const root of roots) {
    let parent = root
    while (!existsSync(parent) && dirname(parent) !== parent) parent = dirname(parent)
    directories.add(parent)
    if (existsSync(root)) visit(root)
  }
  return { files, directories }
}

export const skillPackageFiles = (directory: string): string[] => {
  const result: string[] = [], seen = new Set<string>()
  const visit = (path: string): void => {
    const real = realpathSync(path); if (seen.has(real)) return; seen.add(real)
    if (statSync(path).isDirectory()) { for (const name of readdirSync(path).sort()) if (!skipped.has(name) && !name.startsWith('.')) visit(join(path, name)) }
    else result.push(relative(directory, path))
  }
  visit(directory); return result
}

export const skillPackageRevision = (directory: string): string => {
  const hash = createHash('sha256'), seen = new Set<string>()
  const visit = (path: string): void => {
    const actual = realpathSync(path)
    if (seen.has(actual)) return
    seen.add(actual)
    const stat = statSync(path)
    if (stat.isDirectory()) {
      for (const name of readdirSync(path).sort()) if (!skipped.has(name) && !name.startsWith('.')) visit(join(path, name))
    } else if (stat.isFile()) hash.update(relative(directory, path)).update('\0').update(readFileSync(path)).update('\0')
  }
  visit(directory)
  return hash.digest('hex')
}

export const describeSkillFile = (file: string, base: SkillSummary): SkillSummary => {
  try {
    const raw = readFileSync(file, 'utf8').match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
    if (!raw) throw new Error('SKILL.md requires YAML frontmatter with name and description.')
    const meta = parse(raw[1])
    if (!meta || typeof meta.name !== 'string' || !meta.name.trim() || typeof meta.description !== 'string' || !meta.description.trim()) throw new Error('SKILL.md requires a non-empty name and description.')
    const sidecarFile = join(dirname(file), 'agents', 'openai.yaml')
    const sidecar = existsSync(sidecarFile) ? parse(readFileSync(sidecarFile, 'utf8')) : undefined
    const legacyRecording = base.source === 'recording' && base.layer !== 'workspace'
    const displayName = typeof sidecar?.interface?.display_name === 'string' ? sidecar.interface.display_name.trim() : ''
    return { ...base, name: legacyRecording ? base.name : meta.name.trim(), canonicalName: meta.name.trim(), displayName: displayName || (legacyRecording ? base.name : undefined), description: meta.description,
      skillRevision: skillPackageRevision(dirname(file)), status: 'ready', realPath: realpathSync(file),
      allowImplicitInvocation: sidecar?.policy?.allow_implicit_invocation !== false, updatedAt: statSync(file).mtimeMs }
  } catch (error) {
    return { ...base, status: 'error', error: (error as Error).message, skillRevision: '', updatedAt: Date.now() }
  }
}

export const discoverWorkspaceSkills = (cwd?: string): SkillSummary[] => {
  const roots = workspaceSkillRoots(cwd)
  return discoverSkillFiles(roots).files.map(file => {
    const root = roots.find(root => file.startsWith(root + '/')) || roots[0]
    const ref = `workspace:${fingerprint(root)}:${fingerprint(file)}`
    return describeSkillFile(file, { id: ref, reference: ref, layer: 'workspace', source: 'external', name: basename(dirname(file)),
      description: '', path: file, root, domain: '', updatedAt: 0, inputs: [], triggers: [], readonly: true })
  })
}

/** Watch each real directory; refresh subscriptions after rename/add, never mutate discovered roots. */
const sourceSignature = (roots: string[]): string => {
  const seen = new Set<string>(), values: string[] = []
  const visit = (path: string): void => {
    if (!existsSync(path)) { values.push(path + ':missing'); return }
    const real = realpathSync(path); if (seen.has(real)) return; seen.add(real)
    const stat = statSync(path); values.push(path + ':' + stat.size + ':' + stat.mtimeMs + ':' + stat.ctimeMs)
    if (stat.isDirectory()) for (const name of readdirSync(path).sort()) if (!skipped.has(name) && !name.startsWith('.')) visit(join(path, name))
  }
  for (const root of roots) visit(root)
  return fingerprint(values.join('\n'))
}

export class SkillDirectoryWatcher {
  private watches = new Map<string, FSWatcher>()
  private timer?: ReturnType<typeof setTimeout>
  private poll?: ReturnType<typeof setInterval>
  private roots: string[] = []
  private signature = ''
  error = ''
  constructor(private readonly changed: () => void) {}
  update(roots: string[]): void {
    this.roots = roots
    this.signature = sourceSignature(roots)
    if (!this.poll) {
      this.poll = setInterval(() => {
        try { const next = sourceSignature(this.roots); if (next !== this.signature) { this.update(this.roots); this.changed() } }
        catch (error) { this.error = (error as Error).message; this.changed() }
      }, 1000)
      this.poll.unref?.()
    }
    const directories = discoverSkillFiles(roots).directories
    for (const [path, watcher] of this.watches) if (!directories.has(path)) { watcher.close(); this.watches.delete(path) }
    this.error = ''
    for (const path of directories) {
      if (this.watches.has(path)) continue
      try {
        const watcher = watch(path, { persistent: false }, () => {
          clearTimeout(this.timer)
          this.timer = setTimeout(() => { try { this.update(roots) } catch (error) { this.error = (error as Error).message } this.changed() }, 300)
          this.timer.unref?.()
        })
        watcher.on('error', error => { this.error = error.message; watcher.close(); this.watches.delete(path); this.changed() })
        this.watches.set(path, watcher)
      } catch (error) { this.error = (error as Error).message }
    }
  }
  dispose(): void { clearTimeout(this.timer); clearInterval(this.poll); for (const watcher of this.watches.values()) watcher.close(); this.watches.clear() }
}
