import { dialog, shell } from 'electron'
import type { BrowserWindow, OpenDialogOptions } from 'electron'
import { xpcMain } from 'electron-xpc/main'
import { dirname } from 'path'
import { injectable } from 'inversify'
import type { ReplayEngine } from '@maestro-main/drive/replayEngine'
import type { CaptureRecordSource } from '@maestro-main/capture/captureRecordSource'
import { buildIngestSpecNotes, clipText } from '@maestro-main/capture/traceTimeline'
import type { SkillGeneratorService } from '@maestro-main/skills/skillGenerator.service'
import type { SkillRegistryService } from '@maestro-main/skills/skillRegistry.service'
import type { SkillRecipe } from '@maestro-main/skills/skillRecipe.types'
import type {
  AgentActivityStep,
  DeleteSkillResult,
  IngestRecord,
  ReplayResult,
  SkillCreateResult,
  SkillDetail,
  SkillExportResult,
  SkillImportResult,
  SkillSummary
} from '@maestro-shared/coach.api'
import type { TraceEvent } from '@maestro-shared/trace.types'
import { CommonService } from '@maestro-shared/iocHelper/ioc.helper'

interface SkillRuntimeServices {
  registry: SkillRegistryService
  generator: SkillGeneratorService
}

export interface SkillServiceState {
  browserWindow: BrowserWindow | null
  currentUrl: string
  ensureServices(): SkillRuntimeServices
  replayEngine: ReplayEngine | null
  lastAgentRun: { skill?: SkillSummary; skills?: SkillSummary[]; replay?: ReplayResult }
  lastTrainerRun: { skill?: SkillSummary }
  broadcastActivity(phase: AgentActivityStep['phase'], label: string, ok?: boolean): void
  emitTrace(event: TraceEvent): void
  captureRecordsForAgent(): CaptureRecordSource
  replayRecipe(recipe: SkillRecipe, variables: Record<string, string>): Promise<ReplayResult>
}

