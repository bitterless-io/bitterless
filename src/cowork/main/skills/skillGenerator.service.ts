import type { CodexDebugEvent, SkillCreateResult, SkillInput, SkillSummary } from '@cowork-shared/coach.api'
import type { TraceEvent } from '@cowork-shared/trace.types'
import type { BaseAgent } from '@cowork-main/agent/BaseAgent'
import type { AuthHint } from '@cowork-main/drive/replayEngine'
import { SkillRegistryService } from './skillRegistry.service'
import type { SkillRecipe } from './skillRecipe.types'
import { redactRecipeForStorage } from './recipeRedact'
import { writeApiProfile } from './apiProfile.service'

interface DraftInput {
  name?: string
  label?: string
  required?: boolean
  type?: 'string' | 'number' | 'boolean' | 'enum'
  enum?: string[]
  pattern?: string
  example?: string
}

interface CodexSkillDraft {
  name?: string
  description?: string
  aliases?: string[]
  shortcuts?: string[]
  keywords?: string[]
  triggers?: string[]
  detail?: string
  notes?: string
  fieldRules?: string
  // Parametric Playwright-style automation script (page.*/api.fetch + vars.*). NO concrete
  // values, NO headers (the ApiDriver applies the domain profile). Runs via run_skill_script.
  script?: string
  // Input slots WITH constraints → become recipe.inputs + a runtime zod schema.
  inputs?: DraftInput[]
}

export class SkillGeneratorService {
  constructor(
    private readonly registry: SkillRegistryService,
    private readonly pi: BaseAgent,
    private readonly onDebug?: (event: CodexDebugEvent) => void
  ) {}

  async summarize(
    events: TraceEvent[],
    currentUrl: string,
    guidance?: string,
    fieldRules?: string,
    specNotes?: string
  ): Promise<SkillCreateResult> {
    const startedAt = Date.now()
    const actions = events.filter((event): event is Extract<TraceEvent, { kind: 'action' }> => event.kind === 'action')
    const network = events.filter((event) => event.kind === 'net.request' || event.kind === 'net.response')
    const snapshots = collectSnapshots(events)
    this.debug({
      phase: 'start',
      level: 'info',
      message: 'Summarizing capture into a skill.',
      detail: {
        currentUrl,
        totalEvents: events.length,
        uiEvents: actions.length,
        networkEvents: network.length,
        snapshots: snapshots.length
      }
    })
    if (actions.length === 0 && network.length === 0 && snapshots.length === 0) {
      this.debug({
        phase: 'empty',
        level: 'warn',
        message: 'No capture events to summarize.',
        detail: { durationMs: Date.now() - startedAt }
      })
      return { ok: false, message: 'No capture events to summarize.', error: 'empty-recording' }
    }

    const cleanedFieldRules = cleanRules(fieldRules)
    const drafted = await this.askCodexForDraft(events, currentUrl, guidance, cleanedFieldRules, specNotes)
    // Ingest MUST go through the LLM — if it couldn't generate the skill card, fail
    // loudly instead of creating a skill from deterministic metadata.
    if (!drafted.ok) {
      const message = `Skill generation needs the LLM, which failed: ${drafted.error}. Fix the model (sign in / switch provider / check quota) from the selector, then ingest again.`
      this.debug({
        phase: 'failed',
        level: 'warn',
        message: 'Skill generation failed.',
        detail: { durationMs: Date.now() - startedAt, error: drafted.error || 'llm-required' }
      })
      return {
        ok: false,
        message,
        error: 'llm-required'
      }
    }
    const draft = drafted.draft
    // The LLM ran; guidance/URL still backfill any field the draft left blank.
    const guidanceText = guidance?.trim() || ''
    const guidanceName = cleanTitle(guidanceText.split('\n')[0])
    const fallbackName = inferName(actions, currentUrl)
    const name = cleanTitle(draft.name) || guidanceName || fallbackName
    const description =
      cleanText(draft.description) ||
      cleanText(guidanceText) ||
      `Recorded workflow with ${actions.length} UI steps and ${network.length} network events.`
    // Prefer the LLM's declared inputs (they carry zod constraints + match the script's vars.*);
    // fall back to inputs inferred from the recorded fill/select controls.
    const inputs = normalizeDraftInputs(draft.inputs) || inferInputs(actions)
    const aliases = normalizeList(draft.aliases, 8)
    const shortcuts = normalizeList(draft.shortcuts, 8, buildDefaultShortcuts(name, inputs))
    const keywords = normalizeList(draft.keywords, 16, inferTriggers(currentUrl, name))
    const triggers = normalizeList([...(draft.triggers || []), ...aliases, ...keywords, ...inferTriggers(currentUrl, name)], 12)
    const builtRecipe = buildRecipe({
      name,
      description,
      aliases,
      shortcuts,
      keywords,
      triggers,
      inputs,
      actions,
      events,
      currentUrl,
      snapshots,
      fieldRules: cleanedFieldRules,
      detail: cleanDetail(draft.detail),
      notes: draft.notes,
      script: cleanScript(draft.script)
    })
    // Strip ALL captured values (auth, typed inputs, request/response bodies, snapshot values)
    // before the recipe is used for the skill body OR persisted — skills store method, not data.
    const recipe = redactRecipeForStorage(builtRecipe)
    const body = buildSkillBody(recipe, draft)
    // Learn the domain's shared, VALUE-FREE header convention (the ApiDriver applies it to every
    // api.fetch) — once per host. Empty for cookie-only sites; nothing sensitive persisted.
    writeApiProfile(safeHost(currentUrl), deriveAuthHints(recipe))
    // Backstop: the "no concrete values in script" rule is enforced by the prompt; warn if a
    // generation slipped a literal token/JWT/long-id in (should be vars.* only).
    if (recipe.script && /eyJ[A-Za-z0-9_-]{12,}|bearer\s+\S{8,}|\b[a-f0-9]{32,}\b/i.test(recipe.script)) {
      this.debug({
        phase: 'script-literal-warning',
        level: 'warn',
        message: 'Generated script may contain a hardcoded secret/long literal — it should use vars.* only.',
        detail: { skill: name }
      })
    }

    // Dedup: same-named recording ON THE SAME DOMAIN -> new VERSION (archive the
    // old, overwrite in place) instead of a duplicate skill. New name (or same
    // name on a different domain) -> create fresh.
    const existing = this.registry.findRecordingByName(name, currentUrl)
    if (existing) {
      this.registry.archiveSkill(existing.id)
      const updatedRecipe: SkillRecipe = { ...recipe, id: existing.id, source: 'recording', updatedAt: Date.now() }
      const skill = this.registry.overwriteSkill(existing.id, { recipe: updatedRecipe, body })
      if (!skill) {
        this.debug({
          phase: 'failed',
          level: 'error',
          message: 'Failed to update existing skill.',
          detail: { durationMs: Date.now() - startedAt, skillId: existing.id, error: 'update-failed' }
        })
        return { ok: false, message: 'Failed to update existing skill.', error: 'update-failed' }
      }
      this.debug({
        phase: 'versioned',
        level: 'info',
        message: `Updated skill ${skill.name} (archived previous).`,
        detail: { durationMs: Date.now() - startedAt, skillId: skill.id }
      })
      return { ok: true, skill, message: `Updated ${skill.name} (archived previous version)` }
    }

    const skill = this.registry.createRecordedSkill({ name, description, triggers, inputs, recipe, body })
    this.debug({
      phase: 'created',
      level: 'info',
      message: `Created skill ${skill.name}.`,
      detail: { durationMs: Date.now() - startedAt, skillId: skill.id, path: skill.path, recipePath: skill.recipePath, inputs: skill.inputs }
    })
    return { ok: true, skill, message: `Created skill ${skill.name}` }
  }

