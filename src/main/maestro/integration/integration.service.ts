import { randomUUID } from 'crypto'
import { xpcMain } from 'electron-xpc/main'
import { injectable } from 'inversify'
import { CommonService } from '@maestro-shared/iocHelper/ioc.helper'
import { ReplayEngine, type AuthHint } from '@maestro-main/drive/replayEngine'
import { readApiProfile } from '@maestro-main/skills/apiProfile.service'
import { integrationTargetStore } from '@maestro-main/integration/integrationTarget.service'
import { integrationMappingStore } from '@maestro-main/integration/integrationMapping.service'
import { runMicromeetCli } from '@maestro-main/integration/integrationRunner.service'
import type { IntegrationSchedulerEvent } from '@maestro-main/integration/integrationScheduler.service'
import type { OperationTab } from '@maestro-main/windows/main/maestroBrowserView.service'
import type {
  AgentActivityStep,
  IngestRecord,
  IntegrationEndpointContract,
  IntegrationEntity,
  IntegrationMappingDeleteRequest,
  IntegrationMappingEntry,
  IntegrationMappingListRequest,
  IntegrationMappingListResult,
  IntegrationMappingUpsertRequest,
  IntegrationMappingWriteResult,
  IntegrationMigrationRunRequest,
  IntegrationMigrationTargetRequest,
  IntegrationRecordedSiteApplyRequest,
  IntegrationRecordedSiteSyncRequest,
  IntegrationReportReadinessRequest,
  IntegrationRunOutput,
  IntegrationRunSummary,
  IntegrationTarget,
  IntegrationTargetCreateResult,
  IntegrationTargetDeleteResult,
  IntegrationTargetRunResult,
  IntegrationTargetScheduleRequest,
  IntegrationTargetScheduleResult,
  IntegrationTargetSummary
} from '@maestro-shared/coach.api'
import {
  RECORDED_SITE_APPLY_ENTITIES,
  aiCrmsIdFromResponse,
  extractRecordedSiteRows,
  integrationEntityForEndpoint,
  mergeRecordedSiteRowDetails,
  normalizeRecordedSiteApplyEntities,
  normalizeRecordedSiteHost,
  recordedSiteAiCrmsBody,
  recordedSiteAiCrmsCommands,
  recordedSiteDetailEndpointsForEntity,
  recordedSiteDryRunUrl,
  recordedSiteEndpointNeedsRow,
  recordedSiteRedactDetailUrl,
  recordedSiteRowDetailUrl,
  recordedSiteRowSyncPlan,
  recordedSiteSourceLabel,
  sourceKeyForRecordedSiteRow,
  stableSourceHash
} from './recordedSite/rowMapping'
import { stringFrom } from './recordedSite/rowValue'

export interface IntegrationCaptureRecordSource {
  source: 'edited' | 'raw'
  records: IngestRecord[]
  workflow?: string
  updatedAt?: number
}

export interface IntegrationServiceState {
  currentUrl: string
  ensurePersistedCaptureRecordsLoaded(): Promise<void>
  captureRecordsForAgent(): IntegrationCaptureRecordSource
  findRecordedSiteTab(target: IntegrationTarget): Promise<OperationTab | undefined>
  broadcastActivity(phase: AgentActivityStep['phase'], label: string, ok?: boolean): void
  broadcastApiActivity(method: string | undefined, url: string, ok: boolean, auth?: { header: string; source: string; key?: string; applied: boolean }[]): void
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

@injectable()
export class IntegrationService extends CommonService<IntegrationServiceState> {
  async listIntegrationTargets(): Promise<IntegrationTargetSummary[]> {
    return await integrationTargetStore.listSummaries()
  }

  async getIntegrationTarget(params: { targetId: string }): Promise<IntegrationTarget | null> {
    return await integrationTargetStore.getTarget(params.targetId)
  }

  async createIntegrationTargetFromCapture(params?: { name?: string; domain?: string }): Promise<IntegrationTargetCreateResult> {
    await this._state.ensurePersistedCaptureRecordsLoaded()
    const capture = this._state.captureRecordsForAgent()
    const result = await integrationTargetStore.createFromCapture({
      name: params?.name,
      domain: params?.domain,
      currentUrl: this._state.currentUrl,
      records: capture.records
    })
    if (result.ok) {
      xpcMain.broadcast('coach/integration-targets-changed', { targetId: result.target?.id, ts: Date.now() })
    }
    return result
  }

  async createAiCrmsMigrationTarget(params: IntegrationMigrationTargetRequest): Promise<IntegrationTargetCreateResult> {
    const result = await integrationTargetStore.createAiCrmsMigrationTarget(params)
    if (result.ok) {
      xpcMain.broadcast('coach/integration-targets-changed', {
        targetId: result.target?.id,
        migration: true,
        ts: Date.now()
      })
    }
    return result
  }

  async deleteIntegrationTarget(params: { targetId: string }): Promise<IntegrationTargetDeleteResult> {
    const result = await integrationTargetStore.deleteTarget(params.targetId)
    if (result.ok) {
      xpcMain.broadcast('coach/integration-targets-changed', {
        targetId: result.targetId,
        deleted: true,
        ts: Date.now()
      })
    }
    return result
  }

  async runIntegrationTargetDryRun(params: { targetId: string }): Promise<IntegrationTargetRunResult> {
    const result = await integrationTargetStore.runDryRun(params.targetId)
    if (result.ok) {
      xpcMain.broadcast('coach/integration-targets-changed', {
        targetId: result.targetId,
        dryRun: true,
        ts: Date.now()
      })
    }
    return result
  }

  async runIntegrationRecordedSiteDryRun(params: IntegrationRecordedSiteSyncRequest): Promise<IntegrationTargetRunResult> {
    const targetId = String(params.targetId || '').trim()
    const target = await integrationTargetStore.getTarget(targetId)
    if (!target) {
      return {
        ok: false,
        targetId,
        message: `Integration target ${targetId} was not found.`,
        error: 'target-not-found'
      }
    }
    const run = await this.buildRecordedSiteDryRun(target, params)
    await integrationTargetStore.recordRun(target.id, run)
    xpcMain.broadcast('coach/integration-targets-changed', {
      targetId: target.id,
      recordedSiteDryRun: true,
      ts: Date.now()
    })
    return {
      ok: run.status !== 'failed',
      targetId: target.id,
      run,
      message:
        run.status === 'success'
          ? 'Recorded-site sync dry-run completed.'
          : run.status === 'warning'
            ? `Recorded-site sync dry-run finished with ${run.missing.length} item${run.missing.length === 1 ? '' : 's'} to review.`
            : 'Recorded-site sync dry-run failed.',
      error: run.status === 'failed' ? 'recorded-site-dry-run-failed' : undefined
    }
  }

