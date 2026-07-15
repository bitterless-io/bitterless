import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'fs'
import { dirname, join, relative, resolve, sep } from 'path'
import { randomUUID } from 'crypto'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import type { DeleteSkillResult, SkillDetail, SkillExportResult, SkillImportResult, SkillInput, SkillSource, SkillSummary } from '@maestro-shared/coach.api'
import { SkillRecipeSchema, type SkillRecipe } from './skillRecipe.types'
import { redactRecipeForStorage } from './recipeRedact'
import { auditSkillPackage, sanitizeSkillBodyForStorage, sanitizeSkillScriptForStorage } from './skillAudit.service'

interface CreateSkillParams {
  name: string
  description: string
  triggers: string[]
  inputs: SkillInput[]
  recipe: SkillRecipe
  body: string
}

// The seeded "baseline" skills (e.g. skills/baseline/medical-booking) are retired.
// Remove the whole baseline/ subtree from each skill root on startup so it stops
// reappearing in the skill list.
const RETIRED_BASELINE_SKILL_DIR = 'baseline'
const SKILL_AUDIT_FILE = 'skill-audit.json'

export class SkillRegistryService {
  readonly skillsDir: string
  private readonly legacySkillsDir: string
  private portableDocsBackfilled = false

  constructor(private readonly userDataDir: string) {
    this.skillsDir = join(userDataDir, 'skills')
    this.legacySkillsDir = join(userDataDir, '.agents', 'skills')
  }

  ensureRuntimeStorage(): void {
    this.ensureAgentGuidance()
    this.removeRetiredBaselineSkill()
    this.backfillPortableSkillDocs()
  }

  listSkills(): SkillSummary[] {
    this.ensureRuntimeStorage()
    const files = this.skillRoots().flatMap((dir) => walk(dir).filter((file) => file.endsWith('/SKILL.md')))
    const byId = new Map<string, SkillSummary>()
    for (const skill of files.map((file) => this.readSkillSummary(file)).filter((item): item is SkillSummary => Boolean(item))) {
      const existing = byId.get(skill.id)
      if (!existing || skill.updatedAt > existing.updatedAt) byId.set(skill.id, skill)
    }
    return Array.from(byId.values()).sort((a, b) => b.updatedAt - a.updatedAt)
  }

  // On-disk folder holding every skill for a domain (<skillsDir>/<domainDir>/),
  // derived from an existing skill's path so the empty-domain → 'unknown-domain'
  // mapping is handled without re-deriving it. Empty domain → the skills root
  // (<skillsDir>/), which holds all domain folders. Null when nothing exists yet.
  domainDirectory(domain: string): string | null {
    if (!domain) return existsSync(this.skillsDir) ? this.skillsDir : null
    const skill = this.listSkills().find((item) => item.domain === domain)
    return skill ? dirname(dirname(skill.path)) : null
  }

  readRecipe(skillId: string): SkillRecipe | null {
    const skill = this.listSkills().find((item) => item.id === skillId)
    if (!skill?.recipePath || !existsSync(skill.recipePath)) return null
    try {
      return SkillRecipeSchema.parse(JSON.parse(readFileSync(skill.recipePath, 'utf8')))
    } catch {
      return null
    }
  }