  // Ingest the recording into ONE OR MORE skills. First asks the LLM to SPLIT the workflow into its
  // distinct, independently-runnable skills, then generates + saves each via summarize() — the same
  // tested single-skill path. Returns every skill created. Falls back to a single skill when the
  // split yields ≤1 part or the plan call fails.
  async summarizeMulti(
    events: TraceEvent[],
    currentUrl: string,
    specNotes?: string
  ): Promise<{ ok: boolean; skills: SkillSummary[]; message: string; error?: string }> {
    const startedAt = Date.now()
    const hasContent = events.some(
      (e) => e.kind === 'action' || e.kind === 'net.request' || e.kind === 'net.response' || e.kind === 'snapshot'
    )
    this.debug({
      phase: 'multi-start',
      level: 'info',
      message: 'Planning capture ingest into one or more skills.',
      detail: { currentUrl, totalEvents: events.length }
    })
    if (!hasContent) {
      this.debug({
        phase: 'multi-empty',
        level: 'warn',
        message: 'No capture events to ingest.',
        detail: { durationMs: Date.now() - startedAt }
      })
      return { ok: false, skills: [], message: 'No capture events to ingest.', error: 'empty-recording' }
    }

    const plan = await this.askCodexForSplitPlan(events, currentUrl, specNotes)
    const items = plan.ok ? plan.items : []
    // ≤1 part (or the plan call failed) → one skill via the existing path.
    if (items.length <= 1) {
      const single = await this.summarize(events, currentUrl, items[0]?.guidance, undefined, specNotes)
      this.debug({
        phase: single.ok ? 'multi-single' : 'multi-failed',
        level: single.ok ? 'info' : 'warn',
        message: single.ok ? 'Multi-ingest fell back to one generated skill.' : 'Multi-ingest fallback failed.',
        detail: { durationMs: Date.now() - startedAt, skillId: single.skill?.id, error: single.error }
      })
      return single.ok && single.skill
        ? { ok: true, skills: [single.skill], message: single.message }
        : { ok: false, skills: [], message: single.message, error: single.error }
    }

    const skills: SkillSummary[] = []
    const lines: string[] = []
    for (const item of items) {
      const itemStartedAt = Date.now()
      this.debug({
        phase: 'multi-item-start',
        level: 'info',
        message: `Generating planned skill "${item.name}".`,
        detail: { name: item.name, description: item.description }
      })
      const guidance = [`Skill: ${item.name}`, item.description, item.guidance, 'Generate a skill for ONLY this part of the capture.']
        .filter(Boolean)
        .join('\n')
      const r = await this.summarize(events, currentUrl, guidance, undefined, specNotes)
      if (r.ok && r.skill) {
        skills.push(r.skill)
        lines.push(`- ${r.skill.name}: ${r.skill.description}`)
        this.debug({
          phase: 'multi-item-created',
          level: 'info',
          message: `Generated planned skill "${r.skill.name}".`,
          detail: { durationMs: Date.now() - itemStartedAt, skillId: r.skill.id }
        })
      } else {
        this.debug({
          phase: 'multi-skip',
          level: 'warn',
          message: `Skipped planned skill "${item.name}"`,
          detail: { durationMs: Date.now() - itemStartedAt, error: r.error }
        })
      }
    }
    if (!skills.length) {
      this.debug({
        phase: 'multi-failed',
        level: 'warn',
        message: 'Ingest produced no skills.',
        detail: { durationMs: Date.now() - startedAt }
      })
      return { ok: false, skills: [], message: 'Ingest produced no skills.', error: 'no-skills' }
    }
    this.debug({
      phase: 'multi-created',
      level: 'info',
      message: `Generated ${skills.length} skill(s) from the capture.`,
      detail: { durationMs: Date.now() - startedAt, skillIds: skills.map((skill) => skill.id) }
    })
    return { ok: true, skills, message: `Generated ${skills.length} skill(s) from the capture:\n${lines.join('\n')}` }
  }