  async runIntegrationRecordedSitePlan(params: IntegrationRecordedSiteSyncRequest): Promise<IntegrationTargetRunResult> {
    const targetId = String(params.targetId || '').trim()
    const target = await integrationTargetStore.getTarget(targetId)
    if (!target) {
      return {
        ok: false,
        targetId,
        message: `Integration target ${targetId} was not found.`,
        error: 'target-not-found'
      }
    }
    const run = await this.buildRecordedSiteDryRun(target, params, { plan: true })
    await integrationTargetStore.recordRun(target.id, run)
    xpcMain.broadcast('coach/integration-targets-changed', {
      targetId: target.id,
      recordedSitePlan: true,
      ts: Date.now()
    })
    return {
      ok: run.status !== 'failed',
      targetId: target.id,
      run,
      message:
        run.status === 'success'
          ? 'Recorded-site sync plan completed.'
          : run.status === 'warning'
            ? `Recorded-site sync plan finished with ${run.missing.length} item${run.missing.length === 1 ? '' : 's'} to review.`
            : 'Recorded-site sync plan failed.',
      error: run.status === 'failed' ? 'recorded-site-plan-failed' : undefined
    }
  }

  async runIntegrationRecordedSiteApply(params: IntegrationRecordedSiteApplyRequest): Promise<IntegrationTargetRunResult> {
    const targetId = String(params.targetId || '').trim()
    const target = await integrationTargetStore.getTarget(targetId)
    if (!target) {
      return {
        ok: false,
        targetId,
        message: `Integration target ${targetId} was not found.`,
        error: 'target-not-found'
      }
    }
    if (params.apply !== true) {
      return {
        ok: false,
        targetId: target.id,
        message: 'Recorded-site apply requires apply=true.',
        error: 'apply-confirmation-required'
      }
    }
    const run = await this.buildRecordedSiteApply(target, params)
    await integrationTargetStore.recordRun(target.id, run)
    xpcMain.broadcast('coach/integration-targets-changed', {
      targetId: target.id,
      recordedSiteApply: true,
      ts: Date.now()
    })
    return {
      ok: run.status !== 'failed',
      targetId: target.id,
      run,
      message:
        run.status === 'success'
          ? 'Recorded-site sync apply completed.'
          : run.status === 'warning'
            ? `Recorded-site sync apply finished with ${run.missing.length} item${run.missing.length === 1 ? '' : 's'} to review.`
            : 'Recorded-site sync apply failed.',
      error: run.status === 'failed' ? 'recorded-site-apply-failed' : undefined
    }
  }

