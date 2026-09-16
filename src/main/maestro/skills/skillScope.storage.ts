import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash, randomUUID } from 'node:crypto'
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'

export type SkillScope = 'shared' | 'institution'
export interface SkillInstitutionContext { accountScope: string; institutionId: string; institutionName?: string; generation: string | number }
export interface SkillScopeContext {
  current(): SkillInstitutionContext | null
  authorize(): Promise<SkillInstitutionContext | null>
}
export interface SkillScopeFields {
  scope: SkillScope | 'unassigned'
  institutionId?: string
  institutionName?: string
  reference: string
}
interface CreationTarget { scope: SkillScope; institution: SkillInstitutionContext | null }
interface AssignmentIndex { archived: Record<string, string> }
const inside = (root: string, file: string): boolean => file === root || file.startsWith(root + sep)
const digest = (value: string): string => createHash('sha256').update(value).digest('hex')
const segment = (value: string): string => {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(value)) throw new Error('Invalid skill institution or account identifier')
  return value
}

/** Scope is host-owned provenance, never trusted from imported SKILL.md frontmatter. */
export class SkillScopeStorage {
  readonly library: string
  readonly shared: string
  private readonly creation = new AsyncLocalStorage<CreationTarget>()
  constructor(readonly userData: string, private readonly context: SkillScopeContext) {
    this.library = join(userData, 'skill-library')
    this.shared = join(this.library, 'shared')
  }

  current(): SkillInstitutionContext | null { return this.context.current() }

  institutionRoot(context = this.current()): string | null {
    return context ? join(this.library, segment(context.accountScope), segment(context.institutionId)) : null
  }

  roots(): string[] {
    const institution = this.institutionRoot()
    return [this.shared, ...(institution ? [institution] : [])]
  }

  async withCreation<T>(scope: SkillScope, operation: () => Promise<T>): Promise<T> {
    if (scope !== 'shared' && scope !== 'institution') throw new Error('Choose Shared or Institution for this skill')
    const institution = scope === 'institution' ? await this.context.authorize() : null
    if (scope === 'institution' && !institution) throw new Error('Sign in and select an authorized institution first')
    return await this.creation.run({ scope, institution }, operation)
  }

  async authorizeCreation(): Promise<void> {
    const target = this.creation.getStore()
    if (target?.scope !== 'institution') return
    this.assertCurrent(target.institution)
    await this.context.authorize()
    this.assertCurrent(target.institution)
  }

  /** Explicit calls outside the Workbench capture target default to Shared; no guessed institution. */
  creationRoot(): string {
    const target = this.creation.getStore() ?? { scope: 'shared' as const, institution: null }
    if (target.scope === 'shared') return this.shared
    this.assertCurrent(target.institution)
    return this.institutionRoot(target.institution)!
  }

  sameContext(expected: SkillInstitutionContext | null): boolean {
    const current = this.current()
    return Boolean(expected && current && current.accountScope === expected.accountScope && current.institutionId === expected.institutionId && current.generation === expected.generation)
  }

  assertCurrent(expected: SkillInstitutionContext | null): void {
    if (!this.sameContext(expected)) throw new Error('Skill institution changed; retry in the current context')
  }

  fields(file: string, originalId: string, source: string, legacyRegistry = false): SkillScopeFields | null {
    const path = resolve(file)
    if (this.readIndex().archived[path]) return null
    if (inside(this.shared, path)) return { scope: 'shared', reference: `shared:${digest(originalId)}` }
    const institution = this.current()
    const root = this.institutionRoot(institution)
    if (root && inside(root, path)) return {
      scope: 'institution', institutionId: institution!.institutionId, institutionName: institution!.institutionName,
      reference: `institution:${institution!.accountScope}:${institution!.institutionId}:${digest(originalId)}`
    }
    if (inside(this.library, path)) return null
    // Old cloud ledger entries have no scope provenance. Do not turn them public on logout.
    if (legacyRegistry || source === 'recording' || source === 'external') return { scope: 'unassigned', reference: `unassigned:${digest(path)}` }
    return { scope: 'shared', reference: `shared:${digest(originalId)}` }
  }

  async assign(file: string, scope: SkillScope): Promise<string> {
    return await this.withCreation(scope, async () => {
      const source = resolve(dirname(file))
      if (![join(this.userData, 'skills'), join(this.userData, '.agents', 'skills')].some((root) => inside(root, source))) throw new Error('Only an owned legacy skill can be assigned')
      if (!existsSync(join(source, 'SKILL.md'))) throw new Error('Legacy skill no longer exists')
      this.assertPlainTree(source)
      const root = this.creationRoot()
      mkdirSync(root, { recursive: true })
      const id = randomUUID()
      const stage = join(root, `.assign-${id}`)
      const destination = join(root, id)
      try {
        cpSync(source, stage, { recursive: true, errorOnExist: true, force: false })
        this.creationRoot() // Fence the final activation too.
        renameSync(stage, destination)
        const index = this.readIndex()
        index.archived[resolve(file)] = join(destination, 'SKILL.md')
        this.writeIndex(index)
        return join(destination, 'SKILL.md')
      } catch (error) {
        rmSync(stage, { recursive: true, force: true })
        rmSync(destination, { recursive: true, force: true })
        throw error
      }
    })
  }

  private assertPlainTree(root: string): void {
    const visit = (path: string): void => {
      const stat = lstatSync(path)
      if (stat.isSymbolicLink()) throw new Error('Scope assignment does not follow symbolic links')
      if (stat.isDirectory()) for (const item of readdirSync(path)) visit(join(path, item))
      else if (!stat.isFile()) throw new Error('Unsupported file in skill package')
    }
    visit(root)
  }

  private readIndex(): AssignmentIndex {
    try {
      const value = JSON.parse(readFileSync(join(this.library, 'scope-index.json'), 'utf8'))
      if (value && typeof value.archived === 'object' && !Array.isArray(value.archived)) return { archived: value.archived }
    } catch { /* No assignment has been made yet. */ }
    return { archived: {} }
  }

  private writeIndex(index: AssignmentIndex): void {
    mkdirSync(this.library, { recursive: true })
    const target = join(this.library, 'scope-index.json')
    const stage = `${target}.${randomUUID()}.tmp`
    try { writeFileSync(stage, JSON.stringify(index)); renameSync(stage, target) }
    finally { rmSync(stage, { force: true }) }
  }
}