  private async askCodexForDraft(
    events: TraceEvent[],
    currentUrl: string,
    guidance?: string,
    fieldRules?: string,
    specNotes?: string
  ): Promise<{ ok: boolean; draft: CodexSkillDraft; error?: string }> {
    const trimmedGuidance = guidance?.trim()
    const actions = events.filter((event): event is Extract<TraceEvent, { kind: 'action' }> => event.kind === 'action')
    const inferredInputs = inferInputs(actions)
    const apiHints = summarizeApiForPrompt(events)
    const snapshotHints = summarizeSnapshotsForPrompt(events)
    const prompt = [
      'You are Micromeet Cowork. Convert this browser capture into a reusable business skill card.',
      '',
      'Return STRICT JSON ONLY with this exact shape:',
      '{',
      '  "name": "<short stable title, e.g. Patient Booking>",',
      '  "description": "<one sentence: business outcome, not a capture summary>",',
      '  "aliases": ["<alternate skill names users may say>"],',
      '  "shortcuts": ["<natural-language invocation examples with placeholders>"],',
      '  "keywords": ["<domain keywords for retrieval>"],',
      '  "triggers": ["<short trigger phrases>"],',
      '  "inputs": [{"name":"patient_name","label":"Patient name","required":true,"type":"string","pattern":"<optional regex>","enum":["<optional fixed options>"]}],',
      '  "script": "<parametric automation using page.*/api.fetch + vars.<input> — see Script rules>",',
      '  "detail": "<concise use/execution notes for an agent>",',
      '  "notes": "<important caveats, verification, missing submit/API observations>"',
      '}',
      '',
      'Rules:',
      '- ONE skill = ONE outcome/endpoint. If the capture spans several INDEPENDENT API actions, this card is for the PRIMARY one; list the others in notes (each becomes its own skill).',
      '- PREFER API. If a write endpoint was observed, the script calls it via api.fetch (reuses the live session); use page.* UI steps only for what has no API path.',
      '- Describe HOW TO USE as an operating guide, not a raw capture dump. Keep name/title business-oriented and free of personal identifiers.',
      '- NO concrete values ANYWHERE (no sample names/ids/tokens/cookies/payloads) — only vars.<input> slots + ids grounded live at run time.',
      '- Use aliases/shortcuts/keywords for discovery; include multilingual terms when evident. If no final submit/write was captured, say so in notes.',
      '',
      'Script rules — the "script" field is JavaScript run by run_skill_script with `page`, `api`, `vars` in scope (no require/import):',
      '- Reference inputs as vars.<name>. Names MUST match the inputs[] you declare.',
      '- UI: await page.click(sel) | page.fill(sel, vars.x) | page.select(sel, vars.x) | page.check(sel, bool) | page.submit(sel) | page.waitFor(sel) | page.read(sel) | page.exists(sel). page.select matches native option value OR visible text; custom comboboxes try to open and click the matching visible option. Prefer stable selectors: [name="…"], then role/id. Clicks are real trusted clicks.',
      '- API: await api.fetch({ method, path, query, body }) — reuses the live login. DO NOT set headers/auth; the domain profile applies them automatically. GROUND ids first (api.fetch an option-read, pick the match for vars.x, use its id in the write body); never invent ids.',
      '- ADAPT to live data: branch on page.exists(...) / read() values; re-observe only across navigations, batch same-page work.',
      '- Example: await page.waitFor(\'[name="patient"]\'); await page.fill(\'[name="patient"]\', vars.patient); const slots = await api.fetch({ method:\'GET\', path:\'/api/slots\', query:{ date: vars.date } }); const slot = slots.find(s => s.available); await api.fetch({ method:\'POST\', path:\'/api/book\', body:{ patient: vars.patient, slot: slot.id } });',
      '',
      '- inputs: declare each slot with a constraint (type: string|number|boolean|enum; optional pattern/enum; required). These validate the caller\'s inputs (zod) BEFORE the script runs.',
      trimmedGuidance
        ? `\nOperator goal/guidance. Let this steer title, aliases, shortcuts, keywords, detail, and notes:\n"""${trimmedGuidance}"""\n`
        : '',
      fieldRules
        ? `\nOperator field rules (normalization / validation / mapping the invoking agent must apply before executing). Reflect them in detail/notes; do NOT invent new rules:\n"""${fieldRules}"""\n`
        : '',
      specNotes
        ? `\nOperator notes on specific recorded steps (per-record "spec" — what each step means / how to treat it). Use them to interpret intent and write detail/notes; do NOT echo raw values:\n${specNotes}\n`
        : '',
      `Current URL: ${currentUrl}`,
      '',
      'Canonical input paths inferred from UI controls (do not rewrite as Zod; use these names when writing shortcuts/detail):',
      inferredInputs.map((input) => `- ${input.name}: ${input.label}${input.required ? ' (required)' : ''}`).join('\n') || '- none',
      '',
      'API endpoints observed (summarized, no payload values):',
      apiHints || '- none',
      '',
      'Page structure snapshots captured (element/form layout, no data values):',
      snapshotHints || '- none',
      '',
      'Existing Coach skills for THIS domain (avoid duplicates; same name updates in place):',
      this.registry.promptContext(currentUrl) || '(none)',
      '',
      'Recent trace evidence for intent only:',
      traceForPrompt(events)
    ].join('\n')
    this.debug({
      phase: 'prompt',
      level: 'debug',
      message: 'Built Codex summarize prompt.',
      detail: { promptChars: prompt.length, promptPreview: previewText(prompt, 12_000) }
    })
    const result = await this.pi.oneShot(prompt, 90_000)
    // Ingest is LLM-mandatory: a provider rejection (e.g. Codex unreachable / a
    // Cloudflare block, which comes back as ok:true with empty text + errorMessage)
    // or a non-JSON reply is a FAILURE — do not fabricate a skill from metadata.
    if (result.errorMessage || !result.ok) {
      const error = result.errorMessage || result.error || 'LLM unavailable'
      this.debug({ phase: 'llm-error', level: 'warn', message: 'LLM skill generation failed.', detail: { error } })
      return { ok: false, draft: {}, error }
    }
    const draft = parseDraftJson(result.text)
    if (!draft) {
      this.debug({
        phase: 'parse-error',
        level: 'warn',
        message: 'LLM response was not valid skill JSON.',
        detail: { responsePreview: previewText(result.text, 4_000) }
      })
      return { ok: false, draft: {}, error: 'LLM did not return a valid skill draft (no JSON)' }
    }
    this.debug({ phase: 'parsed', level: 'info', message: 'Parsed Codex skill draft JSON.', detail: draft })
    return { ok: true, draft }
  }