const formatDebugDuration = (detail: unknown): string => {
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return ''
  const ms = Number((detail as { durationMs?: unknown }).durationMs)
  if (!Number.isFinite(ms) || ms < 0) return ''
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`
}

const appendActivityDuration = (label: string, startedAt: number): string => {
  const duration = formatDebugDuration({ durationMs: Date.now() - startedAt })
  return duration ? `${label} · ${duration}` : label
}

/**
 * Skill lifecycle shared by the Workbench XPC facade and the Maestro agent tools.
 *
 * Registry and generator construction remains controller-owned so the existing one-shot LLM
 * bootstrap is preserved. This service owns only the skill operations and their turn-result
 * effects.
 */
@injectable()
export class SkillService extends CommonService<SkillServiceState> {
  async listSkills(): Promise<SkillSummary[]> {
    return this._state.ensureServices().registry.listSkills()
  }

  async deleteSkill(params: { skillId: string }): Promise<DeleteSkillResult> {
    return this._state.ensureServices().registry.deleteSkill(params.skillId)
  }

  async summarizeSkill(params: { workflow?: string; records: IngestRecord[] }): Promise<SkillCreateResult> {
    const startedAt = Date.now()
    const services = this._state.ensureServices()
    // Ingest from the renderer's CURRENT, non-deleted records (NOT the raw trace buffer):
    // the user may have pruned noise + annotated steps with per-record specs.
    // NEVER feed error/info events to ingest — they're capture noise, not part of the workflow the
    // skill should learn. The renderer's Ingest button already drops them, but filter here too so
    // the agent's summarize-intent path (which ingests the raw trace buffer) is covered as well.
    const records = (params.records || []).filter(
      (record) => record.event.kind !== 'error' && record.event.kind !== 'info'
    )
    const events = records.map((record) => record.event)
    const specNotes = buildIngestSpecNotes(records)
    this._state.broadcastActivity('tool', `call generate_skill (${events.length} records)`)
    try {
      const result = await services.generator.summarize(
        events,
        this._state.currentUrl,
        params.workflow,
        undefined,
        specNotes || undefined
      )
      this._state.broadcastActivity(
        'tool',
        appendActivityDuration(
          result.ok
            ? `generate_skill returned ${result.skill?.name || 'skill'}`
            : `generate_skill failed: ${result.error || result.message}`,
          startedAt
        ),
        result.ok
      )
      return result
    } catch (err) {
      this._state.broadcastActivity(
        'tool',
        appendActivityDuration(`generate_skill failed: ${(err as Error).message}`, startedAt),
        false
      )
      throw err
    }
  }

  // Maestro `ingest_recording` turns the CURRENT capture (renderer-edited records if present,
  // otherwise raw trace buffer; error/info dropped) into one or MORE skills via the generator's
  // multi-skill split, tells the renderer to refresh the skill list, and returns generated skills.
  async ingestRecordingToSkills(): Promise<string> {
    const startedAt = Date.now()
    const capture = this._state.captureRecordsForAgent()
    const records = capture.records.filter(
      (record) => record.event.kind !== 'error' && record.event.kind !== 'info'
    )
    const events = records.map((record) => record.event)
    const specNotes = buildIngestSpecNotes(records, capture.workflow)
    this._state.broadcastActivity(
      'tool',
      `call ingest_recording (${events.length} ${capture.source === 'edited' ? 'edited records' : 'events'})`
    )
    try {
      const result = await this._state
        .ensureServices()
        .generator.summarizeMulti(events, this._state.currentUrl, specNotes || undefined)
      this._state.broadcastActivity(
        'tool',
        appendActivityDuration(
          result.ok
            ? `ingest_recording returned ${result.skills.length} skill${result.skills.length === 1 ? '' : 's'}`
            : `ingest_recording failed: ${result.message}`,
          startedAt
        ),
        result.ok
      )
      if (result.ok && result.skills.length) {
        this._state.lastAgentRun = {
          ...this._state.lastAgentRun,
          skill: result.skills[0],
          skills: result.skills
        }
        this._state.broadcastActivity(
          'skill',
          `generated ${result.skills.map((skill) => skill.name).join(', ')}`
        )
        xpcMain.broadcast('coach/skills-changed', { ts: Date.now() })
      }
      return result.ok ? result.message : `Ingest failed: ${result.message}`
    } catch (err) {
      this._state.broadcastActivity(
        'tool',
        appendActivityDuration(`ingest_recording failed: ${(err as Error).message}`, startedAt),
        false
      )
      throw err
    }
  }

  async getSkillDetail(params: { skillId: string }): Promise<SkillDetail | null> {
    return this._state.ensureServices().registry.readSkillDetail(params.skillId)
  }

  async openSkillDirectory(params: {
    skillId: string
  }): Promise<{ ok: boolean; path?: string; error?: string }> {
    const skill = this._state
      .ensureServices()
      .registry.listSkills()
      .find((item) => item.id === params.skillId)
    if (!skill) return { ok: false, error: 'skill-not-found' }
    const dir = dirname(skill.path)
    const error = await shell.openPath(dir)
    return error ? { ok: false, path: dir, error } : { ok: true, path: dir }
  }

  async exportSkillPackage(params: { skillId: string }): Promise<SkillExportResult> {
    const registry = this._state.ensureServices().registry
    const skill = registry.listSkills().find((item) => item.id === params.skillId)
    if (!skill) {
      return {
        ok: false,
        skillId: params.skillId,
        message: 'Skill not found.',
        error: 'not-found'
      }
    }
    const options: OpenDialogOptions = {
      title: `Export ${skill.name}`,
      properties: ['openDirectory', 'createDirectory']
    }
    const result = this._state.browserWindow
      ? await dialog.showOpenDialog(this._state.browserWindow, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths[0]) {
      return {
        ok: false,
        skillId: params.skillId,
        message: 'Export cancelled.',
        canceled: true
      }
    }
    const exported = registry.exportSkillPackage(params.skillId, result.filePaths[0])
    if (exported.ok && exported.path) shell.showItemInFolder(exported.path)
    return exported
  }

  async importSkillPackage(): Promise<SkillImportResult> {
    const options: OpenDialogOptions = {
      title: 'Import Coach skill package',
      properties: ['openDirectory']
    }
    const result = this._state.browserWindow
      ? await dialog.showOpenDialog(this._state.browserWindow, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths[0]) {
      return { ok: false, message: 'Import cancelled.', canceled: true }
    }
    const imported = this._state
      .ensureServices()
      .registry.importSkillPackage(result.filePaths[0])
    if (imported.ok) xpcMain.broadcast('coach/skills-changed', { ts: Date.now() })
    return imported
  }

  // Reveal the folder that holds ALL skills for a domain (empty domain -> skills root).
  async openDomainDirectory(params: {
    domain: string
  }): Promise<{ ok: boolean; path?: string; error?: string }> {
    const dir = this._state.ensureServices().registry.domainDirectory(params.domain)
    if (!dir) return { ok: false, error: 'domain-folder-not-found' }
    const error = await shell.openPath(dir)
    return error ? { ok: false, path: dir, error } : { ok: true, path: dir }
  }

  async trainSkill(params: { skillId: string; guidance: string }): Promise<SkillCreateResult> {
    return await this._state.ensureServices().generator.train(params.skillId, params.guidance)
  }

  async replaySkill(params: {
    skillId: string
    variables: Record<string, string>
  }): Promise<ReplayResult> {
    const recipe = this._state.ensureServices().registry.readRecipe(params.skillId)
    if (!recipe) {
      return {
        ok: false,
        skillId: params.skillId,
        stepsRun: 0,
        errors: ['Skill recipe not found.']
      }
    }
    if (!this._state.replayEngine) {
      return {
        ok: false,
        skillId: params.skillId,
        stepsRun: 0,
        errors: ['Browser view is not ready.']
      }
    }
    const result = await this._state.replayRecipe(recipe, params.variables || {})
    this._state.emitTrace({
      kind: result.ok ? 'info' : 'error',
      msg: result.ok
        ? `replay completed: ${result.stepsRun} steps`
        : `replay failed: ${result.errors.join('; ')}`,
      ts: Date.now()
    })
    return result
  }

  trainerToolDetail(skillId: string): string {
    const detail = this._state.ensureServices().registry.readSkillDetail(skillId)
    if (!detail) return `ERROR: unknown skill_id "${skillId}".`
    return clipText(
      JSON.stringify(
        {
          id: detail.id,
          name: detail.name,
          description: detail.description,
          triggers: detail.triggers,
          inputs: detail.inputs,
          stepCount: detail.stepCount,
          networkCount: detail.networkCount,
          body: clipText(detail.body, 4_000)
        },
        null,
        1
      )
    )
  }

  async trainerToolCreate(guidance: string): Promise<string> {
    const startedAt = Date.now()
    const capture = this._state.captureRecordsForAgent()
    const records = capture.records.filter(
      (record) => record.event.kind !== 'error' && record.event.kind !== 'info'
    )
    const events = records.map((record) => record.event)
    const specNotes = buildIngestSpecNotes(records, capture.workflow)
    this._state.broadcastActivity(
      'tool',
      `call create_or_update_skill (${events.length} ${capture.source === 'edited' ? 'edited records' : 'events'})`
    )
    try {
      const result = await this._state
        .ensureServices()
        .generator.summarize(
          events,
          this._state.currentUrl,
          guidance,
          undefined,
          specNotes || undefined
        )
      if (result.skill) this._state.lastTrainerRun = { skill: result.skill }
      this._state.broadcastActivity(
        'tool',
        appendActivityDuration(
          result.ok
            ? `create_or_update_skill returned ${result.skill?.name || 'skill'}`
            : `create_or_update_skill failed: ${result.error || result.message}`,
          startedAt
        ),
        result.ok
      )
      return JSON.stringify({
        ok: result.ok,
        message: result.message,
        error: result.error,
        skillId: result.skill?.id
      })
    } catch (err) {
      this._state.broadcastActivity(
        'tool',
        appendActivityDuration(`create_or_update_skill failed: ${(err as Error).message}`, startedAt),
        false
      )
      throw err
    }
  }

  async trainerToolOptimize(skillId: string, guidance: string): Promise<string> {
    const startedAt = Date.now()
    this._state.broadcastActivity('tool', `call optimize_skill (${skillId})`)
    try {
      const result = await this._state.ensureServices().generator.train(skillId, guidance)
      if (result.skill) this._state.lastTrainerRun = { skill: result.skill }
      this._state.broadcastActivity(
        'tool',
        appendActivityDuration(
          result.ok
            ? `optimize_skill returned ${result.skill?.name || skillId}`
            : `optimize_skill failed: ${result.error || result.message}`,
          startedAt
        ),
        result.ok
      )
      return JSON.stringify({
        ok: result.ok,
        message: result.message,
        error: result.error,
        skillId: result.skill?.id
      })
    } catch (err) {
      this._state.broadcastActivity(
        'tool',
        appendActivityDuration(`optimize_skill failed: ${(err as Error).message}`, startedAt),
        false
      )
      throw err
    }
  }

  trainerToolDelete(skillId: string): string {
    const result = this._state.ensureServices().registry.deleteSkill(skillId)
    return JSON.stringify({ ok: result.ok, message: result.message, error: result.error })
  }
}