  async buildRecordedSiteDryRun(target: IntegrationTarget, params: IntegrationRecordedSiteSyncRequest, options: { plan?: boolean } = {}): Promise<IntegrationRunSummary> {
    const startedAt = Date.now()
    const notes = [
      'Recorded-site dry-run reads captured GET/list endpoints through the live browser session.',
      'No AI-CRMS writes are performed. Response rows are counted only; full source payloads are not persisted.',
      'Existing source-to-AI-CRMS mappings are used to classify rows as linked, pending, or conflict.'
    ]
    if (options.plan) {
      notes.push('Plan mode converts source rows into create/update/conflict intent counts only; source row payloads are not persisted.')
    }
    const missing: string[] = []
    const outputs: IntegrationRunOutput[] = []
    if (target.source.kind !== 'recorded-site') missing.push('recorded-site target')

    const selectedIds = new Set((params.endpointIds || []).map((id) => String(id || '').trim()).filter(Boolean))
    const maxEndpoints = Math.min(Math.max(Math.round(Number(params.maxEndpoints || 5)), 1), 20)
    const maxRows = Math.min(Math.max(Math.round(Number(params.maxRowsPerEndpoint || 50)), 1), 200)
    const readEndpoints = target.endpoints.filter((endpoint) => endpoint.role === 'read').filter((endpoint) => !selectedIds.size || selectedIds.has(endpoint.id))
    const detailEndpoints = readEndpoints.filter(recordedSiteEndpointNeedsRow)
    const endpoints = readEndpoints.filter((endpoint) => !recordedSiteEndpointNeedsRow(endpoint)).slice(0, maxEndpoints)
    if (!endpoints.length) missing.push('captured read/list API endpoint')

    const tab = await this._state.findRecordedSiteTab(target)
    if (!tab?.replay) {
      missing.push(`open logged-in browser tab for ${target.source.domain || 'recorded site'}`)
    }

    let totalRows = 0
    let linkedRows = 0
    let pendingRows = 0
    let conflictRows = 0
    let planCreateRows = 0
    let planUpdateRows = 0
    let planMissingRows = 0
    let fetchCount = 0
    const mappingsByEntity = new Map<IntegrationEntity, Map<string, IntegrationMappingEntry>>()

    if (tab?.replay) {
      const sourceHost = normalizeRecordedSiteHost(target.source.domain || target.source.startUrl)
      const domainAuth = readApiProfile(sourceHost)
      for (const endpoint of endpoints) {
        const entity = integrationEntityForEndpoint(endpoint, target.entities)
        const endpointPlan = recordedSiteDryRunUrl(endpoint)
        if (!endpointPlan.ok || !endpointPlan.url) {
          outputs.push({
            name: `${endpoint.method} ${endpoint.path}`,
            ok: false,
            command: `${endpoint.method} ${endpoint.urlTemplate}`,
            summary: 'skipped',
            error: endpointPlan.error
          })
          missing.push(endpointPlan.error || 'safe endpoint url')
          continue
        }

        const result = await tab.replay.apiFetch({ method: endpoint.method, url: endpointPlan.url }, domainAuth)
        fetchCount += 1
        this._state.broadcastApiActivity(endpoint.method, endpointPlan.url, result.ok, result.auth)
        if (!result.ok) {
          outputs.push({
            name: `${endpoint.method} ${endpoint.path}`,
            ok: false,
            command: `${endpoint.method} ${endpointPlan.url}`,
            summary: 'fetch failed',
            error: result.error || `HTTP ${result.status}`
          })
          missing.push(`${endpoint.method} ${endpoint.path}`)
          continue
        }

        const rows = extractRecordedSiteRows(result.data, maxRows)
        const entityDetailEndpoints = recordedSiteDetailEndpointsForEntity(detailEndpoints, entity).slice(0, 4)
        if (!mappingsByEntity.has(entity)) {
          const mappingResult = await integrationMappingStore.listMappings({
            targetId: target.id,
            entity,
            limit: 500
          })
          mappingsByEntity.set(entity, new Map(mappingResult.mappings.map((mapping) => [mapping.sourceKey, mapping])))
        }
        const mappings = mappingsByEntity.get(entity) || new Map<string, IntegrationMappingEntry>()
        let endpointLinked = 0
        let endpointPending = 0
        let endpointConflict = 0
        let endpointPlanCreate = 0
        let endpointPlanUpdate = 0
        let endpointPlanMissing = 0
        let endpointDetailFetches = 0
        for (const row of rows) {
          const detailFetch = await this.fetchRecordedSiteRowDetails(row, entityDetailEndpoints, tab.replay, domainAuth)
          fetchCount += detailFetch.fetchCount
          endpointDetailFetches += detailFetch.fetchCount
          for (const output of detailFetch.outputs) outputs.push(output)
          for (const item of detailFetch.missing) missing.push(item)
          const enrichedRow = detailFetch.row
          const sourceKey = sourceKeyForRecordedSiteRow(enrichedRow)
          const sourceHash = stableSourceHash(enrichedRow)
          const mapping = mappings.get(sourceKey)
          if (!mapping) endpointPending += 1
          else if (mapping.sourceHash && sourceHash && mapping.sourceHash !== sourceHash) {
            endpointConflict += 1
          } else if (mapping.aiCrmsId && mapping.status === 'linked') endpointLinked += 1
          else if (mapping.status === 'conflict') endpointConflict += 1
          else endpointPending += 1

          if (options.plan) {
            const rowPlan = recordedSiteRowSyncPlan(entity, enrichedRow, mapping, sourceHash)
            if (rowPlan.action === 'create') endpointPlanCreate += 1
            if (rowPlan.action === 'update') endpointPlanUpdate += 1
            if (rowPlan.missingFields.length) endpointPlanMissing += 1
          }
        }
        totalRows += rows.length
        linkedRows += endpointLinked
        pendingRows += endpointPending
        conflictRows += endpointConflict
        planCreateRows += endpointPlanCreate
        planUpdateRows += endpointPlanUpdate
        planMissingRows += endpointPlanMissing
        if (!rows.length) missing.push(`${endpoint.method} ${endpoint.path} source rows`)
        if (options.plan && endpointPlanMissing) {
          missing.push(`${entity} rows missing required fields (${endpointPlanMissing})`)
        }
        outputs.push({
          name: `${endpoint.method} ${endpoint.path}`,
          ok: true,
          command: `${endpoint.method} ${endpointPlan.url}`,
          durationMs: undefined,
          summary: options.plan
            ? `${rows.length} ${entity} row(s), ${endpointDetailFetches} detail fetch(es): plan ${endpointPlanCreate} create, ${endpointPlanUpdate} update, ${endpointConflict} conflict, ${endpointPlanMissing} missing-fields`
            : `${rows.length} ${entity} row(s), ${endpointDetailFetches} detail fetch(es): ${endpointLinked} linked, ${endpointPending} pending, ${endpointConflict} conflict`
        })
      }
    }

    const allFetchesFailed = fetchCount > 0 && outputs.filter((output) => output.command.startsWith('GET ') && output.ok).length === 0
    const status =
      missing.includes('recorded-site target') || allFetchesFailed || (!fetchCount && endpoints.length > 0)
        ? 'failed'
        : missing.length || pendingRows || conflictRows
          ? 'warning'
          : 'success'
    notes.push(`Dry-run total: ${totalRows} row(s), ${linkedRows} linked, ${pendingRows} pending, ${conflictRows} conflict.`)
    if (options.plan) {
      notes.push(`Plan total: ${planCreateRows} create, ${planUpdateRows} update, ${conflictRows} conflict, ${planMissingRows} missing required fields.`)
    }
    return {
      id: randomUUID(),
      mode: 'dry-run',
      status,
      startedAt,
      finishedAt: Date.now(),
      endpointCount: endpoints.length,
      readCount: endpoints.length,
      writeCount: target.endpoints.filter((endpoint) => endpoint.role === 'write').length,
      entityCount: target.entities.length,
      commandCount: fetchCount,
      notes,
      missing: Array.from(new Set(missing)),
      outputs
    }
  }