  readSkillDetail(skillId: string): SkillDetail | null {
    const skill = this.listSkills().find((item) => item.id === skillId)
    if (!skill) return null
    let body = ''
    try {
      const content = readFileSync(skill.path, 'utf8')
      body = content.replace(/^﻿?---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim()
    } catch {
      /* unreadable SKILL.md — leave body empty; recipe-derived fields below still populate */
    }
    const recipe = skill.recipePath && existsSync(skill.recipePath) ? this.readRecipe(skill.id) : null
    const audit = recipe ? auditSkillPackage(recipe, body) : undefined
    return {
      id: skill.id,
      name: skill.name,
      description: skill.description,
      body,
      runtime: recipe ? 'coach' : 'external',
      externalOnly: !recipe,
      notes: recipe?.notes,
      fieldRules: recipe?.fieldRules,
      audit,
      triggers: skill.triggers,
      inputs: skill.inputs,
      stepCount: recipe?.steps.length ?? 0,
      networkCount: recipe?.network.length ?? 0,
      snapshotCount: recipe?.snapshots.length ?? 0
    }
  }

  latestRecordingSkill(): SkillSummary | null {
    return this.listSkills().find((skill) => skill.source === 'recording') || null
  }

  // Rewrite an existing skill in place (same id/dir) with a refined recipe + body.
  overwriteSkill(skillId: string, params: { recipe: SkillRecipe; body: string }): SkillSummary | null {
    const summary = this.listSkills().find((item) => item.id === skillId)
    if (!summary?.recipePath) return null
    const dir = dirname(summary.path)
    const recipe = prepareRecipeForStorage(params.recipe)
    const body = sanitizeSkillBodyForStorage(params.body)
    writeFileSync(summary.recipePath, JSON.stringify(recipe, null, 2), 'utf8')
    writeFileSync(
      summary.path,
      buildSkillMarkdown({
        id: recipe.id,
        name: recipe.name,
        description: recipe.description,
        source: recipe.source,
        aliases: recipe.aliases,
        shortcuts: recipe.shortcuts,
        keywords: recipe.keywords,
        triggers: recipe.triggers,
        inputs: recipe.inputs,
        body
      }),
      'utf8'
    )
    writeOpenAiSidecar(dir, recipe.name, recipe.description)
    writePortableSkillDocs(dir, recipe, body)
    writeSkillAuditFile(dir, recipe, body)
    return this.readSkillSummary(summary.path)
  }

  // All recording skills for a domain (hostname of the current page), most-recent
  // first. The invocation agent's catalog is scoped to this so a skill recorded on
  // one site is never offered on another.
  listSkillsForDomain(url: string): SkillSummary[] {
    const domain = domainOf(url)
    return this.listSkills().filter((s) => s.source === 'recording' && s.domain === domain)
  }

  // Find a live RECORDING skill by display name (case-insensitive) for dedup —
  // scoped to the same domain, so identically-named skills on different sites are
  // distinct (one per domain), not collapsed onto each other.
  findRecordingByName(name: string, url: string): SkillSummary | null {
    const key = name.trim().toLowerCase()
    if (!key) return null
    const domain = domainOf(url)
    return (
      this.listSkills().find(
        (s) => s.source === 'recording' && s.domain === domain && s.name.trim().toLowerCase() === key
      ) || null
    )
  }

  // Snapshot a skill's current files into <skill>/archive/<YYYYMMDD HH-MM-SS>/
  // before it is overwritten with a new version.
  archiveSkill(skillId: string, now = new Date()): boolean {
    const summary = this.listSkills().find((item) => item.id === skillId)
    if (!summary) return false
    const dir = dirname(summary.path)
    const dest = join(dir, 'archive', formatArchiveTs(now))
    mkdirSync(dest, { recursive: true })
    for (const file of ['recipe.json', 'SKILL.md', 'README.md', 'AGENTS.md', 'CLAUDE.md', SKILL_AUDIT_FILE]) {
      const src = join(dir, file)
      if (existsSync(src)) copyFileSync(src, join(dest, file))
    }
    const sidecar = join(dir, 'agents', 'openai.yaml')
    if (existsSync(sidecar)) {
      mkdirSync(join(dest, 'agents'), { recursive: true })
      copyFileSync(sidecar, join(dest, 'agents', 'openai.yaml'))
    }
    return true
  }

  deleteSkill(skillId: string): DeleteSkillResult {
    const skill = this.listSkills().find((item) => item.id === skillId)
    if (!skill) {
      return { ok: false, skillId, message: 'Skill not found.', error: 'not-found' }
    }
    if (skill.source === 'builtin') {
      return { ok: false, skillId, message: 'Built-in skills cannot be deleted.', error: 'builtin-skill' }
    }

    const targetDir = resolve(dirname(skill.path))
    if (!this.isInsideSkillRoot(targetDir)) {
      return { ok: false, skillId, message: 'Refusing to delete a path outside the skill registry.', error: 'unsafe-path' }
    }

    rmSync(targetDir, { recursive: true, force: true })
    return { ok: true, skillId, message: `Deleted skill ${skill.name}.` }
  }

  exportSkillPackage(skillId: string, destinationRoot: string): SkillExportResult {
    const skill = this.listSkills().find((item) => item.id === skillId)
    if (!skill) {
      return { ok: false, skillId, message: 'Skill not found.', error: 'not-found' }
    }

    const sourceDir = resolve(dirname(skill.path))
    if (!this.isInsideSkillRoot(sourceDir)) {
      return { ok: false, skillId, message: 'Refusing to export a path outside the skill registry.', error: 'unsafe-path' }
    }

    const root = resolve(destinationRoot || '')
    try {
      const rootStats = statSync(root)
      if (!rootStats.isDirectory()) {
        return { ok: false, skillId, message: 'Export destination is not a directory.', error: 'not-a-directory' }
      }
    } catch {
      return { ok: false, skillId, message: 'Export destination does not exist.', error: 'destination-not-found' }
    }

    if (root === sourceDir || root.startsWith(sourceDir + sep)) {
      return { ok: false, skillId, message: 'Refusing to export inside the source skill directory.', error: 'destination-inside-source' }
    }

    const exportDir = uniqueExportDir(root, `${slugify(skill.name)}-coach-skill`)
    const copied: string[] = []
    const writePortableFile = (relativePath: string, content: string): void => {
      const dest = join(exportDir, ...relativePath.split('/'))
      mkdirSync(dirname(dest), { recursive: true })
      writeFileSync(dest, content, 'utf8')
      copied.push(relativePath)
    }

    try {
      mkdirSync(exportDir, { recursive: true })
      const recipe = skill.recipePath ? this.readRecipe(skill.id) : null
      const body = sanitizeSkillBodyForStorage(readSkillBody(readFileSync(skill.path, 'utf8')))
      const safeRecipe = recipe ? prepareRecipeForStorage(recipe) : null
      const audit = safeRecipe ? auditSkillPackage(safeRecipe, body) : auditSkillPackage(emptyExportRecipe(skill), body)
      if (!audit.ok) return { ok: false, skillId, path: exportDir, message: 'Skill export failed audit.', audit, error: 'skill-audit-failed' }
      if (safeRecipe) {
        writePortableFile('recipe.json', JSON.stringify(safeRecipe, null, 2))
        writePortableFile(
          'SKILL.md',
          buildSkillMarkdown({
            id: safeRecipe.id,
            name: safeRecipe.name,
            description: safeRecipe.description,
            source: safeRecipe.source,
            aliases: safeRecipe.aliases,
            shortcuts: safeRecipe.shortcuts,
            keywords: safeRecipe.keywords,
            triggers: safeRecipe.triggers,
            inputs: safeRecipe.inputs,
            body
          })
        )
        writeOpenAiSidecar(exportDir, safeRecipe.name, safeRecipe.description)
        copied.push('agents/openai.yaml')
        writePortableSkillDocs(exportDir, safeRecipe, body)
        copied.push('README.md', 'AGENTS.md', 'CLAUDE.md')
      } else {
        writePortableFile('SKILL.md', sanitizeSkillBodyForStorage(readFileSync(skill.path, 'utf8')))
        const sourceReadme = join(sourceDir, 'README.md')
        writePortableFile(
          'README.md',
          existsSync(sourceReadme) ? sanitizeSkillBodyForStorage(readFileSync(sourceReadme, 'utf8')) : buildExternalSkillReadme(skill.name, skill.description)
        )
        const sourceAgents = join(sourceDir, 'AGENTS.md')
        const sourceClaude = join(sourceDir, 'CLAUDE.md')
        const fallbackGuidance = buildExternalAgentGuidance(skill.name, skill.description)
        writePortableFile(
          'AGENTS.md',
          existsSync(sourceAgents) ? sanitizeSkillBodyForStorage(readFileSync(sourceAgents, 'utf8')) : fallbackGuidance
        )
        writePortableFile(
          'CLAUDE.md',
          existsSync(sourceClaude) ? sanitizeSkillBodyForStorage(readFileSync(sourceClaude, 'utf8')) : fallbackGuidance
        )
        const sourceSidecar = join(sourceDir, 'agents', 'openai.yaml')
        if (existsSync(sourceSidecar)) {
          writePortableFile('agents/openai.yaml', readFileSync(sourceSidecar, 'utf8'))
        } else {
          writeOpenAiSidecar(exportDir, skill.name, skill.description)
          copied.push('agents/openai.yaml')
        }
      }
      writePortableFile(SKILL_AUDIT_FILE, JSON.stringify(audit, null, 2))
      writeFileSync(
        join(exportDir, 'coach-export.json'),
        JSON.stringify(
          {
            version: 1,
            exportedAt: Date.now(),
            skill: {
              id: skill.id,
              name: skill.name,
              description: skill.description,
              domain: skill.domain,
              source: skill.source,
              triggers: skill.triggers,
              inputs: skill.inputs.map((input) => ({
                name: input.name,
                label: input.label,
                required: input.required,
                type: input.type || 'string'
              }))
            },
            audit,
            files: copied
          },
          null,
          2
        ),
        'utf8'
      )
      return { ok: true, skillId, path: exportDir, message: `Exported ${skill.name}.`, audit }
    } catch (err) {
      return { ok: false, skillId, path: exportDir, message: 'Skill export failed.', error: (err as Error).message }
    }
  }

  importSkillPackage(packageDir: string): SkillImportResult {
    const sourceDir = resolve(packageDir || '')
    try {
      const sourceStats = statSync(sourceDir)
      if (!sourceStats.isDirectory()) return { ok: false, path: sourceDir, message: 'Skill package is not a directory.', error: 'not-a-directory' }
    } catch {
      return { ok: false, path: sourceDir, message: 'Skill package directory does not exist.', error: 'package-not-found' }
    }

    if (this.isInsideSkillRoot(sourceDir)) {
      return { ok: false, path: sourceDir, message: 'This package is already inside the Coach skill registry.', error: 'already-installed' }
    }

    const skillPath = join(sourceDir, 'SKILL.md')
    const recipePath = join(sourceDir, 'recipe.json')
    if (!existsSync(skillPath)) {
      return { ok: false, path: sourceDir, message: 'Portable skill packages must contain SKILL.md.', error: 'invalid-package' }
    }

    try {
      if (!existsSync(recipePath)) return this.importExternalMarkdownSkill(sourceDir, skillPath)
      const sourceRecipe = SkillRecipeSchema.parse(JSON.parse(readFileSync(recipePath, 'utf8')))
      const sourceBody = sanitizeSkillBodyForStorage(readSkillBody(readFileSync(skillPath, 'utf8')))
      const now = Date.now()
      const id = `recording/${new Date(now).toISOString().slice(0, 10)}/${randomUUID()}`
      const recipe: SkillRecipe = prepareRecipeForStorage({
        ...sourceRecipe,
        id,
        source: 'recording',
        updatedAt: now
      })
      const audit = auditSkillPackage(recipe, sourceBody)
      if (!audit.ok) return { ok: false, path: sourceDir, message: 'Skill import failed audit.', audit, error: 'skill-audit-failed' }
      const domainDir = domainOf(recipe.sourceUrl) || 'unknown-domain'
      const destDir = join(this.skillsDir, domainDir, `${now}-${slugify(recipe.name)}`)
      mkdirSync(join(destDir, 'agents'), { recursive: true })
      writeFileSync(join(destDir, 'recipe.json'), JSON.stringify(recipe, null, 2), 'utf8')
      writeFileSync(
        join(destDir, 'SKILL.md'),
        buildSkillMarkdown({
          id,
          name: recipe.name,
          description: recipe.description,
          source: 'recording',
          aliases: recipe.aliases,
          shortcuts: recipe.shortcuts,
          keywords: recipe.keywords,
          triggers: recipe.triggers,
          inputs: recipe.inputs,
          body: sourceBody
        }),
        'utf8'
      )
      writeOpenAiSidecar(destDir, recipe.name, recipe.description)
      writePortableSkillDocs(destDir, recipe, sourceBody)
      writeSkillAuditFile(destDir, recipe, sourceBody)
      const summary = this.readSkillSummary(join(destDir, 'SKILL.md'))
      if (!summary) throw new Error('imported skill could not be read back')
      return { ok: true, skill: summary, path: destDir, message: `Imported ${summary.name}.`, audit }
    } catch (err) {
      return { ok: false, path: sourceDir, message: 'Skill import failed.', error: (err as Error).message }
    }
  }

  createRecordedSkill(params: CreateSkillParams): SkillSummary {
    const id = `recording/${new Date().toISOString().slice(0, 10)}/${randomUUID()}`
    const slug = slugify(params.name || 'recorded-skill')
    // Partition by recording domain: skills/<hostname>/<ts>-<slug>/. Different
    // domains therefore get separate skill directories.
    const domainDir = domainOf(params.recipe.sourceUrl) || 'unknown-domain'
    const dir = join(this.skillsDir, domainDir, `${Date.now()}-${slug}`)
    mkdirSync(join(dir, 'agents'), { recursive: true })
    const recipe: SkillRecipe = prepareRecipeForStorage({
      ...params.recipe,
      id,
      source: 'recording',
      updatedAt: Date.now()
    })
    const body = sanitizeSkillBodyForStorage(params.body)
    writeFileSync(join(dir, 'recipe.json'), JSON.stringify(recipe, null, 2), 'utf8')
    writeFileSync(
      join(dir, 'SKILL.md'),
      buildSkillMarkdown({
        id,
        name: params.name,
        description: params.description,
        source: 'recording',
        aliases: recipe.aliases,
        shortcuts: recipe.shortcuts,
        keywords: recipe.keywords,
        triggers: recipe.triggers,
        inputs: recipe.inputs,
        body
      }),
      'utf8'
    )
    writeOpenAiSidecar(dir, params.name, params.description)
    writePortableSkillDocs(dir, recipe, body)
    writeSkillAuditFile(dir, recipe, body)
    const summary = this.readSkillSummary(join(dir, 'SKILL.md'))
    if (!summary) throw new Error('created skill could not be read back')
    return summary
  }

  // Skill catalog for prompts. With a url, scope to that domain's recordings so
  // training/generation only sees + dedups against the current site's skills.
  promptContext(url?: string): string {
    const skills = url ? this.listSkillsForDomain(url) : this.listSkills()
    return skills
      .map((skill) => {
        const rel = relative(this.userDataDir, skill.path)
        const inputs = skill.inputs.map((input) => `${input.name}: ${input.label}`).join(', ') || 'none'
        const triggers = skill.triggers.join(', ') || 'none'
        return `- ${skill.id}\n  name: ${skill.name}\n  source: ${skill.source}\n  file: ${rel}\n  triggers: ${triggers}\n  inputs: ${inputs}\n  description: ${skill.description}`
      })
      .join('\n')
  }

  private ensureAgentGuidance(): void {
    const file = join(this.userDataDir, 'AGENTS.md')
    if (existsSync(file)) return
    mkdirSync(this.userDataDir, { recursive: true })
    writeFileSync(
      file,
      [
        '# Bitterless Maestro Runtime',
        '',
        'This directory is Electron userData for Bitterless Maestro.',
        '',
        '- Skills live under `skills/` and may include tenant-specific recordings.',
        '- Legacy skills may still be read from `.agents/skills/` for backward compatibility.',
        '- Treat trace data, recipes, URLs, form values, and network payloads as sensitive customer data.',
        '- Do not copy customer data into source repositories or global skill folders.',
        '- For business-flow questions, inspect relevant `SKILL.md` and `recipe.json` files in `skills/`.',
        '- Prefer deterministic recorded steps and captured network evidence over guessing.',
        ''
      ].join('\n'),
      'utf8'
    )
  }

  private removeRetiredBaselineSkill(): void {
    for (const root of this.skillRoots()) {
      const dir = join(root, RETIRED_BASELINE_SKILL_DIR)
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
    }
  }

  private backfillPortableSkillDocs(): void {
    if (this.portableDocsBackfilled) return
    this.portableDocsBackfilled = true
    const files = this.skillRoots().flatMap((dir) => walk(dir).filter((file) => file.endsWith('/SKILL.md')))
    for (const file of files) {
      const dir = dirname(file)
      const recipePath = join(dir, 'recipe.json')
      if (!existsSync(recipePath)) continue
      try {
        const recipe = SkillRecipeSchema.parse(JSON.parse(readFileSync(recipePath, 'utf8')))
        const body = readSkillBody(readFileSync(file, 'utf8'))
        if (!existsSync(join(dir, 'README.md')) || !existsSync(join(dir, 'AGENTS.md')) || !existsSync(join(dir, 'CLAUDE.md'))) {
          writePortableSkillDocs(dir, recipe, body)
        }
        if (!existsSync(join(dir, SKILL_AUDIT_FILE))) writeSkillAuditFile(dir, recipe, body)
      } catch {
        /* leave malformed legacy skills untouched */
      }
    }
  }

  private skillRoots(): string[] {
    return [this.skillsDir, this.legacySkillsDir]
  }

  private isInsideSkillRoot(targetDir: string): boolean {
    return this.skillRoots().some((root) => {
      const resolved = resolve(root)
      return targetDir === resolved || targetDir.startsWith(resolved + sep)
    })
  }

  private readSkillSummary(file: string): SkillSummary | null {
    try {
      const content = readFileSync(file, 'utf8')
      const frontmatter = readFrontmatter(content)
      const recipePath = join(file.replace(/SKILL\.md$/, ''), 'recipe.json')
      const recipe = existsSync(recipePath)
        ? SkillRecipeSchema.safeParse(JSON.parse(readFileSync(recipePath, 'utf8'))).data
        : undefined
      const source = normalizeSkillSource(frontmatter.coach_source) || (recipe?.source === 'recording' ? 'recording' : 'builtin')
      const stats = statSync(file)
      return {
        id: String(frontmatter.coach_id || xCoach(frontmatter).id || recipe?.id || file),
        name: String(frontmatter.coach_display_name || recipe?.name || frontmatter.title || frontmatter.name || 'Untitled Skill'),
        description: String(frontmatter.description || recipe?.description || ''),
        source,
        domain: domainOf(recipe?.sourceUrl) || String(frontmatter.coach_domain || xCoach(frontmatter).domain || ''),
        path: file,
        recipePath: existsSync(recipePath) ? recipePath : undefined,
        updatedAt: recipe?.updatedAt || stats.mtimeMs,
        inputs: recipe?.inputs || parseSkillInputs(frontmatter),
        triggers: uniqueStrings([
          ...asStringList(frontmatter.coach_triggers),
          ...(recipe?.triggers || []),
          ...asStringList(frontmatter.aliases),
          ...asStringList(frontmatter.shortcuts),
          ...asStringList(frontmatter.keywords)
        ])
      }
    } catch {
      return null
    }
  }

  private importExternalMarkdownSkill(sourceDir: string, skillPath: string): SkillImportResult {
    const content = readFileSync(skillPath, 'utf8')
    const frontmatter = readFrontmatter(content)
    const sourceBody = sanitizeSkillBodyForStorage(readSkillBody(content))
    const now = Date.now()
    const id = `external/${new Date(now).toISOString().slice(0, 10)}/${randomUUID()}`
    const name = String(frontmatter.coach_display_name || frontmatter.title || frontmatter.name || 'External Skill')
    const description = String(frontmatter.description || `External markdown skill: ${name}`)
    const inputs = parseSkillInputs(frontmatter)
    const triggers = uniqueStrings([
      ...asStringList(frontmatter.coach_triggers),
      ...asStringList(frontmatter.aliases),
      ...asStringList(frontmatter.shortcuts),
      ...asStringList(frontmatter.keywords)
    ])
    const auditRecipe = emptyAuditRecipe({ id, name, description, inputs, triggers, updatedAt: now })
    const audit = auditSkillPackage(auditRecipe, sourceBody)
    if (!audit.ok) return { ok: false, path: sourceDir, message: 'External skill import failed audit.', audit, error: 'skill-audit-failed' }

    const destDir = join(this.skillsDir, 'external', `${now}-${slugify(name)}`)
    mkdirSync(join(destDir, 'agents'), { recursive: true })
    writeFileSync(
      join(destDir, 'SKILL.md'),
      buildExternalSkillMarkdown({
        frontmatter,
        id,
        name,
        description,
        triggers,
        inputs,
        body: sourceBody
      }),
      'utf8'
    )
    copyPortableFileIfExists(sourceDir, destDir, 'README.md')
    copyPortableFileIfExists(sourceDir, destDir, 'AGENTS.md')
    copyPortableFileIfExists(sourceDir, destDir, 'CLAUDE.md')
    if (existsSync(join(sourceDir, 'agents', 'openai.yaml'))) {
      copyFileSync(join(sourceDir, 'agents', 'openai.yaml'), join(destDir, 'agents', 'openai.yaml'))
    } else {
      writeOpenAiSidecar(destDir, name, description)
    }
    if (!existsSync(join(destDir, 'README.md'))) writeFileSync(join(destDir, 'README.md'), buildExternalSkillReadme(name, description), 'utf8')
    if (!existsSync(join(destDir, 'AGENTS.md'))) writeFileSync(join(destDir, 'AGENTS.md'), buildExternalAgentGuidance(name, description), 'utf8')
    if (!existsSync(join(destDir, 'CLAUDE.md'))) writeFileSync(join(destDir, 'CLAUDE.md'), buildExternalAgentGuidance(name, description), 'utf8')
    writeFileSync(join(destDir, SKILL_AUDIT_FILE), JSON.stringify(audit, null, 2), 'utf8')
    writeFileSync(
      join(destDir, 'coach-import.json'),
      JSON.stringify(
        {
          version: 1,
          importedAt: now,
          source: 'external-markdown',
          runtime: 'external',
          skill: { id, name, description, triggers, inputs }
        },
        null,
        2
      ),
      'utf8'
    )
    const summary = this.readSkillSummary(join(destDir, 'SKILL.md'))
    if (!summary) throw new Error('imported external skill could not be read back')
    return {
      ok: true,
      skill: summary,
      path: destDir,
      message: `Imported external skill ${summary.name}. Coach can read it, but it has no runtime recipe yet.`,
      audit
    }
  }
}

function buildSkillMarkdown(params: {
  id: string
  name: string
  description: string
  source: 'builtin' | 'recording'
  aliases?: string[]
  shortcuts?: string[]
  keywords?: string[]
  triggers: string[]
  inputs: SkillInput[]
  body: string
}): string {
  const frontmatter = stringifyYaml(
    {
      name: slugify(params.name),
      description: params.description,
      title: params.name,
      aliases: params.aliases || [],
      shortcuts: params.shortcuts || [],
      keywords: params.keywords || [],
      coach_display_name: params.name,
      coach_id: params.id,
      coach_source: params.source,
      coach_triggers: params.triggers,
      'x-coach': {
        id: params.id,
        source: params.source,
        triggers: params.triggers,
        inputs: params.inputs.map((input) => ({
          path: input.name,
          label: input.label,
          required: input.required,
          example: input.example
        }))
      }
    },
    { lineWidth: 100 }
  ).trim()
  return [
    '---',
    frontmatter,
    '---',
    '',
    params.body.trim(),
    ''
  ].join('\n')
}

function buildExternalSkillMarkdown(params: {
  frontmatter: Record<string, any>
  id: string
  name: string
  description: string
  triggers: string[]
  inputs: SkillInput[]
  body: string
}): string {
  const coach = xCoach(params.frontmatter)
  const frontmatter = stringifyYaml(
    {
      ...params.frontmatter,
      name: String(params.frontmatter.name || slugify(params.name)),
      description: params.description,
      title: String(params.frontmatter.title || params.name),
      coach_display_name: params.name,
      coach_id: params.id,
      coach_source: 'external',
      coach_domain: 'external',
      coach_triggers: params.triggers,
      'x-coach': {
        ...coach,
        id: params.id,
        source: 'external',
        domain: 'external',
        runtime: 'external-markdown',
        inputs: params.inputs.map((input) => ({
          path: input.name,
          label: input.label,
          required: input.required,
          example: input.example
        }))
      }
    },
    { lineWidth: 100 }
  ).trim()
  return [
    '---',
    frontmatter,
    '---',
    '',
    params.body.trim(),
    ''
  ].join('\n')
}

function prepareRecipeForStorage(recipe: SkillRecipe): SkillRecipe {
  const redacted = redactRecipeForStorage(recipe)
  return { ...redacted, script: sanitizeSkillScriptForStorage(redacted.script) }
}

function writeSkillAuditFile(dir: string, recipe: SkillRecipe, body: string) {
  const audit = auditSkillPackage(recipe, body)
  writeFileSync(join(dir, SKILL_AUDIT_FILE), JSON.stringify(audit, null, 2), 'utf8')
  return audit
}

function emptyExportRecipe(skill: SkillSummary): SkillRecipe {
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description || 'Portable Coach skill.',
    source: skill.source === 'recording' ? 'recording' : 'builtin',
    createdAt: skill.updatedAt || Date.now(),
    updatedAt: skill.updatedAt || Date.now(),
    inputs: skill.inputs,
    aliases: [],
    shortcuts: [],
    keywords: [],
    triggers: skill.triggers,
    steps: [],
    network: [],
    snapshots: []
  }
}