  // Plan the multi-skill split: ask the LLM which DISTINCT skills the recording contains, so each
  // can be generated separately by summarize(). Returns [] (→ caller falls back to a single skill)
  // on any LLM/parse failure.
  private async askCodexForSplitPlan(
    events: TraceEvent[],
    currentUrl: string,
    specNotes?: string
  ): Promise<{ ok: boolean; items: { name: string; description: string; guidance: string }[]; error?: string }> {
    const startedAt = Date.now()
    const prompt = [
      'You are Micromeet Cowork. This is ONE browser capture that may contain SEVERAL distinct,',
      'independently-runnable skills — e.g. a UI form/booking flow, a write via an API endpoint, a',
      'data lookup/report. Identify those distinct skills so each can be generated on its own.',
      '',
      'Return STRICT JSON ONLY — an ARRAY:',
      '[{ "name": "<short business title>", "description": "<one-sentence outcome>", "guidance": "<which part of the capture this skill covers and how to scope it: which UI steps / which API endpoint / which lookup>" }]',
      '',
      'Rules:',
      '- One skill = one outcome/endpoint. Separate independent UI flows, API writes, and lookups into their OWN skills.',
      '- Prefer 1–4 skills. If the capture is genuinely a single workflow, return exactly ONE.',
      '- Do NOT invent skills the capture does not support. No personal data in names/descriptions.',
      '',
      specNotes ? `Operator notes / flagged evidence:\n${specNotes}\n` : '',
      `Current URL: ${currentUrl}`,
      '',
      'API endpoints observed:',
      summarizeApiForPrompt(events) || '- none',
      '',
      'Page structure snapshots captured:',
      summarizeSnapshotsForPrompt(events) || '- none',
      '',
      'Recent trace evidence:',
      traceForPrompt(events)
    ].join('\n')
    this.debug({
      phase: 'split-prompt',
      level: 'debug',
      message: 'Built Codex split-plan prompt.',
      detail: { promptChars: prompt.length, promptPreview: previewText(prompt, 8_000) }
    })
    const result = await this.pi.oneShot(prompt, 90_000)
    if (result.errorMessage || !result.ok) {
      this.debug({
        phase: 'split-error',
        level: 'warn',
        message: 'LLM split-plan failed.',
        detail: { durationMs: Date.now() - startedAt, error: result.errorMessage || result.error || 'LLM unavailable' }
      })
      return { ok: false, items: [], error: result.errorMessage || result.error || 'LLM unavailable' }
    }
    const match = result.text.match(/\[[\s\S]*\]/)
    if (!match) {
      this.debug({
        phase: 'split-parse-error',
        level: 'warn',
        message: 'LLM split-plan response did not contain a JSON array.',
        detail: { durationMs: Date.now() - startedAt, responsePreview: previewText(result.text, 4_000) }
      })
      return { ok: false, items: [], error: 'no JSON array in split plan' }
    }
    try {
      const arr = JSON.parse(match[0]) as unknown
      if (!Array.isArray(arr)) {
        this.debug({
          phase: 'split-parse-error',
          level: 'warn',
          message: 'LLM split-plan JSON was not an array.',
          detail: { durationMs: Date.now() - startedAt }
        })
        return { ok: false, items: [], error: 'split plan not an array' }
      }
      const items = arr
        .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
        .map((x) => ({
          name: String(x.name ?? '').trim(),
          description: String(x.description ?? '').trim(),
          guidance: String(x.guidance ?? x.scope ?? '').trim()
        }))
        .filter((x) => x.name || x.guidance)
      this.debug({
        phase: 'split-plan',
        level: 'info',
        message: `Split plan → ${items.length} skill(s).`,
        detail: { durationMs: Date.now() - startedAt, items }
      })
      return { ok: true, items }
    } catch {
      this.debug({
        phase: 'split-parse-error',
        level: 'warn',
        message: 'LLM split-plan JSON parse failed.',
        detail: { durationMs: Date.now() - startedAt }
      })
      return { ok: false, items: [], error: 'split plan JSON parse failed' }
    }
  }

  // Optimize an EXISTING skill: refine name/description/triggers/notes via Codex
  // (keeping the recorded steps + API workflow) and rewrite the skill in place.
  async train(skillId: string, guidance: string): Promise<SkillCreateResult> {
    const recipe = this.registry.readRecipe(skillId)
    if (!recipe) return { ok: false, message: 'Skill not found.', error: 'no-skill' }
    this.debug({ phase: 'train-start', level: 'info', message: `Optimizing skill ${recipe.name}.`, detail: { skillId } })

    const draft = await this.askCodexToRefine(recipe, guidance)
    const name = cleanTitle(draft.name) || recipe.name
    const description = cleanText(draft.description) || recipe.description
    const aliases = normalizeList(draft.aliases, 8, recipe.aliases)
    const shortcuts = normalizeList(draft.shortcuts, 8, recipe.shortcuts.length ? recipe.shortcuts : buildDefaultShortcuts(name, recipe.inputs))
    const keywords = normalizeList(draft.keywords, 16, recipe.keywords)
    const triggers =
      draft.triggers && draft.triggers.length
        ? normalizeList([...draft.triggers, ...aliases, ...keywords], 12)
        : normalizeList([...recipe.triggers, ...aliases, ...keywords], 12)
    const detail = cleanDetail(draft.detail) || recipe.detail
    const notes = normalizeNotes(draft.notes) ?? recipe.notes
    const fieldRules = cleanRules(draft.fieldRules) ?? recipe.fieldRules
    // Re-redact on save too, so training an older (pre-redaction) skill also strips any
    // captured values still lingering in its recipe.
    const updatedRecipe: SkillRecipe = redactRecipeForStorage({ ...recipe, name, description, aliases, shortcuts, keywords, triggers, detail, notes, fieldRules, updatedAt: Date.now() })
    const body = buildSkillBody(updatedRecipe, draft)

    this.registry.archiveSkill(skillId) // version the prior state before replacing
    const skill = this.registry.overwriteSkill(skillId, { recipe: updatedRecipe, body })
    if (!skill) return { ok: false, message: 'Failed to update skill.', error: 'update-failed' }
    this.debug({ phase: 'trained', level: 'info', message: `Optimized ${skill.name}.`, detail: { skillId } })
    return { ok: true, skill, message: `Optimized ${skill.name}` }
  }

  private async askCodexToRefine(recipe: SkillRecipe, guidance: string): Promise<CodexSkillDraft> {
    const steps =
      recipe.steps
        .map((s) => `- ${s.action} ${s.target.label || s.target.name || s.target.selector}`)
        .join('\n') || '(none)'
    const net =
      recipe.network
        .filter((n) => n.method)
        .slice(0, 12)
        .map((n) => `- ${(n.method || 'GET').toUpperCase()} ${n.url}`)
        .join('\n') || '(none)'
    const trimmed = guidance?.trim()
    const prompt = [
      'You are Micromeet Cowork. Improve this EXISTING skill\'s metadata. Keep the same recorded workflow;',
      'refine the name, description, aliases, shortcuts, keywords, triggers, detail, notes, and fieldRules so the skill is clearer and easier to match.',
      'Return JSON only with keys: name, description, aliases, shortcuts, keywords, triggers, detail, notes, fieldRules.',
      'Only change fieldRules if the operator explicitly asks; otherwise omit the key to keep the existing rules.',
      trimmed ? `\nOperator's optimization request:\n"""${trimmed}"""\n` : '',
      `Current name: ${recipe.name}`,
      `Current description: ${recipe.description}`,
      `Current triggers: ${recipe.triggers.join(', ') || '(none)'}`,
      `Inputs: ${recipe.inputs.map((i) => i.name).join(', ') || '(none)'}`,
      `Current field rules: ${recipe.fieldRules || '(none)'}`,
      '',
      'Steps:',
      steps,
      'API workflow:',
      net,
      'Current notes:',
      recipe.notes || '(none)'
    ].join('\n')
    const result = await this.pi.oneShot(prompt, 90_000)
    if (!result.ok) {
      this.debug({ phase: 'train-fallback', level: 'warn', message: 'Codex refine unavailable.', detail: { error: result.error } })
      return {}
    }
    return parseDraftJson(result.text) || { notes: result.text.slice(0, 1200) }
  }