  async buildRecordedSiteApply(target: IntegrationTarget, params: IntegrationRecordedSiteApplyRequest): Promise<IntegrationRunSummary> {
    const startedAt = Date.now()
    const notes = [
      'Recorded-site apply reads captured GET/list endpoints through the live browser session.',
      'Apply writes patient, corporate, project, data_mapping, and mcu_record rows through the bundled micromeet CLI.',
      'Linked MCU record updates can write patient-info, diagnostic-data, and conclusion sections when allow_updates=true.',
      'Source payloads and auth tokens are not persisted; successful writes update source-to-AI-CRMS mappings.'
    ]
    const missing: string[] = []
    const outputs: IntegrationRunOutput[] = []
    if (target.source.kind !== 'recorded-site') missing.push('recorded-site target')

    const selectedIds = new Set((params.endpointIds || []).map((id) => String(id || '').trim()).filter(Boolean))
    const entities = normalizeRecordedSiteApplyEntities(params.entities)
    const maxEndpoints = Math.min(Math.max(Math.round(Number(params.maxEndpoints || 5)), 1), 20)
    const maxRows = Math.min(Math.max(Math.round(Number(params.maxRowsPerEndpoint || 50)), 1), 200)
    const maxWrites = Math.min(Math.max(Math.round(Number(params.maxWrites || 10)), 1), 50)
    const readEndpoints = target.endpoints.filter((endpoint) => endpoint.role === 'read').filter((endpoint) => !selectedIds.size || selectedIds.has(endpoint.id))
    const detailEndpoints = readEndpoints.filter(recordedSiteEndpointNeedsRow)
    const endpoints = readEndpoints.filter((endpoint) => !recordedSiteEndpointNeedsRow(endpoint)).slice(0, maxEndpoints)
    if (!endpoints.length) missing.push('captured read/list API endpoint')

    const tab = await this._state.findRecordedSiteTab(target)
    if (!tab?.replay) {
      missing.push(`open logged-in browser tab for ${target.source.domain || 'recorded site'}`)
    }

    let fetchCount = 0
    let cliCommandCount = 0
    let writeCount = 0
    let createCount = 0
    let updateCount = 0
    let skippedCount = 0
    let failed = false
    const mappingsByEntity = new Map<IntegrationEntity, Map<string, IntegrationMappingEntry>>()

    const loadMappings = async (entity: IntegrationEntity): Promise<Map<string, IntegrationMappingEntry>> => {
      if (!mappingsByEntity.has(entity)) {
        const mappingResult = await integrationMappingStore.listMappings({
          targetId: target.id,
          entity,
          limit: 500
        })
        mappingsByEntity.set(entity, new Map(mappingResult.mappings.map((mapping) => [mapping.sourceKey, mapping])))
      }
      return mappingsByEntity.get(entity) || new Map<string, IntegrationMappingEntry>()
    }

    if (tab?.replay) {
      const sourceHost = normalizeRecordedSiteHost(target.source.domain || target.source.startUrl)
      const domainAuth = readApiProfile(sourceHost)
      for (const endpoint of endpoints) {
        if (writeCount >= maxWrites || failed) break
        const entity = integrationEntityForEndpoint(endpoint, target.entities)
        if (!entities.includes(entity)) continue
        const endpointPlan = recordedSiteDryRunUrl(endpoint)
        if (!endpointPlan.ok || !endpointPlan.url) {
          outputs.push({
            name: `${endpoint.method} ${endpoint.path}`,
            ok: false,
            command: `${endpoint.method} ${endpoint.urlTemplate}`,
            summary: 'skipped',
            error: endpointPlan.error
          })
          missing.push(endpointPlan.error || 'safe endpoint url')
          continue
        }

        const result = await tab.replay.apiFetch({ method: endpoint.method, url: endpointPlan.url }, domainAuth)
        fetchCount += 1
        this._state.broadcastApiActivity(endpoint.method, endpointPlan.url, result.ok, result.auth)
        if (!result.ok) {
          outputs.push({
            name: `${endpoint.method} ${endpoint.path}`,
            ok: false,
            command: `${endpoint.method} ${endpointPlan.url}`,
            summary: 'fetch failed',
            error: result.error || `HTTP ${result.status}`
          })
          missing.push(`${endpoint.method} ${endpoint.path}`)
          failed = true
          break
        }

        const rows = extractRecordedSiteRows(result.data, maxRows)
        const entityDetailEndpoints = recordedSiteDetailEndpointsForEntity(detailEndpoints, entity).slice(0, 4)
        const mappings = await loadMappings(entity)
        const dependencyMappings =
          entity === 'project' || entity === 'mcu_record'
            ? {
                patient: entity === 'mcu_record' ? await loadMappings('patient') : undefined,
                corporate: await loadMappings('corporate'),
                project: entity === 'mcu_record' ? await loadMappings('project') : undefined
              }
            : undefined
        let endpointWrites = 0
        let endpointSkips = 0
        let endpointDetailFetches = 0
        for (const row of rows) {
          if (writeCount >= maxWrites) break
          const detailFetch = await this.fetchRecordedSiteRowDetails(row, entityDetailEndpoints, tab.replay, domainAuth)
          fetchCount += detailFetch.fetchCount
          endpointDetailFetches += detailFetch.fetchCount
          for (const output of detailFetch.outputs) outputs.push(output)
          for (const item of detailFetch.missing) missing.push(item)
          const enrichedRow = detailFetch.row
          const sourceKey = sourceKeyForRecordedSiteRow(enrichedRow)
          const sourceHash = stableSourceHash(enrichedRow)
          const mapping = mappings.get(sourceKey)
          const rowPlan = recordedSiteRowSyncPlan(entity, enrichedRow, mapping, sourceHash)
          if (rowPlan.action === 'conflict') {
            skippedCount += 1
            endpointSkips += 1
            missing.push(`${entity} conflict ${sourceKey}`)
            continue
          }
          if (rowPlan.action === 'noop' || (rowPlan.action === 'update' && !params.allowUpdates)) {
            skippedCount += 1
            endpointSkips += 1
            continue
          }

          const bodyPlan = recordedSiteAiCrmsBody(entity, enrichedRow, {
            action: rowPlan.action,
            mapping,
            dependencyMappings
          })
          const rowMissing = [...rowPlan.missingFields, ...bodyPlan.missing]
          if (rowMissing.length) {
            skippedCount += 1
            endpointSkips += 1
            missing.push(`${entity} ${sourceKey} missing ${Array.from(new Set(rowMissing)).join(', ')}`)
            continue
          }

          const commands = recordedSiteAiCrmsCommands(entity, rowPlan.action, bodyPlan.body)
          if (!commands.length) {
            skippedCount += 1
            endpointSkips += 1
            missing.push(`${entity} ${rowPlan.action} apply command`)
            continue
          }
          let aiCrmsId = stringFrom(bodyPlan.body.id) || stringFrom(bodyPlan.body.mcu_record_id)
          let rowFailed = false
          for (const command of commands) {
            if (writeCount >= maxWrites) {
              rowFailed = true
              missing.push('max writes reached')
              break
            }
            const cli = await runMicromeetCli(command.name, command.args, { timeoutMs: 60_000 })
            cliCommandCount += 1
            const commandAiCrmsId = aiCrmsIdFromResponse(cli.json) || stringFrom(command.body.id) || stringFrom(command.body.mcu_record_id)
            if (commandAiCrmsId) aiCrmsId = commandAiCrmsId
            outputs.push({
              name: command.name,
              ok: cli.ok && Boolean(commandAiCrmsId || aiCrmsId),
              command: command.preview,
              exitCode: cli.exitCode,
              durationMs: cli.durationMs,
              summary: cli.ok ? `${rowPlan.action} ${entity}${aiCrmsId ? ` -> ${aiCrmsId}` : ''}` : undefined,
              error: cli.ok && !commandAiCrmsId && !aiCrmsId ? 'AI-CRMS id was not returned; mapping was not updated.' : cli.error
            })
            if (!cli.ok || (!commandAiCrmsId && !aiCrmsId)) {
              failed = !cli.ok
              rowFailed = true
              missing.push(cli.ok ? `${entity} AI-CRMS id` : `${entity} ${rowPlan.action}`)
              break
            }
            writeCount += 1
            endpointWrites += 1
          }
          if (rowFailed) {
            skippedCount += 1
            endpointSkips += 1
            if (failed) break
            continue
          }
          if (rowPlan.action === 'create') createCount += 1
          if (rowPlan.action === 'update') updateCount += 1
          const mappingResult = await integrationMappingStore.upsertMapping({
            targetId: target.id,
            entity,
            sourceKey,
            sourceHash,
            aiCrmsId,
            aiCrmsLabel: recordedSiteSourceLabel(entity, enrichedRow),
            sourceLabel: recordedSiteSourceLabel(entity, enrichedRow),
            status: 'linked',
            lastSyncedAt: Date.now(),
            metadata: {
              lastAction: rowPlan.action,
              endpointId: endpoint.id
            }
          })
          if (mappingResult.mapping) mappings.set(sourceKey, mappingResult.mapping)
        }
        outputs.push({
          name: `${endpoint.method} ${endpoint.path}`,
          ok: !failed,
          command: `${endpoint.method} ${endpointPlan.url}`,
          summary: `${endpointWrites} write(s), ${endpointSkips} skipped, ${endpointDetailFetches} detail fetch(es)`
        })
      }
    }

    if (!writeCount && !failed) missing.push('eligible source rows to apply')
    notes.push(`Apply total: ${writeCount} write(s), ${createCount} create, ${updateCount} update, ${skippedCount} skipped, limit ${maxWrites}.`)
    const status = missing.includes('recorded-site target') || failed || (!fetchCount && endpoints.length > 0) ? 'failed' : missing.length || skippedCount ? 'warning' : 'success'
    return {
      id: randomUUID(),
      mode: 'apply',
      status,
      startedAt,
      finishedAt: Date.now(),
      endpointCount: endpoints.length,
      readCount: endpoints.length,
      writeCount: target.endpoints.filter((endpoint) => endpoint.role === 'write').length,
      entityCount: target.entities.length,
      commandCount: fetchCount + cliCommandCount,
      notes,
      missing: Array.from(new Set(missing)),
      outputs
    }
  }