function emptyAuditRecipe(params: {
  id: string
  name: string
  description: string
  inputs: SkillInput[]
  triggers: string[]
  updatedAt: number
}): SkillRecipe {
  return {
    id: params.id,
    name: params.name,
    description: params.description || 'External markdown skill.',
    source: 'builtin',
    createdAt: params.updatedAt,
    updatedAt: params.updatedAt,
    inputs: params.inputs,
    aliases: [],
    shortcuts: [],
    keywords: [],
    triggers: params.triggers,
    steps: [],
    network: [],
    snapshots: []
  }
}

function writeOpenAiSidecar(dir: string, displayName: string, description: string): void {
  mkdirSync(join(dir, 'agents'), { recursive: true })
  const yaml = stringifyYaml(
    {
      interface: {
        display_name: displayName,
        short_description: description.slice(0, 90),
        default_prompt: `Use this Coach skill: ${displayName}`
      }
    },
    { lineWidth: 100 }
  )
  writeFileSync(join(dir, 'agents', 'openai.yaml'), yaml, 'utf8')
}

function writePortableSkillDocs(dir: string, recipe: SkillRecipe, body: string): void {
  const agentGuidance = buildSkillAgentGuidance(recipe, body)
  writeFileSync(join(dir, 'README.md'), buildSkillReadme(recipe), 'utf8')
  writeFileSync(join(dir, 'AGENTS.md'), agentGuidance, 'utf8')
  writeFileSync(join(dir, 'CLAUDE.md'), agentGuidance, 'utf8')
}

