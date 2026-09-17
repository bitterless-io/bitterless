import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { loadSkillsFromDir, type Skill } from './piSkillSdk'
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


export interface LoadedSkillFile { file: string; root: string; skill?: Skill; error?: string }

/** Pi owns traversal, ignore rules and frontmatter validation. Keep same-name packages. */
export const loadSkillSources = (roots: string[]): LoadedSkillFile[] => {
  const rows: LoadedSkillFile[] = [], seen = new Set<string>()
  for (const root of roots) {
    const result = loadSkillsFromDir({ dir: root, source: root })
    const valid = new Set(result.skills.map(skill => skill.filePath))
    const append = (row: LoadedSkillFile): void => {
      let key = row.file
      try { key = realpathSync(row.file) } catch { /* Preserve native read diagnostics. */ }
      if (seen.has(key)) return
      seen.add(key); rows.push(row)
    }
    for (const skill of result.skills) append({ file: skill.filePath, root, skill })
    for (const diagnostic of result.diagnostics) if (diagnostic.path && !valid.has(diagnostic.path)) append({ file: diagnostic.path, root, error: diagnostic.message })
  }
  return rows
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


/** Host-only package identity, revision, recording metadata and optional Codex UI policy. */
export const summarizeLoadedSkill = (loaded: LoadedSkillFile, base: SkillSummary): SkillSummary => {
  const { file, skill } = loaded
  let realPath: string | undefined
  try { realPath = realpathSync(file) } catch { /* Native diagnostics describe unreadable files. */ }
  base = { ...base, realPath }
  if (!skill) return { ...base, status: 'error', error: loaded.error, skillRevision: '', updatedAt: 0 }
  try {
    const sidecarFile = join(dirname(file), 'agents', 'openai.yaml')
    const sidecar = existsSync(sidecarFile) ? parse(readFileSync(sidecarFile, 'utf8')) : undefined
    const legacyRecording = base.source === 'recording' && base.layer !== 'workspace'
    const displayName = typeof sidecar?.interface?.display_name === 'string' ? sidecar.interface.display_name.trim() : ''
    return { ...base, name: legacyRecording ? base.name : skill.name, canonicalName: skill.name, displayName: displayName || (legacyRecording ? base.name : undefined), description: skill.description,
      skillRevision: skillPackageRevision(dirname(file)), status: 'ready', realPath: realpathSync(file),
      allowImplicitInvocation: !skill.disableModelInvocation && sidecar?.policy?.allow_implicit_invocation !== false, updatedAt: statSync(file).mtimeMs }
  } catch (error) {
    return { ...base, status: 'error', error: (error as Error).message, skillRevision: '', updatedAt: 0 }
  }
}

export const discoverWorkspaceSkills = (cwd?: string): SkillSummary[] => loadSkillSources(workspaceSkillRoots(cwd)).map(loaded => {
  const { file, root } = loaded
  const ref = `workspace:${fingerprint(root)}:${fingerprint(file)}`
  return summarizeLoadedSkill(loaded, { id: ref, reference: ref, layer: 'workspace', source: 'external', name: basename(dirname(file)),
    description: '', path: file, root, domain: '', updatedAt: 0, inputs: [], triggers: [], readonly: true })
})