  async fetchRecordedSiteRowDetails(
    row: unknown,
    detailEndpoints: IntegrationEndpointContract[],
    replay: ReplayEngine,
    auth: AuthHint | AuthHint[] | null
  ): Promise<{
    row: unknown
    fetchCount: number
    outputs: IntegrationRunOutput[]
    missing: string[]
  }> {
    if (!detailEndpoints.length) return { row, fetchCount: 0, outputs: [], missing: [] }
    const outputs: IntegrationRunOutput[] = []
    const missing: string[] = []
    const details: unknown[] = []
    let fetchCount = 0
    for (const endpoint of detailEndpoints) {
      const plan = recordedSiteRowDetailUrl(endpoint, row)
      if (!plan.ok || !plan.url) {
        missing.push(plan.error || `${endpoint.method} ${endpoint.path} detail url`)
        continue
      }
      const result = await replay.apiFetch({ method: endpoint.method, url: plan.url }, auth)
      fetchCount += 1
      this._state.broadcastApiActivity(endpoint.method, plan.url, result.ok, result.auth)
      outputs.push({
        name: `${endpoint.method} ${endpoint.path}`,
        ok: result.ok,
        command: `${endpoint.method} ${recordedSiteRedactDetailUrl(plan.url)}`,
        summary: result.ok ? 'detail fetched' : 'detail fetch failed',
        error: result.ok ? undefined : result.error || `HTTP ${result.status}`
      })
      if (result.ok) details.push(result.data)
      else missing.push(`${endpoint.method} ${endpoint.path}`)
    }
    if (!details.length) return { row, fetchCount, outputs, missing }
    return {
      row: mergeRecordedSiteRowDetails(row, details),
      fetchCount,
      outputs,
      missing
    }
  }

  async runIntegrationMigration(params: IntegrationMigrationRunRequest): Promise<IntegrationTargetRunResult> {
    const result = await integrationTargetStore.runMigration(params)
    xpcMain.broadcast('coach/integration-targets-changed', {
      targetId: result.targetId,
      migration: true,
      apply: Boolean(params.apply),
      ts: Date.now()
    })
    return result
  }

  async runIntegrationReportReadiness(params: IntegrationReportReadinessRequest): Promise<IntegrationTargetRunResult> {
    const result = await integrationTargetStore.runReportReadiness(params)
    xpcMain.broadcast('coach/integration-targets-changed', {
      targetId: result.targetId,
      readiness: true,
      generate: Boolean(params.generate),
      ts: Date.now()
    })
    return result
  }

  async setIntegrationTargetSchedule(params: IntegrationTargetScheduleRequest): Promise<IntegrationTargetScheduleResult> {
    const result = await integrationTargetStore.setSchedule(params)
    if (result.ok) {
      xpcMain.broadcast('coach/integration-targets-changed', {
        targetId: result.targetId,
        schedule: true,
        enabled: result.target?.schedule.enabled,
        ts: Date.now()
      })
    }
    return result
  }

  async listIntegrationMappings(params: IntegrationMappingListRequest): Promise<IntegrationMappingListResult> {
    return await integrationMappingStore.listMappings(params)
  }

  async upsertIntegrationMapping(params: IntegrationMappingUpsertRequest): Promise<IntegrationMappingWriteResult> {
    const result = await integrationMappingStore.upsertMapping(params)
    if (result.ok) {
      xpcMain.broadcast('coach/integration-targets-changed', {
        targetId: result.targetId,
        mappings: true,
        ts: Date.now()
      })
    }
    return result
  }

  async deleteIntegrationMapping(params: IntegrationMappingDeleteRequest): Promise<IntegrationMappingWriteResult> {
    const result = await integrationMappingStore.deleteMapping(params)
    if (result.ok) {
      xpcMain.broadcast('coach/integration-targets-changed', {
        targetId: result.targetId,
        mappings: true,
        deleted: true,
        ts: Date.now()
      })
    }
    return result
  }

  handleIntegrationSchedulerEvent(event: IntegrationSchedulerEvent): void {
    xpcMain.broadcast('coach/integration-targets-changed', {
      targetId: event.targetId,
      schedule: true,
      phase: event.phase,
      nextRunAt: event.nextRunAt,
      ts: Date.now()
    })
    if (event.phase === 'scheduled') return
    this._state.broadcastActivity(
      'tool',
      `${event.phase === 'started' ? 'started' : 'finished'} scheduled integration ${event.targetId}${event.runKind ? ` (${event.runKind})` : ''}`,
      event.phase !== 'failed'
    )
  }

  async toolListIntegrationTargets(targetId?: string): Promise<string> {
    if (targetId) {
      const target = await this.getIntegrationTarget({ targetId })
      this._state.broadcastActivity('tool', `read integration target ${targetId}`, Boolean(target))
      return JSON.stringify({ ok: Boolean(target), target }, null, 2)
    }
    const targets = await this.listIntegrationTargets()
    this._state.broadcastActivity('tool', `read integration targets (${targets.length})`)
    return JSON.stringify({ ok: true, targets }, null, 2)
  }