  private debug(event: Omit<CodexDebugEvent, 'scope' | 'ts'>): void {
    this.onDebug?.({ ...event, scope: 'summarize', ts: Date.now() })
  }
}

function buildRecipe(params: {
  name: string
  description: string
  aliases: string[]
  shortcuts: string[]
  keywords: string[]
  triggers: string[]
  inputs: SkillInput[]
  actions: Extract<TraceEvent, { kind: 'action' }>[]
  events: TraceEvent[]
  currentUrl: string
  snapshots: SkillRecipe['snapshots']
  fieldRules?: string
  detail?: string
  notes?: string
  script?: string
}): SkillRecipe {
  const inputByLabel = new Map<string, string>()
  for (const input of params.inputs) inputByLabel.set(input.label, input.name)
  const now = Date.now()
  return {
    id: 'pending',
    name: params.name,
    description: params.description,
    source: 'recording',
    sourceUrl: params.currentUrl,
    createdAt: now,
    updatedAt: now,
    inputs: params.inputs,
    aliases: params.aliases,
    shortcuts: params.shortcuts,
    keywords: params.keywords,
    triggers: params.triggers,
    steps: params.actions.map((event) => {
      const label = event.step.target.label || event.step.target.name || event.step.target.placeholder || ''
      const variable = inputByLabel.get(label)
      return {
        action: event.step.action,
        target: event.step.target,
        valueTemplate: variable ? `{{${variable}}}` : event.step.value,
        originalValue: event.step.value,
        checked: event.step.checked,
        yaml: event.step.yaml,
        url: event.url
      }
    }),
    network: summarizeNetwork(params.events),
    snapshots: params.snapshots,
    fieldRules: params.fieldRules,
    detail: params.detail,
    notes: normalizeNotes(params.notes),
    script: params.script
  }
}

function buildSkillBody(recipe: SkillRecipe, draft: CodexSkillDraft): string {
  const apiContract = buildApiContract(recipe)
  return [
    `# ${recipe.name}`,
    '',
    recipe.description,
    '',
    recipe.aliases.length ? `Aliases: ${recipe.aliases.map((item) => `\`${item}\``).join(', ')}` : '',
    recipe.shortcuts.length ? `Shortcuts: ${recipe.shortcuts.map((item) => `\`${item}\``).join(', ')}` : '',
    recipe.keywords.length ? `Keywords: ${recipe.keywords.map((item) => `\`${item}\``).join(', ')}` : '',
    '',
    '## When to Use',
    '',
    `Use this skill when the user asks to ${recipe.description.toLowerCase()}`,
    recipe.triggers.length ? `Triggers: ${recipe.triggers.map((trigger) => `\`${trigger}\``).join(', ')}` : '',
    '',
    '## Input Contract',
    '',
    '```ts',
    buildInputContract(recipe),
    '```',
    '',
    'Canonical inputs are stored in `recipe.json`; this TypeScript view is generated for agent readability.',
    '',
    ...(recipe.fieldRules
      ? [
          '## Field Rules',
          '',
          'Apply these BEFORE executing: resolve, normalize, and validate every input against them, then ask for anything still missing or ambiguous. Only proceed once the rules are satisfied.',
          '',
          recipe.fieldRules,
          ''
        ]
      : []),
    '## API Contract',
    '',
    apiContract,
    '',
    ...(recipe.snapshots.length
      ? ['## Page Structure', '', buildSnapshotSection(recipe), '']
      : []),
    '## Execution Strategy',
    '',
    [
      '- Prefer API execution when the required write endpoint can be satisfied from grounded inputs and live option reads.',
      '- Fetch live option/read endpoints before authoring write calls; do not invent ids, codes, prices, or option values.',
      '- If API execution is not possible, replay the recorded UI steps from `recipe.json`.',
      '- Ask for missing required inputs instead of using recorded sample values.'
    ].join('\n'),
    '',
    '## Capture Artifact',
    '',
    '`recipe.json` contains the recorded UI steps and network evidence used for replay. Treat it as sensitive customer data; do not inline recorded sample values here.',
    '',
    recipe.detail ? '## Detail' : '',
    recipe.detail ? '' : '',
    recipe.detail || '',
    recipe.detail ? '' : '',
    '',
    '## Notes',
    '',
    normalizeNotes(draft.notes) || recipe.notes || 'Generated from a Coach capture.'
  ].filter((line, index, lines) => line || lines[index - 1] !== '').join('\n')
}

function buildInputContract(recipe: SkillRecipe): string {
  const tree = inputTree(recipe.inputs)
  return `type SkillInput = ${typeLiteral(tree, 0)}`
}

type InputNode = {
  input?: SkillInput
  children: Map<string, InputNode>
}

function inputTree(inputs: SkillInput[]): InputNode {
  const root: InputNode = { children: new Map() }
  for (const input of inputs) {
    const parts = input.name.split('.').map((part) => part.trim()).filter(Boolean)
    let node = root
    for (const part of parts.length ? parts : [input.name]) {
      let child = node.children.get(part)
      if (!child) {
        child = { children: new Map() }
        node.children.set(part, child)
      }
      node = child
    }
    node.input = input
  }
  return root
}

function typeLiteral(node: InputNode, depth: number): string {
  const indent = '  '.repeat(depth)
  const next = '  '.repeat(depth + 1)
  const entries = Array.from(node.children.entries())
  if (!entries.length) return '{}'
  const lines = entries.map(([key, child]) => {
    const optional = child.input && !child.input.required ? '?' : ''
    const comment = child.input
      ? ` // ${child.input.label}${child.input.example ? `; example format: ${child.input.example}` : ''}`
      : ''
    const type = child.children.size ? typeLiteral(child, depth + 1) : 'string'
    return `${next}${propertyName(key)}${optional}: ${type}${comment}`
  })
  return ['{', ...lines, `${indent}}`].join('\n')
}

function propertyName(key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : JSON.stringify(key)
}

