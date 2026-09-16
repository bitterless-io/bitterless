import { AsyncLocalStorage } from 'node:async_hooks'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { parse } from 'yaml'
import { skillScopeContext } from './skillScope.context'
import type { SkillInstitutionContext } from './skillScope.storage'

const access = new AsyncLocalStorage<SkillInstitutionContext | null>()
const inside = (root: string, path: string): boolean => path === root || path.startsWith(root + sep)
const canonical = (path: string): string => {
  let parent = resolve(path)
  while (!existsSync(parent) && dirname(parent) !== parent) parent = dirname(parent)
  try { return resolve(realpathSync(parent), relative(parent, resolve(path))) } catch { return resolve(path) }
}
const json = (path: string): Record<string, any> => { try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return {} } }

/** General file tools share the same verified context, including every result after an await. */
export const withSkillFileAccess = async <T>(userData: string, path: string, run: () => Promise<T>): Promise<T> => {
  const library = join(canonical(userData), 'skill-library'), target = canonical(path)
  const touchesInstitution = (inside(library, target) || inside(target, library)) && !inside(join(library, 'shared'), target)
  const context = touchesInstitution ? await skillScopeContext.authorize().catch(() => null) : null
  return await access.run(context, async () => {
    assertSkillFilePath(userData, path)
    const result = await run()
    const current = skillScopeContext.current()
    if (context && (!current || current.accountScope !== context.accountScope || current.institutionId !== context.institutionId || current.generation !== context.generation)) throw new Error('Skill institution changed during file access')
    return result
  })
}

export const canReadSkillPath = (userData: string, file: string): boolean => {
  const base = canonical(userData)
  const library = join(base, 'skill-library'), shared = join(library, 'shared')
  const current = skillScopeContext.current(), expected = access.getStore()
  const institution = expected && current && current.accountScope === expected.accountScope && current.institutionId === expected.institutionId && current.generation === expected.generation ? join(library, expected.accountScope, expected.institutionId) : null
  const allowed = (path: string): boolean => {
    if (inside(library, path)) {
      if (path === library || path === shared) return true
      let root = shared
      if (!inside(shared, path)) {
        if (!institution) return false
        if (path === dirname(institution)) return true
        if (!inside(institution, path)) return false
        root = institution
      }
      const cloud = join(root, 'cloud')
      if (!inside(cloud, path)) return !relative(root, path).split(sep).some(part => part.startsWith('.'))
      const entries = Object.values(json(join(cloud, 'installed.json')).skills || {}) as {dir?: string}[]
      return entries.some(entry => {
        if (!entry.dir) return false
        const version = resolve(cloud, entry.dir)
        return inside(cloud, version) && (inside(version, path) || inside(path, version))
      })
    }
    for (const legacy of [join(base, 'skills'), join(base, '.agents', 'skills')]) {
      if (!inside(legacy, path)) continue
      if (path === legacy) return true
      let dir = path
      while (inside(legacy, dir) && dir !== legacy) {
        const skill = join(dir, 'SKILL.md')
        if (existsSync(skill)) {
          if (json(join(library, 'scope-index.json')).archived?.[skill]) return false
          const ledger = json(join(legacy, 'installed.json'))
          if (Object.values(ledger.skills || {}).some((entry: any) => entry.dir && inside(resolve(legacy, entry.dir), path))) return false
          const body = readFileSync(skill, 'utf8'), raw = body.match(/^---\s*\n([\s\S]*?)\n---/)
          const metadata = raw ? parse(raw[1]) : {}
          const source = metadata?.coach_source || json(join(dir, 'recipe.json')).source
          return source !== 'recording' && source !== 'external'
        }
        dir = dirname(dir)
      }
      return false
    }
    return true
  }
  try { const lexical = inside(resolve(userData), resolve(file)) ? resolve(base, relative(resolve(userData), resolve(file))) : resolve(file); return allowed(lexical) && allowed(canonical(file)) } catch { return false }
}

export const assertSkillFilePath = (userData: string, file: string): void => {
  if (!canReadSkillPath(userData, file)) throw new Error('Skill path is unavailable in this account. Use its qualified Skill reference; assign older skills a scope in Workbench first.')
}