  async toolCreateIntegrationTargetFromCapture(name?: string, domain?: string): Promise<string> {
    const startedAt = Date.now()
    this._state.broadcastActivity('tool', 'create integration target from capture')
    const result = await this.createIntegrationTargetFromCapture({ name, domain })
    this._state.broadcastActivity(
      'tool',
      appendActivityDuration(
        result.ok ? `created integration target (${result.target?.endpoints.length || 0} endpoints)` : `create integration target failed: ${result.error || result.message}`,
        startedAt
      ),
      result.ok
    )
    return JSON.stringify(result, null, 2)
  }

  async toolCreateAiCrmsMigrationTarget(paramsJson: string): Promise<string> {
    const startedAt = Date.now()
    let params: IntegrationMigrationTargetRequest
    try {
      const raw = JSON.parse(paramsJson || '{}') as Record<string, unknown>
      const domains = Array.isArray(raw.domains)
        ? raw.domains.map(String)
        : typeof raw.domains === 'string'
          ? raw.domains
              .split(',')
              .map((item) => item.trim())
              .filter(Boolean)
          : undefined
      params = {
        name: raw.name ? String(raw.name) : undefined,
        source: String(raw.source || '').trim(),
        target: String(raw.target || '').trim(),
        domains
      }
    } catch (err) {
      return JSON.stringify({ ok: false, error: 'invalid-json', message: (err as Error).message }, null, 2)
    }
    this._state.broadcastActivity('tool', 'create AI-CRMS migration target')
    const result = await this.createAiCrmsMigrationTarget(params)
    this._state.broadcastActivity(
      'tool',
      appendActivityDuration(
        result.ok
          ? `created migration target (${result.target?.source.migration?.domains.length || 0} domains)`
          : `create migration target failed: ${result.error || result.message}`,
        startedAt
      ),
      result.ok
    )
    return JSON.stringify(result, null, 2)
  }

  async toolRunIntegrationDryRun(targetId: string): Promise<string> {
    const startedAt = Date.now()
    this._state.broadcastActivity('tool', `run integration dry-run ${targetId}`)
    const result = await this.runIntegrationTargetDryRun({ targetId })
    this._state.broadcastActivity(
      'tool',
      appendActivityDuration(result.ok ? `integration dry-run ${result.run?.status || 'finished'}` : `integration dry-run failed: ${result.error || result.message}`, startedAt),
      result.ok
    )
    return JSON.stringify(result, null, 2)
  }

  async toolRunRecordedSiteSyncDryRun(paramsJson: string): Promise<string> {
    const startedAt = Date.now()
    let params: IntegrationRecordedSiteSyncRequest
    try {
      const raw = JSON.parse(paramsJson || '{}') as Record<string, unknown>
      const endpointIds = Array.isArray(raw.endpoint_ids)
        ? raw.endpoint_ids.map(String)
        : Array.isArray(raw.endpointIds)
          ? raw.endpointIds.map(String)
          : typeof raw.endpoint_ids === 'string'
            ? raw.endpoint_ids
                .split(',')
                .map((item) => item.trim())
                .filter(Boolean)
            : typeof raw.endpointIds === 'string'
              ? raw.endpointIds
                  .split(',')
                  .map((item) => item.trim())
                  .filter(Boolean)
              : undefined
      params = {
        targetId: String(raw.target_id || raw.targetId || '').trim(),
        endpointIds,
        maxEndpoints: Number.isFinite(Number(raw.max_endpoints || raw.maxEndpoints)) ? Number(raw.max_endpoints || raw.maxEndpoints) : undefined,
        maxRowsPerEndpoint: Number.isFinite(Number(raw.max_rows_per_endpoint || raw.maxRowsPerEndpoint)) ? Number(raw.max_rows_per_endpoint || raw.maxRowsPerEndpoint) : undefined
      }
    } catch (err) {
      return JSON.stringify({ ok: false, error: 'invalid-json', message: (err as Error).message }, null, 2)
    }
    if (!params.targetId) {
      return JSON.stringify({ ok: false, error: 'missing-target-id', message: 'target_id is required' }, null, 2)
    }
    this._state.broadcastActivity('tool', `recorded-site sync dry-run ${params.targetId}`)
    const result = await this.runIntegrationRecordedSiteDryRun(params)
    this._state.broadcastActivity(
      'tool',
      appendActivityDuration(
        result.ok ? `recorded-site dry-run ${result.run?.status || 'finished'}` : `recorded-site dry-run failed: ${result.error || result.message}`,
        startedAt
      ),
      result.ok
    )
    return JSON.stringify(result, null, 2)
  }

  async toolRunRecordedSiteSyncPlan(paramsJson: string): Promise<string> {
    const startedAt = Date.now()
    let params: IntegrationRecordedSiteSyncRequest
    try {
      const raw = JSON.parse(paramsJson || '{}') as Record<string, unknown>
      const endpointIds = Array.isArray(raw.endpoint_ids)
        ? raw.endpoint_ids.map(String)
        : Array.isArray(raw.endpointIds)
          ? raw.endpointIds.map(String)
          : typeof raw.endpoint_ids === 'string'
            ? raw.endpoint_ids
                .split(',')
                .map((item) => item.trim())
                .filter(Boolean)
            : typeof raw.endpointIds === 'string'
              ? raw.endpointIds
                  .split(',')
                  .map((item) => item.trim())
                  .filter(Boolean)
              : undefined
      params = {
        targetId: String(raw.target_id || raw.targetId || '').trim(),
        endpointIds,
        maxEndpoints: Number.isFinite(Number(raw.max_endpoints || raw.maxEndpoints)) ? Number(raw.max_endpoints || raw.maxEndpoints) : undefined,
        maxRowsPerEndpoint: Number.isFinite(Number(raw.max_rows_per_endpoint || raw.maxRowsPerEndpoint)) ? Number(raw.max_rows_per_endpoint || raw.maxRowsPerEndpoint) : undefined
      }
    } catch (err) {
      return JSON.stringify({ ok: false, error: 'invalid-json', message: (err as Error).message }, null, 2)
    }
    if (!params.targetId) {
      return JSON.stringify({ ok: false, error: 'missing-target-id', message: 'target_id is required' }, null, 2)
    }
    this._state.broadcastActivity('tool', `recorded-site sync plan ${params.targetId}`)
    const result = await this.runIntegrationRecordedSitePlan(params)
    this._state.broadcastActivity(
      'tool',
      appendActivityDuration(
        result.ok ? `recorded-site sync plan ${result.run?.status || 'finished'}` : `recorded-site sync plan failed: ${result.error || result.message}`,
        startedAt
      ),
      result.ok
    )
    return JSON.stringify(result, null, 2)
  }