function readSkillBody(content: string): string {
  return content.replace(/^﻿?---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim()
}

function buildSkillReadme(recipe: SkillRecipe): string {
  const inputs = recipe.inputs.length
    ? [
        '| Name | Type | Required | Description |',
        '| --- | --- | --- | --- |',
        ...recipe.inputs.map((input) =>
          `| ${escapeMd(input.name)} | ${escapeMd(input.type || 'string')} | ${input.required ? 'yes' : 'no'} | ${escapeMd(input.label || input.name)} |`
        )
      ].join('\n')
    : 'No declared inputs.'
  const aliases = [...(recipe.aliases || []), ...(recipe.shortcuts || []), ...(recipe.keywords || []), ...(recipe.triggers || [])]
  return [
    `# ${recipe.name}`,
    '',
    recipe.description,
    '',
    '## Portable Files',
    '',
    '- `SKILL.md` is the portable skill card for agents that understand Markdown skills.',
    '- `recipe.json` is the Coach runtime recipe. It is redacted and should not contain captured tokens, cookies, or patient values.',
    '- `agents/openai.yaml` is the OpenAI/Codex UI sidecar.',
    '- `AGENTS.md` gives generic agent instructions when this directory is opened as a workspace.',
    '- `CLAUDE.md` mirrors `AGENTS.md` for Claude-style workspace loading.',
    '',
    '## Inputs',
    '',
    inputs,
    '',
    '## Discovery',
    '',
    aliases.length ? aliases.map((item) => `- ${item}`).join('\n') : 'No aliases or trigger phrases.',
    '',
    '## Runtime Notes',
    '',
    '- Prefer the scripted/API path when `recipe.json` has a `script` or write API evidence.',
    '- Resolve authentication from the live browser session at execution time. Do not reuse recorded header values.',
    '- Use UI steps only when no reliable API path exists or when the script explicitly needs the page.',
    ''
  ].join('\n')
}

function buildSkillAgentGuidance(recipe: SkillRecipe, body: string): string {
  const inputs = recipe.inputs.map((input) => `- ${input.name}${input.required ? ' (required)' : ''}: ${input.label}`).join('\n') || '- none'
  return [
    `# ${recipe.name}`,
    '',
    recipe.description,
    '',
    'Use this directory as a portable Coach skill package.',
    '',
    '## Read Order',
    '',
    '1. Read `SKILL.md` for the human/business procedure.',
    '2. Read `recipe.json` for the redacted runtime contract, inputs, UI flow, API evidence, and optional script.',
    '3. Do not assume recorded values are valid live values; collect new input from the user.',
    '',
    '## Inputs',
    '',
    inputs,
    '',
    '## Execution Rules',
    '',
    '- If `recipe.json.script` exists, treat it as the primary automation recipe.',
    '- If API write evidence exists, prefer a live authenticated API call over UI automation.',
    '- Resolve cookies/tokens from the live browser/session at execution time; never store or replay captured auth values.',
    '- If only UI evidence exists, use the UI flow as a guide and observe the page between steps.',
    '- Protect customer data. Do not copy patient identifiers, tokens, headers, or payload values into source repos.',
    '',
    '## Skill Body Snapshot',
    '',
    body.trim() || '(empty)',
    ''
  ].join('\n')
}

function buildExternalSkillReadme(name: string, description: string): string {
  return [
    `# ${name}`,
    '',
    description,
    '',
    'This package was imported as an external markdown skill.',
    '',
    '- `SKILL.md` is available for agent reading and editing.',
    '- No `recipe.json` is present, so Coach will not run it through `run_skill_script` or blind UI replay.',
    '- Record or ingest this workflow inside Coach to generate a Coach runtime recipe.',
    ''
  ].join('\n')
}

function buildExternalAgentGuidance(name: string, description: string): string {
  return [
    `# ${name}`,
    '',
    description,
    '',
    'Use `SKILL.md` as the source of truth for this external skill.',
    '',
    'This directory does not include a Coach `recipe.json`; treat it as portable agent guidance, not as an executable Coach replay package.',
    ''
  ].join('\n')
}

function escapeMd(value: string): string {
  return String(value || '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
}

function readFrontmatter(content: string): Record<string, any> {
  const match = content.match(/^---\n([\s\S]*?)\n---/)
  if (!match) return {}
  const parsed = parseYaml(match[1])
  return parsed && typeof parsed === 'object' ? (parsed as Record<string, any>) : {}
}

function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean)
  if (typeof value === 'string' && value.trim()) return [value.trim()]
  return []
}