function buildApiContract(recipe: SkillRecipe): string {
  const requests = recipe.network.filter((item) => item.method)
  if (!requests.length) return '- No API endpoints were recorded. Use UI replay from `recipe.json`.'

  const reads = requests.filter((item) => item.apiRole === 'option-read' || (!item.apiRole && item.method && /^GET$/i.test(item.method)))
  const writes = requests.filter((item) => item.apiRole === 'write' || (!item.apiRole && item.method && /^(POST|PUT|PATCH|DELETE)$/i.test(item.method)))
  const sections: string[] = []
  if (reads.length) {
    sections.push(
      [
        'Reads for live options/context:',
        ...dedupeEndpoints(reads)
          .slice(0, 12)
          .map((item) => `- \`${(item.method || 'GET').toUpperCase()} ${safePath(item.url)}\` (${apiContractMeta(item)})`)
      ].join('\n')
    )
  }
  if (writes.length) {
    sections.push(
      [
        'Writes this skill may execute:',
        ...dedupeEndpoints(writes)
          .slice(0, 8)
          .map((item) => {
            const schema = requestBodyType(item.requestBody, recipe.inputs)
            return [
              `- \`${(item.method || 'POST').toUpperCase()} ${safePath(item.url)}\` (${apiContractMeta(item)})`,
              schema ? '  ```ts\n' + schema + '\n  ```' : '  Body: none or captured out-of-band in `recipe.json`.'
            ].join('\n')
          })
      ].join('\n')
    )
  }
  return sections.join('\n\n') || '- Only non-mutating API traffic was recorded.'
}

function apiContractMeta(item: SkillRecipe['network'][number]): string {
  const role = item.apiRole || ((item.method || '').toUpperCase() === 'GET' ? 'context-read' : 'write')
  const safety = item.replaySafety || (/^(POST|PUT|PATCH|DELETE)$/i.test(item.method || '') ? 'confirm' : 'safe')
  const body = item.bodyKind || (item.requestBody ? 'raw' : 'none')
  return `role=${role}; replay=${safety}; body=${body}`
}

function dedupeEndpoints(items: SkillRecipe['network']): SkillRecipe['network'] {
  const seen = new Set<string>()
  const out: SkillRecipe['network'] = []
  for (const item of items) {
    const key = `${(item.method || '').toUpperCase()} ${safePath(item.url)}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}

function requestBodyType(body: string | null | undefined, inputs: SkillInput[]): string {
  if (!body) return ''
  const trimmed = body.trim()
  if (!trimmed) return ''
  const json = parseBodyJson(trimmed)
  if (json && typeof json === 'object' && !Array.isArray(json)) {
    return `type RequestBody = ${typeForValue(json, inputs, 0)}`
  }
  const form = parseFormBody(trimmed)
  if (form) return `type RequestBody = ${typeForValue(form, inputs, 0)}`
  return 'type RequestBody = string // opaque body; see recipe.json for replay template'
}

function parseBodyJson(body: string): unknown | null {
  try {
    return JSON.parse(body)
  } catch {
    return null
  }
}

function parseFormBody(body: string): Record<string, string> | null {
  if (!body.includes('=') || body.includes('\n')) return null
  const params = new URLSearchParams(body)
  const entries = Array.from(params.entries())
  if (!entries.length) return null
  return Object.fromEntries(entries)
}

function typeForValue(value: unknown, inputs: SkillInput[], depth: number): string {
  const indent = '  '.repeat(depth)
  const next = '  '.repeat(depth + 1)
  if (Array.isArray(value)) {
    const first = value[0]
    return first === undefined ? 'unknown[]' : `${typeForValue(first, inputs, depth)}[]`
  }
  if (value && typeof value === 'object') {
    const lines = Object.entries(value as Record<string, unknown>).map(([key, raw]) => {
      return `${next}${propertyName(key)}: ${primitiveTypeWithComment(key, raw, inputs)}`
    })
    return ['{', ...(lines.length ? lines : [`${next}// no fields captured`]), `${indent}}`].join('\n')
  }
  return primitiveTypeWithComment('', value, inputs)
}

function primitiveTypeWithComment(key: string, value: unknown, inputs: SkillInput[]): string {
  const input = matchInputForField(key, value, inputs)
  const comment = input ? ` // from ${input.name}` : ''
  if (typeof value === 'number') return `number${comment}`
  if (typeof value === 'boolean') return `boolean${comment}`
  if (value === null) return `string | null${comment}`
  return `string${comment}`
}

function matchInputForField(key: string, value: unknown, inputs: SkillInput[]): SkillInput | undefined {
  const keyText = key.toLowerCase().replace(/[^a-z0-9]+/g, '')
  const valueText = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return inputs.find((input) => {
    const nameText = input.name.toLowerCase().replace(/[^a-z0-9]+/g, '')
    const labelText = input.label.toLowerCase().replace(/[^a-z0-9]+/g, '')
    const example = (input.example || '').trim().toLowerCase()
    return keyText.includes(nameText) || keyText.includes(labelText) || Boolean(example && valueText === example)
  })
}

function safePath(url: string): string {
  try {
    const parsed = new URL(url)
    const params = Array.from(parsed.searchParams.keys())
    const query = params
      .map((key) => `${encodeURIComponent(key)}=<${toVarName(key) || 'value'}>`)
      .join('&')
    return `${sanitizeEndpointPath(parsed.pathname)}${query ? `?${query}` : ''}`
  } catch {
    const [path, query = ''] = url.split('?')
    const params = new URLSearchParams(query)
    const queryTemplate = Array.from(params.keys())
      .map((key) => `${encodeURIComponent(key)}=<${toVarName(key) || 'value'}>`)
      .join('&')
    return `${sanitizeEndpointPath(path)}${queryTemplate ? `?${queryTemplate}` : ''}`
  }
}

function sanitizeEndpointPath(path: string): string {
  return path
    .split('/')
    .map((segment) => {
      const decoded = decodeURIComponent(segment)
      if (
        /^[0-9]{5,}$/.test(decoded) ||
        /^[a-f0-9]{8,}-[a-f0-9-]{12,}$/i.test(decoded) ||
        /^[A-Za-z0-9_-]{16,}$/.test(decoded)
      ) {
        return ':id'
      }
      return segment
    })
    .join('/')
}

function inferInputs(actions: Extract<TraceEvent, { kind: 'action' }>[]): SkillInput[] {
  const inputs: SkillInput[] = []
  const used = new Set<string>()
  const labelToName = new Map<string, string>()
  for (const action of actions) {
    if (action.type !== 'fill' && action.type !== 'select') continue
    const label =
      action.step.target.label ||
      action.step.target.name ||
      action.step.target.placeholder ||
      action.step.target.selector
    if (labelToName.has(label)) continue
    const base = toVarName(label)
    let name = base
    let i = 2
    while (used.has(name)) name = `${base}_${i++}`
    used.add(name)
    labelToName.set(label, name)
    inputs.push({
      name,
      label,
      required: true,
      example: action.step.value && action.step.value !== '[password omitted]' ? action.step.value : undefined
    })
  }
  return inputs
}

