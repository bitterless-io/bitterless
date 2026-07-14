import { createHash } from 'crypto'
import { createXpcMainEmitter } from 'electron-xpc/main'
import {
  INTEGRATION_MAPPING_CONFIG_DOMAIN,
  INTEGRATION_MAPPING_KEY_PREFIX,
  type ConfigApi
} from '@cowork-shared/config.api'
import type {
  IntegrationEntity,
  IntegrationMappingDeleteRequest,
  IntegrationMappingEntry,
  IntegrationMappingListRequest,
  IntegrationMappingListResult,
  IntegrationMappingStatus,
  IntegrationMappingSummary,
  IntegrationMappingUpsertRequest,
  IntegrationMappingWriteResult
} from '@cowork-shared/coach.api'

const configStore = createXpcMainEmitter<ConfigApi>('ConfigDao')

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

const stringValue = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback

const numberValue = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

const sourceKeyHash = (sourceKey: string): string =>
  createHash('sha1').update(sourceKey).digest('hex').slice(0, 20)

const mappingKey = (targetId: string, entity: IntegrationEntity, sourceKey: string): string =>
  `${INTEGRATION_MAPPING_KEY_PREFIX}${targetId}:${entity}:${sourceKeyHash(sourceKey)}`

const targetPrefix = (targetId: string): string =>
  `${INTEGRATION_MAPPING_KEY_PREFIX}${targetId}:`

const isIntegrationEntity = (value: unknown): value is IntegrationEntity =>
  value === 'patient' ||
  value === 'corporate' ||
  value === 'project' ||
  value === 'data_mapping' ||
  value === 'mcu_record' ||
  value === 'mcu_report'

const normalizeStatus = (value: unknown, aiCrmsId = ''): IntegrationMappingStatus => {
  if (value === 'pending' || value === 'linked' || value === 'conflict' || value === 'ignored') return value
  return aiCrmsId ? 'linked' : 'pending'
}

const normalizeMetadata = (value: unknown): Record<string, unknown> | undefined => {
  const raw = asRecord(value)
  return Object.keys(raw).length ? raw : undefined
}

const normalizeMapping = (value: unknown): IntegrationMappingEntry | null => {
  const raw = asRecord(value)
  const targetId = stringValue(raw.targetId)
  const entity = raw.entity
  const sourceKey = stringValue(raw.sourceKey)
  if (!targetId || !isIntegrationEntity(entity) || !sourceKey) return null
  const aiCrmsId = stringValue(raw.aiCrmsId)
  return {
    id: stringValue(raw.id) || `${targetId}:${entity}:${sourceKeyHash(sourceKey)}`,
    targetId,
    entity,
    sourceKey,
    sourceLabel: stringValue(raw.sourceLabel) || undefined,
    aiCrmsId: aiCrmsId || undefined,
    aiCrmsLabel: stringValue(raw.aiCrmsLabel) || undefined,
    status: normalizeStatus(raw.status, aiCrmsId),
    sourceHash: stringValue(raw.sourceHash) || undefined,
    lastSyncedAt: numberValue(raw.lastSyncedAt) || undefined,
    metadata: normalizeMetadata(raw.metadata),
    createdAt: numberValue(raw.createdAt, Date.now()),
    updatedAt: numberValue(raw.updatedAt, Date.now())
  }
}

const emptySummary = (): IntegrationMappingSummary => ({
  total: 0,
  byEntity: {},
  byStatus: {}
})

const summarizeMappings = (mappings: IntegrationMappingEntry[]): IntegrationMappingSummary => {
  const summary = emptySummary()
  summary.total = mappings.length
  for (const mapping of mappings) {
    summary.byEntity[mapping.entity] = (summary.byEntity[mapping.entity] || 0) + 1
    summary.byStatus[mapping.status] = (summary.byStatus[mapping.status] || 0) + 1
  }
  return summary
}

const clampLimit = (value: unknown): number => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 100
  return Math.min(500, Math.max(1, Math.round(numeric)))
}