function uniqueStrings(values: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of values.map((value) => String(value || '').trim()).filter(Boolean)) {
    const key = item.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}

function normalizeSkillSource(value: unknown): SkillSource | '' {
  return value === 'recording' || value === 'builtin' || value === 'external' ? value : ''
}

function xCoach(frontmatter: Record<string, any>): Record<string, any> {
  const value = frontmatter['x-coach']
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {}
}

function parseSkillInputs(frontmatter: Record<string, any>): SkillInput[] {
  const raw = xCoach(frontmatter).inputs || frontmatter.inputs
  if (!raw) return []
  if (Array.isArray(raw)) {
    return raw.map(parseSkillInput).filter((input): input is SkillInput => Boolean(input))
  }
  if (typeof raw === 'object') {
    return Object.entries(raw as Record<string, unknown>)
      .map(([name, value]) => parseSkillInput({ name, ...(value && typeof value === 'object' ? value as Record<string, unknown> : { label: value }) }))
      .filter((input): input is SkillInput => Boolean(input))
  }
  return []
}

function parseSkillInput(value: unknown): SkillInput | null {
  if (!value || typeof value !== 'object') return null
  const rec = value as Record<string, unknown>
  const name = String(rec.name || rec.path || '').trim()
  if (!name) return null
  const type = rec.type === 'number' || rec.type === 'boolean' || rec.type === 'enum' ? rec.type : 'string'
  const item: SkillInput = {
    name,
    label: String(rec.label || rec.description || name),
    required: rec.required !== false,
    type
  }
  if (typeof rec.example === 'string') item.example = rec.example
  if (Array.isArray(rec.enum)) item.enum = rec.enum.map(String).filter(Boolean)
  if (typeof rec.pattern === 'string') item.pattern = rec.pattern
  return item
}