// Captures raw network into the IN-MEMORY recipe (headerPolicy is derived now from the live
// headers). Every captured VALUE here — header values, request body, response preview — is
// stripped by redactRecipeForStorage before the recipe is ever persisted.
// LLM-declared inputs (with zod constraints), normalized → recipe.inputs. Null when absent
// (caller falls back to inputs inferred from the recorded controls).
function normalizeDraftInputs(drafts?: DraftInput[]): SkillInput[] | null {
  if (!Array.isArray(drafts) || drafts.length === 0) return null
  const out: SkillInput[] = []
  const used = new Set<string>()
  for (const d of drafts) {
    const name = toVarName(String(d?.name || ''))
    if (!name || used.has(name)) continue
    used.add(name)
    const type = d?.type === 'number' || d?.type === 'boolean' || d?.type === 'enum' ? d.type : 'string'
    const enumVals = Array.isArray(d?.enum) ? d.enum.map((v) => String(v)).filter(Boolean).slice(0, 50) : undefined
    // Keep the pattern only if it's a VALID regex — drop a malformed one so validateSkillVars
    // (new RegExp) can never throw at run time.
    let pattern: string | undefined
    if (typeof d?.pattern === 'string' && d.pattern.trim()) {
      const candidate = d.pattern.trim().slice(0, 200)
      try {
        new RegExp(candidate)
        pattern = candidate
      } catch {
        pattern = undefined
      }
    }
    out.push({
      name,
      label: cleanText(d?.label) || name,
      required: d?.required !== false,
      type,
      enum: type === 'enum' && enumVals && enumVals.length ? enumVals : undefined,
      pattern
    })
  }
  return out.length ? out : null
}

// The parametric automation script — trimmed + length-capped. NO concrete values (the prompt
// forbids them); redactRecipeForStorage leaves it untouched (it's pure method).
function cleanScript(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  return text ? text.slice(0, 12_000) : undefined
}

// The domain's shared VALUE-FREE auth scheme, from the recorded endpoints' headerPolicy.
function deriveAuthHints(recipe: SkillRecipe): AuthHint[] {
  const byHeader = new Map<string, AuthHint>()
  for (const item of recipe.network) {
    for (const p of item.headerPolicy || []) {
      if (p.kind === 'static') continue
      const key = p.header.toLowerCase()
      if (byHeader.has(key)) continue
      byHeader.set(key, {
        header: p.header,
        candidateKeys: Array.from(new Set([...(p.storageKeys || []), ...(p.cookieNames || [])])).slice(0, 10),
        prefix: p.prefix,
        meta: p.kind === 'csrf-token' ? 'csrf-token' : undefined
      })
    }
  }
  return Array.from(byHeader.values())
}

function summarizeNetwork(events: TraceEvent[]): SkillRecipe['network'] {
  const responsePreviewById = new Map<string, string | null>()
  for (const event of events) {
    if (event.kind === 'net.response') responsePreviewById.set(event.requestId, event.bodyPreview || null)
  }
  return events
    .filter((event) => event.kind === 'net.request' || event.kind === 'net.response')
    .slice(-80)
    .map((event) => {
      if (event.kind === 'net.request') {
        const bodyKind = classifyRequestBody(event.postData)
        const optionLike = looksListShapedForRecipe(responsePreviewById.get(event.requestId) || '')
        const apiRole = classifyApiRole({
          method: event.method,
          url: event.url,
          resourceType: event.resourceType,
          optionLike
        })
        return {
          requestId: event.requestId,
          method: event.method,
          url: event.url,
          resourceType: event.resourceType,
          apiRole,
          replaySafety: apiRole === 'write' ? 'confirm' : apiRole === 'option-read' || apiRole === 'context-read' ? 'safe' : 'unsafe',
          bodyKind,
          headers: event.headers,
          headerPolicy: inferHeaderPolicy(event.headers),
          requestBody: event.postData || null
        }
      }
      return {
        requestId: event.requestId,
        status: event.status,
        url: event.url,
        headerPolicy: [],
        apiRole: 'other',
        replaySafety: 'unsafe',
        bodyKind: 'none',
        responseBodyPreview: event.bodyPreview || null
      }
    })
}

