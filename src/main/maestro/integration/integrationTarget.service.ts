import { createHash, randomUUID } from 'crypto'
import { createXpcMainEmitter } from 'electron-xpc/main'
import {
  INTEGRATION_TARGET_CONFIG_DOMAIN,
  INTEGRATION_TARGET_KEY_PREFIX,
  type ConfigApi
} from '@maestro-shared/config.api'
import type {
  IngestRecord,
  IntegrationEndpointContract,
  IntegrationEntity,
  IntegrationMigrationConfig,
  IntegrationMigrationRunRequest,
  IntegrationMigrationTargetRequest,
  IntegrationReportReadinessRequest,
  IntegrationScheduleRunKind,
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
import type { TraceEvent } from '@maestro-shared/trace.types'
import { runAiCrmsMigration, runAiCrmsReportReadiness } from './integrationRunner.service'
import { integrationMappingStore } from './integrationMapping.service'

const configStore = createXpcMainEmitter<ConfigApi>('ConfigDao')

type NetRequest = Extract<TraceEvent, { kind: 'net.request' }>
type NetResponse = Extract<TraceEvent, { kind: 'net.response' }>

interface Exchange {
  request?: NetRequest
  response?: NetResponse
}

const targetKey = (id: string): string => `${INTEGRATION_TARGET_KEY_PREFIX}${id}`

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}

const stringValue = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback

const numberValue = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

const hostnameOf = (value: string): string => {
  try {
    return new URL(value).hostname.toLowerCase()
  } catch {
    return ''
  }
}

const normalizeDomain = (value: string): string => {
  const trimmed = value.trim()
  if (!trimmed) return ''
  return hostnameOf(trimmed) || trimmed.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase()
}

const safeName = (value: string, fallback: string): string => {
  const trimmed = value.trim().replace(/\s+/g, ' ')
  return trimmed || fallback
}

const DEFAULT_MIGRATION_DOMAINS = [
  'medical_client',
  'mcu_doctor',
  'mcu_client_doctor',
  'patient',
  'patient_institution',
  'mcu_record',
  'mcu_observation',
  'mcu_examination_file',
  'mcu_report',
  'mcu_field_map',
  'file'
]
const DEFAULT_SCHEDULE_INTERVAL_MINUTES = 60
const MIN_SCHEDULE_INTERVAL_MINUTES = 1
const MAX_SCHEDULE_INTERVAL_MINUTES = 1440

const normalizeDomains = (values: unknown): string[] =>
  Array.isArray(values)
    ? Array.from(new Set(values.map((item) => String(item || '').trim()).filter(Boolean)))
    : []

const migrationEntities = (domains: string[]): IntegrationEntity[] => {
  const values = domains.length ? domains : DEFAULT_MIGRATION_DOMAINS
  const out = new Set<IntegrationEntity>()
  for (const domain of values) {
    if (/patient/.test(domain)) out.add('patient')
    if (/client|corporate/.test(domain)) out.add('corporate')
    if (/batch|project/.test(domain)) out.add('project')
    if (/field_map|data_map|mapping/.test(domain)) out.add('data_mapping')
    if (/mcu_record|observation|examination_file/.test(domain)) out.add('mcu_record')
    if (/report|conclusion/.test(domain)) out.add('mcu_report')
  }
  return Array.from(out)
}

const normalizeMigration = (value: unknown): IntegrationMigrationConfig | undefined => {
  const raw = asRecord(value)
  const source = stringValue(raw.source)
  const target = stringValue(raw.target)
  if (!source || !target) return undefined
  return {
    source,
    target,
    domains: normalizeDomains(raw.domains)
  }
}

const normalizeScheduleRunKind = (value: unknown, sourceKind: IntegrationTarget['source']['kind']): IntegrationScheduleRunKind => {
  if (sourceKind === 'recorded-site' && value === 'report-readiness') return 'recorded-site-dry-run'
  if (value === 'migration-dry-run' || value === 'report-readiness' || value === 'recorded-site-dry-run' || value === 'safe-default') return value
  return sourceKind === 'ai-crms-migration' ? 'migration-dry-run' : 'recorded-site-dry-run'
}