function copyPortableFileIfExists(sourceDir: string, destDir: string, relativePath: string): boolean {
  const source = join(sourceDir, ...relativePath.split('/'))
  if (!existsSync(source)) return false
  const dest = join(destDir, ...relativePath.split('/'))
  mkdirSync(dirname(dest), { recursive: true })
  copyFileSync(source, dest)
  return true
}

function walk(dir: string): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    // Archived prior skill versions live under <skill>/archive/<ts>/ and must not
    // surface as live skills.
    if (entry === 'archive') continue
    const file = join(dir, entry)
    const stat = statSync(file)
    if (stat.isDirectory()) out.push(...walk(file))
    else out.push(file)
  }
  return out
}

function formatArchiveTs(date: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())} ${p(date.getHours())}-${p(date.getMinutes())}-${p(date.getSeconds())}`
}

function uniqueExportDir(root: string, name: string): string {
  const base = join(root, name || 'coach-skill')
  if (!existsSync(base)) return base
  for (let i = 2; i <= 99; i += 1) {
    const candidate = `${base}-${i}`
    if (!existsSync(candidate)) return candidate
  }
  return `${base}-${Date.now()}`
}

// Canonical domain key for a skill: the lowercased hostname of its source URL.
// Used for both the on-disk partition (skills/<domain>/) and current-page
// matching. Port is intentionally ignored (a domain is the host, not host:port —
// e.g. the local demo's random port must not fragment its skills).
function domainOf(url: string | undefined): string {
  if (!url) return ''
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ''
  }
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'recorded-skill'
}