function classifyRequestBody(body?: string | null): 'none' | 'json' | 'form' | 'raw' {
  const text = String(body || '').trim()
  if (!text) return 'none'
  if (/^[{[]/.test(text)) {
    try {
      JSON.parse(text)
      return 'json'
    } catch {
      return 'raw'
    }
  }
  if (text.includes('=') && !text.includes('\n')) {
    try {
      const params = new URLSearchParams(text)
      if (Array.from(params.keys()).length) return 'form'
    } catch {
      /* keep raw */
    }
  }
  return 'raw'
}

function classifyApiRole(params: {
  method: string
  url: string
  resourceType?: string
  optionLike?: boolean
}): 'option-read' | 'context-read' | 'write' | 'other' {
  const method = params.method.toUpperCase()
  if (/^(POST|PUT|PATCH|DELETE)$/i.test(method) && isApiLikeForRecipe(params.url, params.resourceType)) return 'write'
  if (method === 'GET' && isApiLikeForRecipe(params.url, params.resourceType)) {
    if (!isActionLikeForRecipe(params.url) && isOptionLikeForRecipe(params.url) && params.optionLike) return 'option-read'
    return 'context-read'
  }
  return 'other'
}

function isApiLikeForRecipe(url: string, resourceType?: string): boolean {
  if (/fetch|xhr/i.test(resourceType || '')) return true
  try {
    return /\/api(\/|$)/i.test(new URL(url).pathname)
  } catch {
    return /\/api(\/|$)/i.test(url)
  }
}

function isActionLikeForRecipe(url: string): boolean {
  return /\b(logout|sign-?out|confirm|verify|activate|deactivate|delete|remove|cancel|revoke|reset|approve|reject|checkout|pay)\b/i.test(
    url
  )
}

function isOptionLikeForRecipe(url: string): boolean {
  const path = safePath(url).toLowerCase()
  if (/\b(bookings?|patients?|records?|history|orders?|invoices?|payments?|users?|customers?)\b/.test(path)) return false
  return /\b(options?|departments?|doctors?|specialt(?:y|ies)|catalog|pricing|price-list|prices?|items?|services?|exams?|tests?|procedures?|slots?|schedules?|locations?|clinics?|rooms?)\b/.test(
    path
  )
}

function looksListShapedForRecipe(preview: string): boolean {
  if (!preview) return false
  if (preview.trimStart().startsWith('[')) return true
  return /"(items|list|data|results|options|records|departments|catalog|rows|content)"\s*:\s*\[/i.test(preview)
}

function inferHeaderPolicy(headers: Record<string, string | string[]> | undefined): SkillRecipe['network'][number]['headerPolicy'] {
  const policies: SkillRecipe['network'][number]['headerPolicy'] = []
  for (const [header, raw] of Object.entries(headers || {})) {
    const lower = header.toLowerCase()
    const fallback = Array.isArray(raw) ? raw.join(', ') : String(raw)
    if (lower === 'content-type') {
      policies.push({ header, kind: 'static', storageKeys: [], cookieNames: [], fallback })
      continue
    }
    if (lower === 'authorization') {
      policies.push({
        header,
        kind: /^bearer\s+/i.test(fallback) ? 'bearer-token' : 'storage-or-cookie',
        storageKeys: ['access_token', 'accessToken', 'authToken', 'token', 'id_token', 'jwt'],
        cookieNames: ['access_token', 'accessToken', 'authToken', 'token', 'id_token', 'jwt'],
        prefix: /^bearer\s+/i.test(fallback) ? 'Bearer ' : undefined
      })
      continue
    }
    if (/^x-(csrf|xsrf)|csrf|xsrf/i.test(lower)) {
      policies.push({
        header,
        kind: 'csrf-token',
        storageKeys: ['csrf', 'csrfToken', 'csrf_token', 'xsrf', 'xsrfToken', 'XSRF-TOKEN'],
        cookieNames: ['csrf', 'csrfToken', 'csrf_token', 'xsrf', 'XSRF-TOKEN']
      })
      continue
    }
    if (lower.startsWith('x-')) {
      const base = lower.replace(/^x-/, '')
      policies.push({
        header,
        kind: 'storage-or-cookie',
        storageKeys: [base, base.replace(/-/g, '_'), base.replace(/-/g, '')],
        cookieNames: [base, base.replace(/-/g, '_'), base.replace(/-/g, '')],
        fallback
      })
    }
  }
  return policies
}

function collectSnapshots(events: TraceEvent[]): SkillRecipe['snapshots'] {
  return events
    .filter((event): event is Extract<TraceEvent, { kind: 'snapshot' }> => event.kind === 'snapshot')
    .slice(-6)
    .map((event) => ({ url: event.url, title: event.title, yaml: event.yaml }))
}

function summarizeSnapshotsForPrompt(events: TraceEvent[]): string {
  const snapshots = collectSnapshots(events)
  if (!snapshots.length) return ''
  // Keep the prompt bounded: the latest snapshot's tree (clipped) plus a count.
  const latest = snapshots[snapshots.length - 1]
  const header = `- ${snapshots.length} snapshot(s); latest: ${latest.title || latest.url || 'page'}`
  return `${header}\n${previewText(latest.yaml, 2_000)}`
}

function buildSnapshotSection(recipe: SkillRecipe): string {
  return recipe.snapshots
    .map((snapshot, index) => {
      const heading = `### Snapshot ${index + 1}${snapshot.title ? ` — ${snapshot.title}` : ''}`
      return [heading, '', '```yaml', previewText(snapshot.yaml, 4_000), '```'].join('\n')
    })
    .join('\n\n')
}

function summarizeApiForPrompt(events: TraceEvent[]): string {
  const seen = new Set<string>()
  const lines: string[] = []
  for (const event of events) {
    if (event.kind !== 'net.request') continue
    const method = event.method.toUpperCase()
    const path = safePath(event.url)
    const key = `${method} ${path}`
    if (seen.has(key)) continue
    seen.add(key)
    const role = method === 'GET' ? 'read/options/context' : /^(POST|PUT|PATCH|DELETE)$/.test(method) ? 'write/action' : 'other'
    lines.push(`- ${method} ${path} (${role})`)
  }
  return lines.slice(-24).join('\n')
}

function traceForPrompt(events: TraceEvent[]): string {
  return events
    .slice(-140)
    .map((event) => {
      if (event.kind === 'action') return `[ui] ${event.step.yaml}`
      if (event.kind === 'net.request') return `[request] ${event.method} ${safePath(event.url)}`
      if (event.kind === 'net.response') return `[response] ${event.status} ${safePath(event.url)}`
      return `[${event.kind}] ${'msg' in event ? event.msg : ''}`
    })
    .join('\n')
}

function parseDraftJson(text: string): CodexSkillDraft | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const raw = fenced?.[1] || text.match(/\{[\s\S]*\}/)?.[0]
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as CodexSkillDraft
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

function inferName(actions: Extract<TraceEvent, { kind: 'action' }>[], currentUrl: string): string {
  const host = safeHost(currentUrl)
  const verbs = actions.slice(0, 3).map((action) => action.type).join(' ')
  return `${host || 'Recorded'} ${verbs || 'workflow'}`.trim()
}

function inferTriggers(currentUrl: string, name: string): string[] {
  return unique([safeHost(currentUrl), ...name.toLowerCase().split(/[^a-z0-9]+/)]).filter(Boolean)
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

function toVarName(label: string): string {
  const ascii = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return ascii || `field_${Math.random().toString(36).slice(2, 6)}`
}

function cleanTitle(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, 80) : ''
}

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, 240) : ''
}

function cleanDetail(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.replace(/\s+/g, ' ').trim()
  return text ? text.slice(0, 1_200) : undefined
}

// Field rules are a multi-line list — preserve newlines (only collapse runs of
// blank lines and trailing spaces), unlike cleanDetail which flattens whitespace.
function cleanRules(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return text ? text.slice(0, 4_000) : undefined
}

function normalizeList(value: unknown, limit: number, fallback: string[] = []): string[] {
  const raw = Array.isArray(value) ? value : []
  return unique([...raw.map((item) => (typeof item === 'string' ? item : '')), ...fallback])
    .map((item) => item.replace(/\s+/g, ' ').trim())
    .filter((item) => item.length > 0 && item.length <= 80)
    .slice(0, limit)
}

function buildDefaultShortcuts(name: string, inputs: SkillInput[]): string[] {
  const placeholders = inputs.filter((input) => input.required).map((input) => `<${input.name}>`)
  const suffix = placeholders.length ? ` ${placeholders.join(' ')}` : ''
  return [`${name}${suffix}`]
}

function normalizeNotes(value: unknown): string | undefined {
  if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean).join('\n')
  if (typeof value === 'string') return value
  return undefined
}

function unique(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.map((value) => (value || '').trim()).filter(Boolean)))
}

function previewText(text: string, limit = 4_000): string {
  if (text.length <= limit) return text
  return text.slice(0, limit) + `\n...[truncated ${text.length - limit} chars]`
}