  async toolRunRecordedSiteSyncApply(paramsJson: string): Promise<string> {
    const startedAt = Date.now()
    let params: IntegrationRecordedSiteApplyRequest
    try {
      const raw = JSON.parse(paramsJson || '{}') as Record<string, unknown>
      const endpointIds = Array.isArray(raw.endpoint_ids)
        ? raw.endpoint_ids.map(String)
        : Array.isArray(raw.endpointIds)
          ? raw.endpointIds.map(String)
          : typeof raw.endpoint_ids === 'string'
            ? raw.endpoint_ids
                .split(',')
                .map((item) => item.trim())
                .filter(Boolean)
            : typeof raw.endpointIds === 'string'
              ? raw.endpointIds
                  .split(',')
                  .map((item) => item.trim())
                  .filter(Boolean)
              : undefined
      const entities = Array.isArray(raw.entities)
        ? raw.entities.map(String).filter((item): item is IntegrationEntity => RECORDED_SITE_APPLY_ENTITIES.includes(item as IntegrationEntity))
        : typeof raw.entities === 'string'
          ? raw.entities
              .split(',')
              .map((item) => item.trim())
              .filter((item): item is IntegrationEntity => RECORDED_SITE_APPLY_ENTITIES.includes(item as IntegrationEntity))
          : undefined
      params = {
        targetId: String(raw.target_id || raw.targetId || '').trim(),
        endpointIds,
        maxEndpoints: Number.isFinite(Number(raw.max_endpoints || raw.maxEndpoints)) ? Number(raw.max_endpoints || raw.maxEndpoints) : undefined,
        maxRowsPerEndpoint: Number.isFinite(Number(raw.max_rows_per_endpoint || raw.maxRowsPerEndpoint)) ? Number(raw.max_rows_per_endpoint || raw.maxRowsPerEndpoint) : undefined,
        maxWrites: Number.isFinite(Number(raw.max_writes || raw.maxWrites)) ? Number(raw.max_writes || raw.maxWrites) : undefined,
        allowUpdates: raw.allow_updates === true || raw.allowUpdates === true || raw.allow_updates === 'true' || raw.allowUpdates === 'true',
        apply: raw.apply === true || raw.apply === 'true',
        entities
      }
    } catch (err) {
      return JSON.stringify({ ok: false, error: 'invalid-json', message: (err as Error).message }, null, 2)
    }
    if (!params.targetId) {
      return JSON.stringify({ ok: false, error: 'missing-target-id', message: 'target_id is required' }, null, 2)
    }
    if (params.apply !== true) {
      return JSON.stringify(
        {
          ok: false,
          error: 'apply-confirmation-required',
          message: 'params_json must include {"apply":true}.'
        },
        null,
        2
      )
    }
    this._state.broadcastActivity('tool', `recorded-site sync apply ${params.targetId}`)
    const result = await this.runIntegrationRecordedSiteApply(params)
    this._state.broadcastActivity(
      'tool',
      appendActivityDuration(
        result.ok ? `recorded-site sync apply ${result.run?.status || 'finished'}` : `recorded-site sync apply failed: ${result.error || result.message}`,
        startedAt
      ),
      result.ok
    )
    return JSON.stringify(result, null, 2)
  }

  async toolRunIntegrationMigration(paramsJson: string): Promise<string> {
    const startedAt = Date.now()
    let params: IntegrationMigrationRunRequest
    try {
      const raw = JSON.parse(paramsJson || '{}') as Record<string, unknown>
      const domains = Array.isArray(raw.domains)
        ? raw.domains.map(String)
        : typeof raw.domains === 'string'
          ? raw.domains
              .split(',')
              .map((item) => item.trim())
              .filter(Boolean)
          : undefined
      params = {
        targetId: String(raw.target_id || raw.targetId || '').trim(),
        apply: raw.apply === true || raw.apply === 'true',
        domains,
        timeoutMs: Number.isFinite(Number(raw.timeout_ms || raw.timeoutMs)) ? Number(raw.timeout_ms || raw.timeoutMs) : undefined
      }
    } catch (err) {
      return JSON.stringify({ ok: false, error: 'invalid-json', message: (err as Error).message }, null, 2)
    }
    if (!params.targetId) {
      return JSON.stringify({ ok: false, error: 'missing-target-id', message: 'target_id is required' }, null, 2)
    }
    this._state.broadcastActivity('tool', `${params.apply ? 'apply' : 'dry-run'} AI-CRMS migration ${params.targetId}`)
    const result = await this.runIntegrationMigration(params)
    this._state.broadcastActivity(
      'tool',
      appendActivityDuration(result.ok ? `AI-CRMS migration ${result.run?.status || 'finished'}` : `AI-CRMS migration failed: ${result.error || result.message}`, startedAt),
      result.ok
    )
    return JSON.stringify(result, null, 2)
  }

  async toolRunIntegrationReportReadiness(paramsJson: string): Promise<string> {
    const startedAt = Date.now()
    let params: IntegrationReportReadinessRequest
    try {
      const raw = JSON.parse(paramsJson || '{}') as Record<string, unknown>
      const ids = Array.isArray(raw.mcu_record_ids)
        ? raw.mcu_record_ids.map(String)
        : Array.isArray(raw.mcuRecordIds)
          ? raw.mcuRecordIds.map(String)
          : typeof raw.mcu_record_ids === 'string'
            ? raw.mcu_record_ids
                .split(',')
                .map((item) => item.trim())
                .filter(Boolean)
            : typeof raw.mcuRecordIds === 'string'
              ? raw.mcuRecordIds
                  .split(',')
                  .map((item) => item.trim())
                  .filter(Boolean)
              : undefined
      params = {
        targetId: String(raw.target_id || raw.targetId || '').trim(),
        mcuRecordIds: ids,
        keyword: raw.keyword ? String(raw.keyword) : undefined,
        corporateId: raw.corporate_id ? String(raw.corporate_id) : raw.corporateId ? String(raw.corporateId) : undefined,
        projectId: raw.project_id ? String(raw.project_id) : raw.projectId ? String(raw.projectId) : undefined,
        pageSize: Number.isFinite(Number(raw.page_size || raw.pageSize)) ? Number(raw.page_size || raw.pageSize) : undefined,
        generate: raw.generate === true || raw.generate === 'true',
        send: raw.send === true || raw.send === 'true'
      }
    } catch (err) {
      return JSON.stringify({ ok: false, error: 'invalid-json', message: (err as Error).message }, null, 2)
    }
    if (!params.targetId) {
      return JSON.stringify({ ok: false, error: 'missing-target-id', message: 'target_id is required' }, null, 2)
    }
    this._state.broadcastActivity('tool', `${params.generate ? 'run' : 'check'} AI-CRMS report readiness ${params.targetId}`)
    const result = await this.runIntegrationReportReadiness(params)
    this._state.broadcastActivity(
      'tool',
      appendActivityDuration(result.ok ? `AI-CRMS readiness ${result.run?.status || 'finished'}` : `AI-CRMS readiness failed: ${result.error || result.message}`, startedAt),
      result.ok
    )
    return JSON.stringify(result, null, 2)
  }