class IntegrationMappingStore {
  async listMappings(params: IntegrationMappingListRequest): Promise<IntegrationMappingListResult> {
    const targetId = String(params.targetId || '').trim()
    if (!targetId) {
      return { ok: false, targetId: '', mappings: [], summary: emptySummary(), message: 'Missing target id.', error: 'missing-target-id' }
    }
    const rows = await configStore.list({ domain: INTEGRATION_MAPPING_CONFIG_DOMAIN }).catch(() => [])
    const all = rows
      .filter((row) => row.key.startsWith(targetPrefix(targetId)))
      .map((row) => normalizeMapping(row.options))
      .filter((mapping): mapping is IntegrationMappingEntry => Boolean(mapping))
      .filter((mapping) => !params.entity || mapping.entity === params.entity)
      .sort((a, b) => b.updatedAt - a.updatedAt)
    return {
      ok: true,
      targetId,
      mappings: all.slice(0, clampLimit(params.limit)),
      summary: summarizeMappings(all)
    }
  }

  async upsertMapping(params: IntegrationMappingUpsertRequest): Promise<IntegrationMappingWriteResult> {
    const targetId = String(params.targetId || '').trim()
    const sourceKey = String(params.sourceKey || '').trim()
    if (!targetId) return { ok: false, targetId: '', message: 'Missing target id.', error: 'missing-target-id' }
    if (!isIntegrationEntity(params.entity)) return { ok: false, targetId, message: 'Invalid integration entity.', error: 'invalid-entity' }
    if (!sourceKey) return { ok: false, targetId, message: 'Missing source key.', error: 'missing-source-key' }

    const key = mappingKey(targetId, params.entity, sourceKey)
    const existingRow = await configStore.get({ domain: INTEGRATION_MAPPING_CONFIG_DOMAIN, key }).catch(() => null)
    const existing = normalizeMapping(existingRow?.options)
    const now = Date.now()
    const aiCrmsId = String(params.aiCrmsId || existing?.aiCrmsId || '').trim()
    const mapping: IntegrationMappingEntry = {
      id: existing?.id || `${targetId}:${params.entity}:${sourceKeyHash(sourceKey)}`,
      targetId,
      entity: params.entity,
      sourceKey,
      sourceLabel: params.sourceLabel ?? existing?.sourceLabel,
      aiCrmsId: aiCrmsId || undefined,
      aiCrmsLabel: params.aiCrmsLabel ?? existing?.aiCrmsLabel,
      status: normalizeStatus(params.status || existing?.status, aiCrmsId),
      sourceHash: params.sourceHash ?? existing?.sourceHash,
      lastSyncedAt: params.lastSyncedAt || existing?.lastSyncedAt,
      metadata: params.metadata ?? existing?.metadata,
      createdAt: existing?.createdAt || now,
      updatedAt: now
    }
    await configStore.upsert({
      domain: INTEGRATION_MAPPING_CONFIG_DOMAIN,
      key,
      options: mapping
    })
    return {
      ok: true,
      targetId,
      mapping,
      message: existing ? 'Integration mapping updated.' : 'Integration mapping created.'
    }
  }

  async deleteMapping(params: IntegrationMappingDeleteRequest): Promise<IntegrationMappingWriteResult> {
    const targetId = String(params.targetId || '').trim()
    const sourceKey = String(params.sourceKey || '').trim()
    if (!targetId) return { ok: false, targetId: '', message: 'Missing target id.', error: 'missing-target-id' }
    if (!isIntegrationEntity(params.entity)) return { ok: false, targetId, message: 'Invalid integration entity.', error: 'invalid-entity' }
    if (!sourceKey) return { ok: false, targetId, message: 'Missing source key.', error: 'missing-source-key' }
    await configStore.remove({
      domain: INTEGRATION_MAPPING_CONFIG_DOMAIN,
      key: mappingKey(targetId, params.entity, sourceKey)
    })
    return {
      ok: true,
      targetId,
      message: 'Integration mapping deleted.'
    }
  }

  async deleteTargetMappings(targetId: string): Promise<number> {
    const id = String(targetId || '').trim()
    if (!id) return 0
    const rows = await configStore.list({ domain: INTEGRATION_MAPPING_CONFIG_DOMAIN }).catch(() => [])
    const keys = rows.filter((row) => row.key.startsWith(targetPrefix(id))).map((row) => row.key)
    for (const key of keys) {
      await configStore.remove({ domain: INTEGRATION_MAPPING_CONFIG_DOMAIN, key })
    }
    return keys.length
  }
}

export const integrationMappingStore = new IntegrationMappingStore()