const normalizeScheduleInterval = (value: unknown, fallback = DEFAULT_SCHEDULE_INTERVAL_MINUTES): number => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return fallback
  return Math.min(MAX_SCHEDULE_INTERVAL_MINUTES, Math.max(MIN_SCHEDULE_INTERVAL_MINUTES, Math.round(numeric)))
}

const pathTemplate = (url: URL): string => {
  const path = url.pathname
    .split('/')
    .map((part) => {
      if (!part) return part
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(part)) return ':id'
      if (/^\d{5,}$/.test(part)) return ':id'
      if (/^[A-Za-z0-9_-]{20,}$/.test(part)) return ':id'
      return part
    })
    .join('/')
  const queryKeys = Array.from(url.searchParams.keys()).sort()
  if (!queryKeys.length) return path || '/'
  return `${path || '/'}?${queryKeys.map((key) => `${key}=<${key}>`).join('&')}`
}

const endpointId = (method: string, template: string): string =>
  createHash('sha1').update(`${method.toUpperCase()} ${template}`).digest('hex').slice(0, 16)

const requestBodyKind = (req?: NetRequest): IntegrationEndpointContract['requestBodyKind'] => {
  const body = req?.postData || ''
  if (!body) return 'none'
  const contentType = Object.entries(req?.headers || {}).find(([key]) => key.toLowerCase() === 'content-type')?.[1] || ''
  const ct = String(contentType).toLowerCase()
  if (ct.includes('application/json') || /^[\s\n\r]*[\[{]/.test(body)) return 'json'
  if (ct.includes('application/x-www-form-urlencoded') || /^[^=\s]+=[\s\S]*/.test(body)) return 'form'
  return 'raw'
}

const isStaticLike = (req?: NetRequest, res?: NetResponse): boolean => {
  const url = req?.url || res?.url || ''
  const pathname = (() => {
    try {
      return new URL(url).pathname.toLowerCase()
    } catch {
      return url.toLowerCase()
    }
  })()
  if (/\.(css|js|mjs|map|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf|mp4|mov|mp3|wav)(?:$|\?)/i.test(pathname)) return true
  const mime = String(res?.mime || '').toLowerCase()
  if (/^(image|font|audio|video)\//.test(mime)) return true
  if (mime.includes('javascript') || mime.includes('css')) return true
  return false
}

const isLikelyApi = (req?: NetRequest, res?: NetResponse): boolean => {
  if (!req && !res) return false
  if (isStaticLike(req, res)) return false
  const method = String(req?.method || '').toUpperCase()
  if (method && !['GET', 'HEAD', 'OPTIONS'].includes(method)) return true
  const resourceType = String(req?.resourceType || '').toLowerCase()
  if (resourceType === 'xhr' || resourceType === 'fetch') return true
  const url = req?.url || res?.url || ''
  const path = (() => {
    try {
      return new URL(url).pathname.toLowerCase()
    } catch {
      return url.toLowerCase()
    }
  })()
  return /\/(api|mcu|patient|patients|corporate|corporates|project|projects|mapping|data-map|record|report|migration)\b/i.test(path)
}

const detectEntities = (endpoints: IntegrationEndpointContract[]): IntegrationEntity[] => {
  const found = new Set<IntegrationEntity>()
  const text = endpoints.map((endpoint) => endpoint.path.toLowerCase()).join('\n')
  if (/patient|patients/.test(text)) found.add('patient')
  if (/corporate|corporates/.test(text)) found.add('corporate')
  if (/project|projects|batch/.test(text)) found.add('project')
  if (/mapping|data-map|field-map|field_config|field-config/.test(text)) found.add('data_mapping')
  if (/mcu|record|records/.test(text)) found.add('mcu_record')
  if (/report|conclusion|generate|download|send/.test(text)) found.add('mcu_report')
  return Array.from(found)
}

const normalizeTarget = (value: unknown): IntegrationTarget | null => {
  const raw = asRecord(value)
  const id = stringValue(raw.id)
  const name = stringValue(raw.name)
  if (!id || !name) return null
  const source = asRecord(raw.source)
  const destination = asRecord(raw.destination)
  const state = asRecord(raw.state)
  const schedule = asRecord(raw.schedule)
  const endpoints = Array.isArray(raw.endpoints) ? raw.endpoints.map(normalizeEndpoint).filter(Boolean) as IntegrationEndpointContract[] : []
  const sourceKind = source.kind === 'ai-crms-migration' ? 'ai-crms-migration' : 'recorded-site'
  return {
    id,
    name,
    source: {
      kind: sourceKind,
      domain: stringValue(source.domain),
      startUrl: stringValue(source.startUrl) || undefined,
      migration: normalizeMigration(source.migration)
    },
    destination: {
      kind: 'ai-crms',
      region: stringValue(destination.region) || undefined,
      workspaceId: stringValue(destination.workspaceId) || undefined
    },
    entities: Array.isArray(raw.entities) ? raw.entities.filter(isIntegrationEntity) : [],
    schedule: {
      enabled: Boolean(schedule.enabled),
      intervalMinutes: schedule.intervalMinutes === undefined ? undefined : normalizeScheduleInterval(schedule.intervalMinutes),
      cron: stringValue(schedule.cron) || undefined,
      runKind: normalizeScheduleRunKind(schedule.runKind, sourceKind),
      nextRunAt: numberValue(schedule.nextRunAt) || undefined,
      lastScheduledRunAt: numberValue(schedule.lastScheduledRunAt) || undefined
    },
    state: {
      status: normalizeStatus(state.status),
      cursor: asRecord(state.cursor) as Record<string, string>,
      lastRun: normalizeRunSummary(state.lastRun)
    },
    endpoints,
    createdAt: numberValue(raw.createdAt, Date.now()),
    updatedAt: numberValue(raw.updatedAt, Date.now())
  }
}

const normalizeEndpoint = (value: unknown): IntegrationEndpointContract | null => {
  const raw = asRecord(value)
  const id = stringValue(raw.id)
  const method = stringValue(raw.method).toUpperCase()
  const urlTemplate = stringValue(raw.urlTemplate)
  if (!id || !method || !urlTemplate) return null
  return {
    id,
    method,
    host: stringValue(raw.host),
    path: stringValue(raw.path),
    urlTemplate,
    role: raw.role === 'read' || raw.role === 'write' ? raw.role : 'unknown',
    safety: raw.safety === 'safe' || raw.safety === 'unsafe' ? raw.safety : 'confirm',
    count: Math.max(1, numberValue(raw.count, 1)),
    lastSeenAt: numberValue(raw.lastSeenAt, Date.now()),
    sampleStatus: numberValue(raw.sampleStatus) || undefined,
    resourceType: stringValue(raw.resourceType) || undefined,
    requestBodyKind:
      raw.requestBodyKind === 'json' || raw.requestBodyKind === 'form' || raw.requestBodyKind === 'raw'
        ? raw.requestBodyKind
        : 'none',
    responseMime: stringValue(raw.responseMime) || undefined
  }
}

const normalizeRunSummary = (value: unknown): IntegrationRunSummary | undefined => {
  const raw = asRecord(value)
  const id = stringValue(raw.id)
  if (!id) return undefined
  return {
    id,
    mode: raw.mode === 'apply' || raw.mode === 'readiness' ? raw.mode : 'dry-run',
    status: raw.status === 'success' || raw.status === 'failed' ? raw.status : 'warning',
    startedAt: numberValue(raw.startedAt, Date.now()),
    finishedAt: numberValue(raw.finishedAt, Date.now()),
    endpointCount: numberValue(raw.endpointCount),
    readCount: numberValue(raw.readCount),
    writeCount: numberValue(raw.writeCount),
    entityCount: numberValue(raw.entityCount),
    commandCount: numberValue(raw.commandCount) || undefined,
    notes: Array.isArray(raw.notes) ? raw.notes.map(String) : [],
    missing: Array.isArray(raw.missing) ? raw.missing.map(String) : [],
    outputs: Array.isArray(raw.outputs) ? raw.outputs.map(normalizeRunOutput).filter(Boolean) as IntegrationRunOutput[] : undefined
  }
}

const normalizeRunOutput = (value: unknown): IntegrationRunOutput | null => {
  const raw = asRecord(value)
  const name = stringValue(raw.name)
  const command = stringValue(raw.command)
  if (!name || !command) return null
  return {
    name,
    ok: Boolean(raw.ok),
    command,
    exitCode: numberValue(raw.exitCode) || undefined,
    durationMs: numberValue(raw.durationMs) || undefined,
    summary: stringValue(raw.summary) || undefined,
    error: stringValue(raw.error) || undefined
  }
}

const normalizeStatus = (value: unknown): IntegrationTarget['state']['status'] => {
  if (value === 'ready' || value === 'dry-run-ok' || value === 'error') return value
  return 'draft'
}

const isIntegrationEntity = (value: unknown): value is IntegrationEntity =>
  value === 'patient' ||
  value === 'corporate' ||
  value === 'project' ||
  value === 'data_mapping' ||
  value === 'mcu_record' ||
  value === 'mcu_report'

const toSummary = (target: IntegrationTarget): IntegrationTargetSummary => {
  const readCount = target.endpoints.filter((endpoint) => endpoint.role === 'read').length
  const writeCount = target.endpoints.filter((endpoint) => endpoint.role === 'write').length
  return {
    id: target.id,
    name: target.name,
    domain: target.source.domain,
    sourceKind: target.source.kind,
    destinationKind: target.destination.kind,
    entities: target.entities,
    endpointCount: target.endpoints.length,
    readCount,
    writeCount,
    scheduleEnabled: target.schedule.enabled,
    scheduleIntervalMinutes: target.schedule.intervalMinutes,
    scheduleRunKind: target.schedule.runKind,
    scheduleNextRunAt: target.schedule.nextRunAt,
    status: target.state.status,
    lastRunStatus: target.state.lastRun?.status,
    updatedAt: target.updatedAt
  }
}

export const buildIntegrationEndpointContracts = (records: IngestRecord[]): IntegrationEndpointContract[] => {
  const exchanges = new Map<string, Exchange>()
  for (const record of records) {
    const event = record.event
    if (event.kind === 'net.request') {
      const current = exchanges.get(event.requestId) || {}
      current.request = event
      exchanges.set(event.requestId, current)
    } else if (event.kind === 'net.response') {
      const current = exchanges.get(event.requestId) || {}
      current.response = event
      exchanges.set(event.requestId, current)
    }
  }

  const byTemplate = new Map<string, IntegrationEndpointContract>()
  for (const exchange of exchanges.values()) {
    if (!isLikelyApi(exchange.request, exchange.response)) continue
    const rawUrl = exchange.request?.url || exchange.response?.url || ''
    let url: URL
    try {
      url = new URL(rawUrl)
    } catch {
      continue
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') continue
    const method = String(exchange.request?.method || 'GET').toUpperCase()
    const path = pathTemplate(url)
    const template = `${url.origin}${path}`
    const key = `${method} ${template}`
    const role = ['GET', 'HEAD', 'OPTIONS'].includes(method) ? 'read' : 'write'
    const existing = byTemplate.get(key)
    if (existing) {
      existing.count += 1
      existing.lastSeenAt = Math.max(existing.lastSeenAt, exchange.response?.ts || exchange.request?.ts || 0)
      if (exchange.response?.status) existing.sampleStatus = exchange.response.status
      continue
    }
    byTemplate.set(key, {
      id: endpointId(method, template),
      method,
      host: url.hostname.toLowerCase(),
      path,
      urlTemplate: template,
      role,
      safety: role === 'read' ? 'safe' : 'confirm',
      count: 1,
      lastSeenAt: exchange.response?.ts || exchange.request?.ts || Date.now(),
      sampleStatus: exchange.response?.status,
      resourceType: exchange.request?.resourceType,
      requestBodyKind: requestBodyKind(exchange.request),
      responseMime: exchange.response?.mime
    })
  }
  return Array.from(byTemplate.values()).sort((a, b) => a.urlTemplate.localeCompare(b.urlTemplate) || a.method.localeCompare(b.method))
}

class IntegrationTargetStore {
  async listTargets(): Promise<IntegrationTarget[]> {
    const rows = await configStore.list({ domain: INTEGRATION_TARGET_CONFIG_DOMAIN }).catch(() => [])
    return rows
      .filter((row) => row.key.startsWith(INTEGRATION_TARGET_KEY_PREFIX))
      .map((row) => normalizeTarget(row.options))
      .filter(Boolean)
      .sort((a, b) => b.updatedAt - a.updatedAt) as IntegrationTarget[]
  }

  async listSummaries(): Promise<IntegrationTargetSummary[]> {
    return (await this.listTargets()).map(toSummary)
  }

  async getTarget(targetId: string): Promise<IntegrationTarget | null> {
    const id = targetId.trim()
    if (!id) return null
    const row = await configStore.get({ domain: INTEGRATION_TARGET_CONFIG_DOMAIN, key: targetKey(id) }).catch(() => null)
    return normalizeTarget(row?.options)
  }

  async createFromCapture(params: {
    name?: string
    domain?: string
    currentUrl?: string
    records: IngestRecord[]
  }): Promise<IntegrationTargetCreateResult> {
    const endpoints = buildIntegrationEndpointContracts(params.records)
    if (!endpoints.length) {
      return {
        ok: false,
        message: 'No API-like endpoints found in the current capture.',
        error: 'no-api-endpoints'
      }
    }
    const now = Date.now()
    const domain = normalizeDomain(params.domain || params.currentUrl || endpoints[0]?.host || '')
    const id = randomUUID()
    const target: IntegrationTarget = {
      id,
      name: safeName(params.name || '', `${domain || 'Recorded site'} sync target`),
      source: {
        kind: 'recorded-site',
        domain,
        startUrl: params.currentUrl || undefined
      },
      destination: {
        kind: 'ai-crms'
      },
      entities: detectEntities(endpoints),
      schedule: {
        enabled: false,
        runKind: 'recorded-site-dry-run'
      },
      state: {
        status: 'draft',
        cursor: {}
      },
      endpoints,
      createdAt: now,
      updatedAt: now
    }
    await this.saveTarget(target)
    return {
      ok: true,
      target,
      message: `Created integration target with ${endpoints.length} endpoint${endpoints.length === 1 ? '' : 's'}.`
    }
  }

  async createAiCrmsMigrationTarget(params: IntegrationMigrationTargetRequest): Promise<IntegrationTargetCreateResult> {
    const source = String(params.source || '').trim()
    const targetAccount = String(params.target || '').trim()
    if (!source || !targetAccount) {
      return {
        ok: false,
        message: 'Migration source and target are required.',
        error: 'missing-migration-source-target'
      }
    }
    const now = Date.now()
    const domains = normalizeDomains(params.domains?.length ? params.domains : DEFAULT_MIGRATION_DOMAINS)
    const id = randomUUID()
    const template = 'https://crms-api.micromeet.ai/admin/migration/account'
    const target: IntegrationTarget = {
      id,
      name: safeName(params.name || '', `Old MCU migration: ${source} -> ${targetAccount}`),
      source: {
        kind: 'ai-crms-migration',
        domain: 'admin/migration/account',
        migration: {
          source,
          target: targetAccount,
          domains
        }
      },
      destination: {
        kind: 'ai-crms'
      },
      entities: migrationEntities(domains),
      schedule: {
        enabled: false,
        runKind: 'migration-dry-run'
      },
      state: {
        status: 'draft',
        cursor: {}
      },
      endpoints: [
        {
          id: endpointId('POST', template),
          method: 'POST',
          host: 'crms-api.micromeet.ai',
          path: '/admin/migration/account',
          urlTemplate: template,
          role: 'write',
          safety: 'confirm',
          count: 1,
          lastSeenAt: now,
          requestBodyKind: 'json',
          responseMime: 'application/json'
        }
      ],
      createdAt: now,
      updatedAt: now
    }
    await this.saveTarget(target)
    return {
      ok: true,
      target,
      message: `Created AI-CRMS migration target for ${source} -> ${targetAccount}.`
    }
  }

  async deleteTarget(targetId: string): Promise<IntegrationTargetDeleteResult> {
    const id = targetId.trim()
    if (!id) return { ok: false, targetId: '', message: 'Missing target id', error: 'missing-target-id' }
    await configStore.remove({ domain: INTEGRATION_TARGET_CONFIG_DOMAIN, key: targetKey(id) })
    await integrationMappingStore.deleteTargetMappings(id)
    return { ok: true, targetId: id, message: 'Integration target deleted.' }
  }

  async runDryRun(targetId: string): Promise<IntegrationTargetRunResult> {
    const target = await this.getTarget(targetId)
    if (!target) return { ok: false, targetId, message: `Integration target ${targetId} was not found.`, error: 'target-not-found' }
    const startedAt = Date.now()
    const readCount = target.endpoints.filter((endpoint) => endpoint.role === 'read').length
    const writeCount = target.endpoints.filter((endpoint) => endpoint.role === 'write').length
    const missing: string[] = []
    if (!target.endpoints.length) missing.push('captured endpoint contracts')
    if (!target.entities.length) missing.push('entity mapping')
    if (target.source.kind === 'ai-crms-migration') {
      if (!target.source.migration?.source) missing.push('migration source account')
      if (!target.source.migration?.target) missing.push('migration target account')
      if (!writeCount) missing.push('migration account API endpoint')
    } else {
      if (!readCount) missing.push('read/list API endpoint')
      if (!writeCount) missing.push('write/upsert API endpoint')
    }
    const notes = [
      'Dry-run validates the saved integration contract only; it does not call customer APIs or AI-CRMS.',
      'Scheduled runs are disabled by default; when enabled, the scheduler only runs safe read-only or backend dry-run modes.',
      'AI-CRMS apply should use micromeet CLI commands or backend migration endpoints, not stored browser token values.'
    ]
    const status = missing.length ? 'warning' : 'success'
    const run: IntegrationRunSummary = {
      id: randomUUID(),
      mode: 'dry-run',
      status,
      startedAt,
      finishedAt: Date.now(),
      endpointCount: target.endpoints.length,
      readCount,
      writeCount,
      entityCount: target.entities.length,
      notes,
      missing
    }
    const next: IntegrationTarget = {
      ...target,
      state: {
        ...target.state,
        status: status === 'success' ? 'dry-run-ok' : 'draft',
        lastRun: run
      },
      updatedAt: Date.now()
    }
    await this.saveTarget(next)
    return {
      ok: true,
      targetId: target.id,
      run,
      message: missing.length ? `Dry-run finished with ${missing.length} missing contract item${missing.length === 1 ? '' : 's'}.` : 'Dry-run contract validation passed.'
    }
  }

  async runReportReadiness(params: IntegrationReportReadinessRequest): Promise<IntegrationTargetRunResult> {
    const targetId = String(params.targetId || '').trim()
    const target = await this.getTarget(targetId)
    if (!target) return { ok: false, targetId, message: `Integration target ${targetId} was not found.`, error: 'target-not-found' }
    const run = await runAiCrmsReportReadiness(target, { ...params, targetId })
    const next: IntegrationTarget = {
      ...target,
      state: {
        ...target.state,
        status: run.status === 'failed' ? 'error' : run.missing.length ? target.state.status : 'ready',
        lastRun: run
      },
      updatedAt: Date.now()
    }
    await this.saveTarget(next)
    return {
      ok: run.status !== 'failed',
      targetId: target.id,
      run,
      message:
        run.status === 'success'
          ? params.generate
            ? 'AI-CRMS report generation commands completed.'
            : 'AI-CRMS report-readiness check passed.'
          : run.status === 'warning'
            ? `AI-CRMS report-readiness finished with ${run.missing.length} item${run.missing.length === 1 ? '' : 's'} to review.`
            : 'AI-CRMS report-readiness failed.',
      error: run.status === 'failed' ? 'readiness-failed' : undefined
    }
  }

  async runMigration(params: IntegrationMigrationRunRequest): Promise<IntegrationTargetRunResult> {
    const targetId = String(params.targetId || '').trim()
    const target = await this.getTarget(targetId)
    if (!target) return { ok: false, targetId, message: `Integration target ${targetId} was not found.`, error: 'target-not-found' }
    if (target.source.kind !== 'ai-crms-migration') {
      return { ok: false, targetId, message: 'Target is not an AI-CRMS migration target.', error: 'not-migration-target' }
    }
    const run = await runAiCrmsMigration(target, { ...params, targetId })
    const next: IntegrationTarget = {
      ...target,
      state: {
        ...target.state,
        status: run.status === 'failed' ? 'error' : params.apply ? 'ready' : 'dry-run-ok',
        lastRun: run
      },
      updatedAt: Date.now()
    }
    await this.saveTarget(next)
    return {
      ok: run.status !== 'failed',
      targetId: target.id,
      run,
      message:
        run.status === 'success'
          ? params.apply
            ? 'AI-CRMS migration applied.'
            : 'AI-CRMS migration dry-run completed.'
          : run.status === 'warning'
            ? `AI-CRMS migration dry-run finished with ${run.missing.length} missing item${run.missing.length === 1 ? '' : 's'}.`
            : 'AI-CRMS migration failed.',
      error: run.status === 'failed' ? 'migration-failed' : undefined
    }
  }

  async setSchedule(params: IntegrationTargetScheduleRequest): Promise<IntegrationTargetScheduleResult> {
    const targetId = String(params.targetId || '').trim()
    const target = await this.getTarget(targetId)
    if (!target) return { ok: false, targetId, message: `Integration target ${targetId} was not found.`, error: 'target-not-found' }
    const intervalMinutes = normalizeScheduleInterval(params.intervalMinutes ?? target.schedule.intervalMinutes)
    const runKind = normalizeScheduleRunKind(params.runKind || target.schedule.runKind, target.source.kind)
    const next: IntegrationTarget = {
      ...target,
      schedule: {
        ...target.schedule,
        enabled: Boolean(params.enabled),
        intervalMinutes,
        runKind,
        nextRunAt: params.enabled ? Date.now() + intervalMinutes * 60_000 : undefined
      },
      updatedAt: Date.now()
    }
    await this.saveTarget(next)
    return {
      ok: true,
      targetId: next.id,
      target: next,
      message: next.schedule.enabled
        ? `Integration schedule enabled every ${intervalMinutes} minute${intervalMinutes === 1 ? '' : 's'}.`
        : 'Integration schedule disabled.'
    }
  }

  async markScheduledRunCompleted(targetId: string, startedAt: number): Promise<IntegrationTarget | null> {
    const target = await this.getTarget(targetId)
    if (!target || !target.schedule.enabled) return target
    const intervalMinutes = normalizeScheduleInterval(target.schedule.intervalMinutes)
    const next: IntegrationTarget = {
      ...target,
      schedule: {
        ...target.schedule,
        intervalMinutes,
        lastScheduledRunAt: startedAt,
        nextRunAt: Date.now() + intervalMinutes * 60_000
      },
      updatedAt: Date.now()
    }
    await this.saveTarget(next)
    return next
  }

  async recordRun(targetId: string, run: IntegrationRunSummary): Promise<IntegrationTarget | null> {
    const target = await this.getTarget(targetId)
    if (!target) return null
    const next: IntegrationTarget = {
      ...target,
      state: {
        ...target.state,
        status: run.status === 'failed' ? 'error' : run.status === 'success' ? 'dry-run-ok' : target.state.status,
        lastRun: run
      },
      updatedAt: Date.now()
    }
    await this.saveTarget(next)
    return next
  }

  private async saveTarget(target: IntegrationTarget): Promise<void> {
    await configStore.upsert({
      domain: INTEGRATION_TARGET_CONFIG_DOMAIN,
      key: targetKey(target.id),
      options: target
    })
  }
}

export const integrationTargetStore = new IntegrationTargetStore()