  async toolSetIntegrationSchedule(paramsJson: string): Promise<string> {
    const startedAt = Date.now()
    let params: IntegrationTargetScheduleRequest
    try {
      const raw = JSON.parse(paramsJson || '{}') as Record<string, unknown>
      params = {
        targetId: String(raw.target_id || raw.targetId || '').trim(),
        enabled: raw.enabled === true || raw.enabled === 'true',
        intervalMinutes: Number.isFinite(Number(raw.interval_minutes || raw.intervalMinutes)) ? Number(raw.interval_minutes || raw.intervalMinutes) : undefined,
        runKind:
          raw.run_kind === 'migration-dry-run' || raw.runKind === 'migration-dry-run'
            ? 'migration-dry-run'
            : raw.run_kind === 'report-readiness' || raw.runKind === 'report-readiness'
              ? 'report-readiness'
              : raw.run_kind === 'recorded-site-dry-run' || raw.runKind === 'recorded-site-dry-run'
                ? 'recorded-site-dry-run'
                : raw.run_kind === 'safe-default' || raw.runKind === 'safe-default'
                  ? 'safe-default'
                  : undefined
      }
    } catch (err) {
      return JSON.stringify({ ok: false, error: 'invalid-json', message: (err as Error).message }, null, 2)
    }
    if (!params.targetId) {
      return JSON.stringify({ ok: false, error: 'missing-target-id', message: 'target_id is required' }, null, 2)
    }
    this._state.broadcastActivity('tool', `${params.enabled ? 'enable' : 'disable'} integration schedule ${params.targetId}`)
    const result = await this.setIntegrationTargetSchedule(params)
    this._state.broadcastActivity(
      'tool',
      appendActivityDuration(
        result.ok ? `integration schedule ${result.target?.schedule.enabled ? 'enabled' : 'disabled'}` : `integration schedule failed: ${result.error || result.message}`,
        startedAt
      ),
      result.ok
    )
    return JSON.stringify(result, null, 2)
  }

  async toolListIntegrationMappings(paramsJson: string): Promise<string> {
    let params: IntegrationMappingListRequest
    try {
      const raw = JSON.parse(paramsJson || '{}') as Record<string, unknown>
      params = {
        targetId: String(raw.target_id || raw.targetId || '').trim(),
        entity: typeof raw.entity === 'string' ? (raw.entity as IntegrationMappingListRequest['entity']) : undefined,
        limit: Number.isFinite(Number(raw.limit)) ? Number(raw.limit) : undefined
      }
    } catch (err) {
      return JSON.stringify({ ok: false, error: 'invalid-json', message: (err as Error).message }, null, 2)
    }
    if (!params.targetId) {
      return JSON.stringify({ ok: false, error: 'missing-target-id', message: 'target_id is required' }, null, 2)
    }
    const result = await this.listIntegrationMappings(params)
    this._state.broadcastActivity('tool', `read integration mappings ${params.targetId} (${result.summary.total})`, result.ok)
    return JSON.stringify(result, null, 2)
  }

  async toolUpsertIntegrationMapping(paramsJson: string): Promise<string> {
    const startedAt = Date.now()
    let params: IntegrationMappingUpsertRequest
    try {
      const raw = JSON.parse(paramsJson || '{}') as Record<string, unknown>
      params = {
        targetId: String(raw.target_id || raw.targetId || '').trim(),
        entity: String(raw.entity || '') as IntegrationMappingUpsertRequest['entity'],
        sourceKey: String(raw.source_key || raw.sourceKey || '').trim(),
        sourceLabel: raw.source_label ? String(raw.source_label) : raw.sourceLabel ? String(raw.sourceLabel) : undefined,
        aiCrmsId: raw.ai_crms_id ? String(raw.ai_crms_id) : raw.aiCrmsId ? String(raw.aiCrmsId) : undefined,
        aiCrmsLabel: raw.ai_crms_label ? String(raw.ai_crms_label) : raw.aiCrmsLabel ? String(raw.aiCrmsLabel) : undefined,
        status: typeof raw.status === 'string' ? (raw.status as IntegrationMappingUpsertRequest['status']) : undefined,
        sourceHash: raw.source_hash ? String(raw.source_hash) : raw.sourceHash ? String(raw.sourceHash) : undefined,
        lastSyncedAt: Number.isFinite(Number(raw.last_synced_at || raw.lastSyncedAt)) ? Number(raw.last_synced_at || raw.lastSyncedAt) : undefined,
        metadata: raw.metadata && typeof raw.metadata === 'object' && !Array.isArray(raw.metadata) ? (raw.metadata as Record<string, unknown>) : undefined
      }
    } catch (err) {
      return JSON.stringify({ ok: false, error: 'invalid-json', message: (err as Error).message }, null, 2)
    }
    this._state.broadcastActivity('tool', `upsert integration mapping ${params.targetId || '(missing target)'}`)
    const result = await this.upsertIntegrationMapping(params)
    this._state.broadcastActivity(
      'tool',
      appendActivityDuration(result.ok ? `integration mapping ${result.mapping?.status || 'saved'}` : `integration mapping failed: ${result.error || result.message}`, startedAt),
      result.ok
    )
    return JSON.stringify(result, null, 2)
  }

  async toolDeleteIntegrationMapping(paramsJson: string): Promise<string> {
    const startedAt = Date.now()
    let params: IntegrationMappingDeleteRequest
    try {
      const raw = JSON.parse(paramsJson || '{}') as Record<string, unknown>
      params = {
        targetId: String(raw.target_id || raw.targetId || '').trim(),
        entity: String(raw.entity || '') as IntegrationMappingDeleteRequest['entity'],
        sourceKey: String(raw.source_key || raw.sourceKey || '').trim()
      }
    } catch (err) {
      return JSON.stringify({ ok: false, error: 'invalid-json', message: (err as Error).message }, null, 2)
    }
    this._state.broadcastActivity('tool', `delete integration mapping ${params.targetId || '(missing target)'}`)
    const result = await this.deleteIntegrationMapping(params)
    this._state.broadcastActivity(
      'tool',
      appendActivityDuration(result.ok ? 'integration mapping deleted' : `delete mapping failed: ${result.error || result.message}`, startedAt),
      result.ok
    )
    return JSON.stringify(result, null, 2)
  }
}
