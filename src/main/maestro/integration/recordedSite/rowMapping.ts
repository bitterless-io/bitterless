import { createHash } from 'crypto'
import type { IntegrationEndpointContract, IntegrationEntity, IntegrationMappingEntry } from '@maestro-shared/coach.api'
import { putUnknownIfPresent, stableJson, stringFrom } from './rowValue'

/**
 * Pure recorded-site mapping logic. It deliberately has no Electron or window lifecycle
 * dependency so recorded rows can be planned and translated independently of the controller.
 */

const hostFromUrl = (url: string | undefined): string => {
  if (!url) return ''
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}

const clipInline = (value: unknown, max: number): string => {
  const text = String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
  if (text.length <= max) return text
  return text.slice(0, Math.max(0, max - 3)) + '...'
}

export const normalizeRecordedSiteHost = (value: string | undefined): string => {
  const text = String(value || '').trim()
  if (!text) return ''
  return (
    hostFromUrl(text) ||
    text
      .replace(/^https?:\/\//i, '')
      .replace(/\/.*$/, '')
      .replace(/^www\./, '')
      .toLowerCase()
  )
}

export const recordedSiteHostMatches = (actual: string, expected: string): boolean => {
  if (!actual || !expected) return false
  return actual === expected || actual.endsWith(`.${expected}`) || expected.endsWith(`.${actual}`)
}

export const recordedSiteDryRunUrl = (endpoint: IntegrationEndpointContract): { ok: boolean; url?: string; error?: string } => {
  if (endpoint.role !== 'read') return { ok: false, error: 'endpoint is not marked read' }
  const method = endpoint.method.toUpperCase()
  if (method !== 'GET') return { ok: false, error: `dry-run only supports GET endpoints, got ${method}` }
  let url: URL
  try {
    url = new URL(endpoint.urlTemplate)
  } catch {
    return { ok: false, error: 'endpoint url is not absolute' }
  }
  if (url.pathname.includes(':id') || /<[^>]+>/.test(url.pathname)) {
    return { ok: false, error: 'endpoint path needs a concrete source id' }
  }
  for (const [key, value] of Array.from(url.searchParams.entries())) {
    if (!/^<[^>]+>$/.test(value)) continue
    const lower = key.toLowerCase()
    if (lower === 'page' || lower === 'p') url.searchParams.set(key, '1')
    else if (lower === 'page_size' || lower === 'pagesize' || lower === 'limit' || lower === 'per_page' || lower === 'perpage') {
      url.searchParams.set(key, '20')
    } else {
      url.searchParams.delete(key)
    }
  }
  return { ok: true, url: url.toString() }
}

export const recordedSiteEndpointNeedsRow = (endpoint: IntegrationEndpointContract): boolean => {
  if (endpoint.method.toUpperCase() !== 'GET') return false
  try {
    const url = new URL(endpoint.urlTemplate)
    if (url.pathname.split('/').some((part) => part.startsWith(':') || /<[^>]+>/.test(part))) return true
    return Array.from(url.searchParams.values()).some((value) => recordedSiteQueryPlaceholder(value))
  } catch {
    return /(^|\/):[A-Za-z_][A-Za-z0-9_]*|<[^>]+>/.test(endpoint.urlTemplate)
  }
}

export const recordedSiteDetailEndpointsForEntity = (endpoints: IntegrationEndpointContract[], entity: IntegrationEntity): IntegrationEndpointContract[] => {
  return endpoints.filter((endpoint) => {
    const detected = integrationEntityForEndpoint(endpoint, [entity])
    if (entity === 'mcu_record') return detected === 'mcu_record' || detected === 'mcu_report' || detected === 'patient'
    return detected === entity
  })
}

export const recordedSiteRowDetailUrl = (endpoint: IntegrationEndpointContract, row: unknown): { ok: boolean; url?: string; error?: string } => {
  if (endpoint.role !== 'read') return { ok: false, error: 'endpoint is not marked read' }
  if (endpoint.method.toUpperCase() !== 'GET') {
    return { ok: false, error: `detail fetch only supports GET endpoints, got ${endpoint.method}` }
  }
  let url: URL
  try {
    url = new URL(endpoint.urlTemplate)
  } catch {
    return { ok: false, error: 'endpoint url is not absolute' }
  }
  const replacePlaceholder = (raw: string): string | null => {
    let out = raw
    const tokens = new Set<string>()
    const direct = raw.match(/^:([A-Za-z_][A-Za-z0-9_]*)$/)
    if (direct?.[1]) tokens.add(direct[1])
    for (const match of raw.matchAll(/<([^>]+)>/g)) tokens.add(match[1])
    for (const token of tokens) {
      const value = recordedSitePlaceholderValue(row, token)
      if (!value) return null
      out = out === `:${token}` ? value : out.replaceAll(`<${token}>`, value)
    }
    return out
  }
  const nextParts: string[] = []
  for (const part of url.pathname.split('/')) {
    const next = replacePlaceholder(part)
    if (next === null) return { ok: false, error: `${endpoint.path} missing detail id` }
    nextParts.push(next)
  }
  url.pathname = nextParts.join('/')
  for (const [key, value] of Array.from(url.searchParams.entries())) {
    const token = recordedSiteQueryPlaceholder(value)
    if (!token) continue
    const replacement = recordedSitePlaceholderValue(row, token)
    if (!replacement) return { ok: false, error: `${endpoint.path} missing query ${key}` }
    url.searchParams.set(key, replacement)
  }
  if (url.pathname.includes(':') || /<[^>]+>/.test(url.toString())) {
    return { ok: false, error: `${endpoint.path} unresolved detail placeholder` }
  }
  return { ok: true, url: url.toString() }
}

const recordedSiteQueryPlaceholder = (value: string): string => {
  const text = String(value || '').trim()
  const angle = text.match(/^<([^>]+)>$/)
  if (angle?.[1]) return angle[1]
  const colon = text.match(/^:([A-Za-z_][A-Za-z0-9_]*)$/)
  return colon?.[1] || ''
}

const recordedSitePlaceholderValue = (row: unknown, token: string): string => {
  const raw = row && typeof row === 'object' && !Array.isArray(row) ? (row as Record<string, unknown>) : {}
  const normalized = normalizeRecordedSiteKey(token)
  const keys = Array.from(new Set([token, token.replace(/[A-Z]/g, (ch) => `_${ch.toLowerCase()}`), `${token}_id`, `${token}Id`]))
  const direct = readRecordedSiteValue(raw, keys)
  if (direct) return direct
  if (normalized.includes('patient')) return readRecordedSiteValue(raw, recordedSiteSourceIdKeys('patient'))
  if (normalized.includes('corporate') || normalized.includes('client')) {
    return readRecordedSiteValue(raw, recordedSiteSourceIdKeys('corporate'))
  }
  if (normalized.includes('project') || normalized.includes('batch')) {
    return readRecordedSiteValue(raw, recordedSiteSourceIdKeys('project'))
  }
  if (normalized.includes('mcu') || normalized.includes('record')) {
    return readRecordedSiteValue(raw, ['mcu_record_id', 'mcuRecordId', 'outer_mcu_id', 'outerMcuId', 'record_id', 'recordId', 'mcu_id', 'mcuId', 'id'])
  }
  if (normalized === 'id') return sourceKeyForRecordedSiteRow(row)
  return ''
}

export const mergeRecordedSiteRowDetails = (row: unknown, details: unknown[]): unknown => {
  const base = row && typeof row === 'object' && !Array.isArray(row) ? { ...(row as Record<string, unknown>) } : { value: row }
  for (const [index, detail] of details.entries()) {
    const payload = normalizeRecordedSitePayload(detail)
    if (!payload) continue
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
        if (base[key] === undefined) base[key] = value
      }
    }
    base[`_detail_${index}`] = payload
  }
  return base
}

export const recordedSiteRedactDetailUrl = (value: string): string => {
  try {
    const url = new URL(value)
    const path = url.pathname
      .split('/')
      .map((part) => (/^\d{5,}$/.test(part) || /^[0-9a-f-]{16,}$/i.test(part) || (part.length >= 20 && /\d/.test(part)) ? ':id' : part))
      .join('/')
    for (const key of Array.from(url.searchParams.keys())) url.searchParams.set(key, '<redacted>')
    return `${url.origin}${path}${url.search}`
  } catch {
    return value.replace(/[A-Za-z0-9_-]{20,}/g, ':id')
  }
}

export const integrationEntityForEndpoint = (endpoint: IntegrationEndpointContract, fallback: IntegrationEntity[]): IntegrationEntity => {
  const text = `${endpoint.path} ${endpoint.urlTemplate}`.toLowerCase()
  if (/patient|patients/.test(text)) return 'patient'
  if (/corporate|corporates|client|clients|institution/.test(text)) return 'corporate'
  if (/project|projects|batch|batches/.test(text)) return 'project'
  if (/mapping|data-map|field-map|field_config|field-config/.test(text)) return 'data_mapping'
  if (/report|conclusion/.test(text)) return 'mcu_report'
  if (/mcu|record|records|observation|examination/.test(text)) return 'mcu_record'
  return fallback[0] || 'patient'
}

export const extractRecordedSiteRows = (value: unknown, maxRows: number): unknown[] => {
  const seen = new Set<unknown>()
  const visit = (item: unknown, depth: number): unknown[] => {
    if (!item || depth > 4 || seen.has(item)) return []
    if (Array.isArray(item)) return item.slice(0, maxRows)
    if (typeof item !== 'object') return []
    seen.add(item)
    const raw = item as Record<string, unknown>
    for (const key of ['list', 'data', 'records', 'items', 'rows', 'results', 'patients', 'projects', 'corporates', 'clients']) {
      const child = raw[key]
      if (Array.isArray(child)) return child.slice(0, maxRows)
      const nested = visit(child, depth + 1)
      if (nested.length) return nested.slice(0, maxRows)
    }
    for (const child of Object.values(raw)) {
      const nested = visit(child, depth + 1)
      if (nested.length) return nested.slice(0, maxRows)
    }
    return []
  }
  return visit(value, 0).slice(0, maxRows)
}

export const sourceKeyForRecordedSiteRow = (row: unknown): string => {
  if (row && typeof row === 'object' && !Array.isArray(row)) {
    const raw = row as Record<string, unknown>
    const candidateKeys = [
      'id',
      '_id',
      'uuid',
      'source_id',
      'sourceId',
      'external_id',
      'externalId',
      'patient_id',
      'patientId',
      'project_id',
      'projectId',
      'corporate_id',
      'corporateId',
      'client_id',
      'clientId',
      'record_id',
      'recordId',
      'mcu_record_id',
      'mcuRecordId',
      'outer_mcu_id',
      'outerMcuId',
      'code'
    ]
    for (const key of candidateKeys) {
      const value = raw[key]
      if (typeof value === 'string' && value.trim()) return value.trim()
      if (typeof value === 'number' && Number.isFinite(value)) return String(value)
    }
  }
  return `hash:${stableSourceHash(row)}`
}

export interface RecordedSiteRowPlan {
  action: 'create' | 'update' | 'noop' | 'conflict'
  missingFields: string[]
}

export const recordedSiteRowSyncPlan = (entity: IntegrationEntity, row: unknown, mapping: IntegrationMappingEntry | undefined, sourceHash: string): RecordedSiteRowPlan => {
  const missingFields = recordedSiteRequiredFields(entity, row)
  if (mapping?.status === 'ignored') return { action: 'noop', missingFields }
  if (mapping?.status === 'conflict') return { action: 'conflict', missingFields }
  if (!mapping?.aiCrmsId) return { action: 'create', missingFields }
  if (mapping.sourceHash && sourceHash && mapping.sourceHash !== sourceHash) {
    return { action: 'update', missingFields }
  }
  return { action: 'noop', missingFields }
}

const recordedSiteRequiredFields = (entity: IntegrationEntity, row: unknown): string[] => {
  const raw = row && typeof row === 'object' && !Array.isArray(row) ? (row as Record<string, unknown>) : {}
  const missing: string[] = []
  if (entity === 'patient' && !hasRecordedSiteField(raw, ['full_name', 'fullName', 'name', 'patient_name', 'patientName'])) {
    missing.push('patient full_name/name')
  }
  if (entity === 'corporate' && !hasRecordedSiteField(raw, ['name', 'corporate_name', 'corporateName', 'client_name', 'clientName', 'company_name', 'companyName'])) {
    missing.push('corporate name')
  }
  if (entity === 'project' && !hasRecordedSiteField(raw, ['name', 'project_name', 'projectName', 'batch_name', 'batchName', 'code'])) {
    missing.push('project name/code')
  }
  if (entity === 'data_mapping') {
    if (!hasRecordedSiteField(raw, ['mcu_type', 'mcuType', 'type', 'category'])) missing.push('mcu_type')
    if (!hasRecordedSiteField(raw, ['column_name', 'columnName', 'field_name', 'fieldName', 'source_value', 'sourceValue'])) {
      missing.push('mapping column/source')
    }
  }
  if (
    entity === 'mcu_record' &&
    !hasRecordedSiteField(raw, [
      'patient_id',
      'patientId',
      'patient_name',
      'patientName',
      'record_id',
      'recordId',
      'mcu_record_id',
      'mcuRecordId',
      'outer_mcu_id',
      'outerMcuId',
      'mcu_id',
      'mcuId'
    ])
  ) {
    missing.push('mcu patient/record identity')
  }
  if (entity === 'mcu_report' && !hasRecordedSiteField(raw, ['mcu_record_id', 'mcuRecordId', 'record_id', 'recordId', 'report_id', 'reportId'])) {
    missing.push('report record identity')
  }
  return missing
}

const hasRecordedSiteField = (raw: Record<string, unknown>, keys: string[]): boolean => {
  for (const key of keys) {
    if (readRecordedSiteValue(raw, [key])) return true
  }
  return false
}

export const RECORDED_SITE_APPLY_ENTITIES: IntegrationEntity[] = ['patient', 'corporate', 'project', 'data_mapping', 'mcu_record']

export const normalizeRecordedSiteApplyEntities = (values: unknown): IntegrationEntity[] => {
  const requested = Array.isArray(values) ? values.map((item) => String(item || '').trim()) : typeof values === 'string' ? values.split(',').map((item) => item.trim()) : []
  const filtered = requested.filter((item): item is IntegrationEntity => RECORDED_SITE_APPLY_ENTITIES.includes(item as IntegrationEntity))
  return filtered.length ? Array.from(new Set(filtered)) : RECORDED_SITE_APPLY_ENTITIES
}

export interface RecordedSiteAiCrmsBodyOptions {
  action: 'create' | 'update'
  mapping?: IntegrationMappingEntry
  dependencyMappings?: {
    patient?: Map<string, IntegrationMappingEntry>
    corporate?: Map<string, IntegrationMappingEntry>
    project?: Map<string, IntegrationMappingEntry>
  }
}

export interface RecordedSiteAiCrmsBody {
  body: Record<string, unknown>
  missing: string[]
}

export interface RecordedSiteAiCrmsCommandPlan {
  name: string
  args: string[]
  preview: string
  body: Record<string, unknown>
}

export const recordedSiteAiCrmsBody = (entity: IntegrationEntity, row: unknown, options: RecordedSiteAiCrmsBodyOptions): RecordedSiteAiCrmsBody => {
  const raw = row && typeof row === 'object' && !Array.isArray(row) ? (row as Record<string, unknown>) : {}
  const body: Record<string, unknown> = {}
  const missing: string[] = []
  if (options.action === 'update') {
    const id = options.mapping?.aiCrmsId || readRecordedSiteValue(raw, ['ai_crms_id', 'aiCrmsId'])
    if (id) {
      if (entity === 'mcu_record') body.mcu_record_id = id
      else body.id = id
    } else {
      missing.push('AI-CRMS id')
    }
  }
  if (entity === 'patient') {
    putIfPresent(body, 'full_name', readRecordedSiteValue(raw, ['full_name', 'fullName', 'name', 'patient_name', 'patientName']))
    putIfPresent(body, 'gender', normalizeRecordedSiteGender(readRecordedSiteValue(raw, ['gender', 'sex', 'jenis_kelamin', 'jenisKelamin'])))
    putIfPresent(body, 'birth_date', readRecordedSiteValue(raw, ['birth_date', 'birthDate', 'date_of_birth', 'dateOfBirth', 'dob', 'tanggal_lahir', 'tanggalLahir']))
    putIfPresent(body, 'national_id', readRecordedSiteValue(raw, ['national_id', 'nationalId', 'nik', 'identity_no', 'identityNo', 'ktp']))
    putIfPresent(body, 'phone', readRecordedSiteValue(raw, ['phone', 'phone_number', 'phoneNumber', 'mobile', 'telephone', 'tel']))
    putIfPresent(body, 'ihs_number', readRecordedSiteValue(raw, ['ihs_number', 'ihsNumber', 'ihs', 'social_security_no', 'socialSecurityNo']))
    putIfPresent(body, 'address', readRecordedSiteValue(raw, ['address', 'alamat']))
    putIfPresent(body, 'status', readRecordedSiteValue(raw, ['status']))
    putIfPresent(body, 'note', readRecordedSiteValue(raw, ['note', 'notes', 'remark', 'remarks']))
    if (!body.full_name) missing.push('patient full_name/name')
  } else if (entity === 'corporate') {
    putIfPresent(body, 'name', readRecordedSiteValue(raw, ['name', 'corporate_name', 'corporateName', 'client_name', 'clientName', 'company_name', 'companyName']))
    putIfPresent(body, 'code', readRecordedSiteValue(raw, ['code', 'corporate_code', 'corporateCode', 'client_code', 'clientCode']))
    putIfPresent(body, 'address', readRecordedSiteValue(raw, ['address', 'alamat']))
    putIfPresent(body, 'status', readRecordedSiteValue(raw, ['status']))
    putIfPresent(body, 'note', readRecordedSiteValue(raw, ['note', 'notes', 'remark', 'remarks']))
    putIfPresent(body, 'prompt', readRecordedSiteValue(raw, ['prompt']))
    if (!body.name) missing.push('corporate name')
  } else if (entity === 'project') {
    putIfPresent(body, 'name', readRecordedSiteValue(raw, ['name', 'project_name', 'projectName', 'batch_name', 'batchName']))
    putIfPresent(body, 'code', readRecordedSiteValue(raw, ['code', 'project_code', 'projectCode', 'batch_code', 'batchCode']))
    putIfPresent(body, 'corporate_id', recordedSiteMappedTargetId(raw, ['corporate'], options.dependencyMappings))
    putIfPresent(body, 'status', readRecordedSiteValue(raw, ['status']))
    putIfPresent(body, 'batch_date', readRecordedSiteValue(raw, ['batch_date', 'batchDate']))
    putIfPresent(body, 'period_start', readRecordedSiteValue(raw, ['period_start', 'periodStart', 'start_date', 'startDate']))
    putIfPresent(body, 'period_end', readRecordedSiteValue(raw, ['period_end', 'periodEnd', 'end_date', 'endDate']))
    putIfPresent(body, 'note', readRecordedSiteValue(raw, ['note', 'notes', 'remark', 'remarks']))
    putIfPresent(body, 'prompt', readRecordedSiteValue(raw, ['prompt']))
    if (!body.name && !body.code) missing.push('project name/code')
    if (!body.corporate_id) missing.push('project corporate_id/corporate mapping')
  } else if (entity === 'data_mapping') {
    putIfPresent(body, 'mcu_type', readRecordedSiteValue(raw, ['mcu_type', 'mcuType', 'type', 'category', 'exam_type', 'examType']))
    putIfPresent(body, 'column_name', readRecordedSiteValue(raw, ['column_name', 'columnName', 'field_name', 'fieldName', 'source_value', 'sourceValue', 'name', 'column']))
    putIfPresent(body, 'system_field', readRecordedSiteValue(raw, ['system_field', 'systemField', 'target_field', 'targetField', 'ai_crms_field', 'aiCrmsField']))
    putIfPresent(body, 'status', readRecordedSiteValue(raw, ['status']))
    putIfPresent(body, 'check_unit', readRecordedSiteValue(raw, ['check_unit', 'checkUnit', 'unit']))
    putIfPresent(body, 'check_method', readRecordedSiteValue(raw, ['check_method', 'checkMethod', 'method']))
    putIfPresent(body, 'reference', readRecordedSiteValue(raw, ['reference', 'reference_range', 'referenceRange', 'normal_range', 'normalRange']))
    if (!body.mcu_type) missing.push('mcu_type')
    if (!body.column_name) missing.push('mapping column/source')
  } else if (entity === 'mcu_record') {
    if (options.action === 'create') {
      putIfPresent(body, 'source_institution_id', readRecordedSiteValue(raw, ['source_institution_id', 'sourceInstitutionId', 'institution_id', 'institutionId']))
      putIfPresent(body, 'patient_id', recordedSiteMappedTargetId(raw, ['patient'], options.dependencyMappings))
      putIfPresent(body, 'medical_client_id', readRecordedSiteValue(raw, ['medical_client_id', 'medicalClientId', 'client_id', 'clientId']))
      putIfPresent(body, 'corporate_id', recordedSiteMappedTargetId(raw, ['corporate'], options.dependencyMappings))
      putIfPresent(body, 'project_id', recordedSiteMappedTargetId(raw, ['project'], options.dependencyMappings))
      putIfPresent(body, 'outer_mcu_id', readRecordedSiteValue(raw, ['outer_mcu_id', 'outerMcuId', 'mcu_id', 'mcuId', 'record_id', 'recordId', 'code']))
      putIfPresent(body, 'operator_user_id', readRecordedSiteValue(raw, ['operator_user_id', 'operatorUserId', 'doctor_id', 'doctorId', 'staff_id', 'staffId']))
      putIfPresent(body, 'user_type', readRecordedSiteValue(raw, ['user_type', 'userType', 'type']))
      if (!body.patient_id) missing.push('mcu patient mapping')
    } else {
      const basicInfo = recordedSitePatientInfoPayload(raw)
      const companyInfo = recordedSitePayload(raw, ['company_info', 'companyInfo', 'corporate_info', 'corporateInfo', 'project_info', 'projectInfo'])
      const diagnosticData = recordedSitePayload(raw, [
        'diagnostic_data',
        'diagnosticData',
        'examination_data',
        'examinationData',
        'observation',
        'observations',
        'results',
        'items'
      ])
      const reportType = normalizeRecordedSiteReportType(
        readRecordedSiteValue(raw, ['report_type', 'reportType', 'mcu_type', 'mcuType', 'exam_type', 'examType', 'category', 'type']) || inferRecordedSiteReportType(diagnosticData)
      )
      const conclusion = recordedSiteConclusionPayload(raw)
      putUnknownIfPresent(body, 'basic_info', basicInfo)
      putUnknownIfPresent(body, 'company_info', companyInfo)
      putUnknownIfPresent(body, 'diagnostic_data', diagnosticData)
      putIfPresent(body, 'report_type', reportType)
      if (conclusion.conclusion_findings) body.conclusion_findings = conclusion.conclusion_findings
      if (conclusion.recommendations) body.recommendations = conclusion.recommendations
      if (conclusion.fitness) body.fitness = conclusion.fitness
      putIfPresent(body, 'conclusion_report_type', normalizeRecordedSiteReportType(conclusion.report_type) || 'individual_conclusion')
      if (body.diagnostic_data && !body.report_type) missing.push('mcu diagnostic report_type')
      if (!body.basic_info && !body.company_info && !body.diagnostic_data && !body.conclusion_findings && !body.recommendations && !body.fitness) {
        missing.push('mcu update payload')
      }
    }
  }
  return { body, missing }
}

export const recordedSiteAiCrmsCommands = (entity: IntegrationEntity, action: 'create' | 'update', body: Record<string, unknown>): RecordedSiteAiCrmsCommandPlan[] => {
  const bodyJson = JSON.stringify(body)
  if (entity === 'patient') {
    return [
      {
        name: `patient ${action}`,
        args: ['patients', action, '--body', bodyJson, '--json'],
        preview: `micromeet patients ${action} --body [redacted] --json`,
        body
      }
    ]
  }
  if (entity === 'corporate') {
    return [
      {
        name: `corporate ${action}`,
        args: ['corporates', action, '--body', bodyJson, '--json'],
        preview: `micromeet corporates ${action} --body [redacted] --json`,
        body
      }
    ]
  }
  if (entity === 'project') {
    return [
      {
        name: `project ${action}`,
        args: ['corporates', 'projects', action, '--body', bodyJson, '--json'],
        preview: `micromeet corporates projects ${action} --body [redacted] --json`,
        body
      }
    ]
  }
  if (entity === 'data_mapping') {
    return [
      {
        name: `data-map ${action === 'update' ? 'upsert' : 'create'}`,
        args: ['mapping', 'data-map', 'upsert', '--body', bodyJson, '--json'],
        preview: `micromeet mapping data-map upsert --body [redacted] --json`,
        body
      }
    ]
  }
  if (entity === 'mcu_record' && action === 'create') {
    return [
      {
        name: 'mcu record create',
        args: ['mcu', 'record', 'create', '--body', bodyJson, '--json'],
        preview: 'micromeet mcu record create --body [redacted] --json',
        body
      }
    ]
  }
  if (entity === 'mcu_record' && action === 'update') return recordedSiteMcuRecordUpdateCommands(body)
  return []
}

const recordedSiteMcuRecordUpdateCommands = (body: Record<string, unknown>): RecordedSiteAiCrmsCommandPlan[] => {
  const mcuRecordId = stringFrom(body.mcu_record_id)
  if (!mcuRecordId) return []
  const commands: RecordedSiteAiCrmsCommandPlan[] = []
  if (body.basic_info || body.company_info) {
    const commandBody: Record<string, unknown> = { mcu_record_id: mcuRecordId }
    putUnknownIfPresent(commandBody, 'basic_info', body.basic_info)
    putUnknownIfPresent(commandBody, 'company_info', body.company_info)
    commands.push({
      name: 'mcu record patient-info update',
      args: ['mcu', 'record', 'patient-info', 'update', '--body', JSON.stringify(commandBody), '--json'],
      preview: 'micromeet mcu record patient-info update --body [redacted] --json',
      body: commandBody
    })
  }
  if (body.diagnostic_data) {
    const reportType = stringFrom(body.report_type)
    if (reportType) {
      const commandBody = {
        mcu_record_id: mcuRecordId,
        report_type: reportType,
        diagnostic_data: body.diagnostic_data
      }
      commands.push({
        name: 'mcu record diagnostic-data update',
        args: ['mcu', 'record', 'diagnostic-data', 'update', '--body', JSON.stringify(commandBody), '--json'],
        preview: 'micromeet mcu record diagnostic-data update --body [redacted] --json',
        body: commandBody
      })
    }
  }
  if (body.conclusion_findings || body.recommendations || body.fitness) {
    const commandBody: Record<string, unknown> = {
      mcu_record_id: mcuRecordId,
      report_type: stringFrom(body.conclusion_report_type) || 'individual_conclusion'
    }
    putIfPresent(commandBody, 'conclusion_findings', body.conclusion_findings)
    putIfPresent(commandBody, 'recommendations', body.recommendations)
    putIfPresent(commandBody, 'fitness', body.fitness)
    commands.push({
      name: 'mcu record conclusion update',
      args: ['mcu', 'record', 'conclusion', 'update', '--body', JSON.stringify(commandBody), '--json'],
      preview: 'micromeet mcu record conclusion update --body [redacted] --json',
      body: commandBody
    })
  }
  return commands
}

const recordedSiteMappedTargetId = (
  raw: Record<string, unknown>,
  entityHints: Array<'patient' | 'corporate' | 'project'>,
  mappings?: RecordedSiteAiCrmsBodyOptions['dependencyMappings']
): string => {
  for (const entity of entityHints) {
    const direct = readRecordedSiteValue(raw, recordedSiteDirectTargetIdKeys(entity))
    if (direct) return direct
    const source = readRecordedSiteValue(raw, recordedSiteSourceIdKeys(entity))
    const mapped = source ? mappings?.[entity]?.get(source)?.aiCrmsId : ''
    if (mapped) return mapped
  }
  return ''
}

const recordedSiteDirectTargetIdKeys = (entity: 'patient' | 'corporate' | 'project'): string[] => {
  if (entity === 'patient') {
    return ['ai_crms_patient_id', 'aiCrmsPatientId', 'target_patient_id', 'targetPatientId']
  }
  if (entity === 'corporate') {
    return ['ai_crms_corporate_id', 'aiCrmsCorporateId', 'target_corporate_id', 'targetCorporateId']
  }
  return ['ai_crms_project_id', 'aiCrmsProjectId', 'target_project_id', 'targetProjectId']
}

const recordedSiteSourceIdKeys = (entity: 'patient' | 'corporate' | 'project'): string[] => {
  if (entity === 'patient') {
    return ['patient_id', 'patientId', 'source_patient_id', 'sourcePatientId', 'national_id', 'nationalId', 'nik']
  }
  if (entity === 'corporate') {
    return ['corporate_id', 'corporateId', 'client_id', 'clientId', 'corporate_code', 'corporateCode', 'client_code', 'clientCode']
  }
  return ['project_id', 'projectId', 'batch_id', 'batchId', 'project_code', 'projectCode', 'batch_code', 'batchCode']
}

export const recordedSiteSourceLabel = (entity: IntegrationEntity, row: unknown): string | undefined => {
  const raw = row && typeof row === 'object' && !Array.isArray(row) ? (row as Record<string, unknown>) : {}
  const label =
    entity === 'patient'
      ? readRecordedSiteValue(raw, ['full_name', 'fullName', 'name', 'patient_name', 'patientName', 'phone'])
      : entity === 'corporate'
        ? readRecordedSiteValue(raw, ['name', 'corporate_name', 'corporateName', 'client_name', 'clientName', 'code'])
        : entity === 'project'
          ? readRecordedSiteValue(raw, ['name', 'project_name', 'projectName', 'batch_name', 'batchName', 'code'])
          : entity === 'data_mapping'
            ? readRecordedSiteValue(raw, ['column_name', 'columnName', 'field_name', 'fieldName', 'source_value', 'sourceValue'])
            : entity === 'mcu_record'
              ? readRecordedSiteValue(raw, ['outer_mcu_id', 'outerMcuId', 'mcu_id', 'mcuId', 'record_id', 'recordId', 'patient_name', 'patientName'])
              : ''
  return label ? clipInline(label, 80) : undefined
}

export const aiCrmsIdFromResponse = (value: unknown): string => {
  const seen = new Set<unknown>()
  const visit = (item: unknown, depth: number): string => {
    if (!item || depth > 4 || seen.has(item)) return ''
    if (typeof item !== 'object' || Array.isArray(item)) return ''
    seen.add(item)
    const raw = item as Record<string, unknown>
    for (const key of [
      'id',
      'patient_id',
      'patientId',
      'corporate_id',
      'corporateId',
      'project_id',
      'projectId',
      'data_map_id',
      'dataMapId',
      'map_id',
      'mapId',
      'mcu_record_id',
      'mcuRecordId',
      'record_id',
      'recordId'
    ]) {
      const text = stringFrom(raw[key])
      if (text) return text
    }
    for (const key of ['data', 'patient', 'corporate', 'project', 'row', 'record']) {
      const nested = visit(raw[key], depth + 1)
      if (nested) return nested
    }
    for (const child of Object.values(raw)) {
      const nested = visit(child, depth + 1)
      if (nested) return nested
    }
    return ''
  }
  return visit(value, 0)
}

const recordedSitePayload = (raw: Record<string, unknown>, keys: string[]): unknown => {
  const wanted = new Set(keys.map(normalizeRecordedSiteKey))
  const seen = new Set<unknown>()
  const visit = (item: unknown, depth: number): unknown => {
    if (!item || depth > 3 || seen.has(item)) return undefined
    if (typeof item !== 'object' || Array.isArray(item)) return undefined
    seen.add(item)
    const record = item as Record<string, unknown>
    for (const [key, value] of Object.entries(record)) {
      if (!wanted.has(normalizeRecordedSiteKey(key))) continue
      return normalizeRecordedSitePayload(value)
    }
    for (const value of Object.values(record)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const nested = visit(value, depth + 1)
        if (nested !== undefined) return nested
      }
    }
    return undefined
  }
  return visit(raw, 0)
}

const normalizeRecordedSitePayload = (value: unknown): unknown => {
  if (typeof value === 'string') {
    const text = value.trim()
    if (!text) return undefined
    if (/^[\[{]/.test(text)) {
      try {
        return JSON.parse(text)
      } catch {
        return text
      }
    }
    return text
  }
  if (Array.isArray(value)) return value.length ? value : undefined
  if (value && typeof value === 'object') {
    const raw = value as Record<string, unknown>
    return Object.keys(raw).length ? raw : undefined
  }
  return value
}

const recordedSitePatientInfoPayload = (raw: Record<string, unknown>): unknown => {
  const nested = recordedSitePayload(raw, ['basic_info', 'basicInfo', 'patient_info', 'patientInfo', 'personal_information', 'personalInformation'])
  if (nested) return nested
  const body: Record<string, unknown> = {}
  putIfPresent(body, 'full_name', readRecordedSiteValue(raw, ['full_name', 'fullName', 'name', 'patient_name', 'patientName']))
  putIfPresent(body, 'national_id', readRecordedSiteValue(raw, ['national_id', 'nationalId', 'nik', 'identity_no', 'identityNo', 'ktp']))
  putIfPresent(body, 'gender', normalizeRecordedSiteGender(readRecordedSiteValue(raw, ['gender', 'sex', 'jenis_kelamin', 'jenisKelamin'])))
  putIfPresent(body, 'date_of_birth', readRecordedSiteValue(raw, ['date_of_birth', 'dateOfBirth', 'birth_date', 'birthDate', 'dob', 'tanggal_lahir', 'tanggalLahir']))
  putIfPresent(body, 'checkup_age', readRecordedSiteValue(raw, ['checkup_age', 'checkupAge', 'age', 'umur']))
  putIfPresent(body, 'email', readRecordedSiteValue(raw, ['email', 'recipient_email', 'recipientEmail']))
  return Object.keys(body).length ? body : undefined
}

const recordedSiteConclusionPayload = (raw: Record<string, unknown>): Record<string, string> => {
  const nested = recordedSitePayload(raw, ['conclusion', 'individual_conclusion', 'individualConclusion', 'overall_mcu_results', 'overallMcuResults'])
  const source = nested && typeof nested === 'object' && !Array.isArray(nested) ? (nested as Record<string, unknown>) : raw
  return {
    report_type: readRecordedSiteValue(source, ['report_type', 'reportType']) || 'individual_conclusion',
    conclusion_findings: readRecordedSiteValue(source, ['conclusion_findings', 'conclusionFindings', 'findings', 'summary']),
    recommendations: readRecordedSiteValue(source, ['recommendations', 'recommendation', 'saran']),
    fitness: readRecordedSiteValue(source, ['fitness', 'fitness_for_work', 'fitnessForWork', 'fit_status', 'fitStatus'])
  }
}

const normalizeRecordedSiteReportType = (value: string): string => {
  const text = value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
  if (!text) return ''
  if (['lab', 'laboratory', 'laboratory_examination', 'laboratorium'].includes(text)) {
    return 'laboratory_examination'
  }
  if (['xray', 'x_ray', 'roentgen', 'rontgen', 'radiology'].includes(text)) return 'radiology'
  if (['ecg', 'ekg', 'cardio', 'cardiology'].includes(text)) return 'cardiology'
  if (['audio', 'audiometry', 'audiometri'].includes(text)) return 'audiometry'
  if (['spiro', 'spirometry', 'spirometri'].includes(text)) return 'spirometry'
  if (['physical', 'physical_exam', 'physical_examination', 'pemeriksaan_fisik'].includes(text)) {
    return 'physical_examination'
  }
  if (['conclusion', 'individual', 'individual_conclusion'].includes(text)) return 'individual_conclusion'
  return text
}

const inferRecordedSiteReportType = (value: unknown): string => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ''
  for (const key of Object.keys(value as Record<string, unknown>)) {
    const reportType = normalizeRecordedSiteReportType(key)
    if (
      reportType === 'laboratory_examination' ||
      reportType === 'radiology' ||
      reportType === 'cardiology' ||
      reportType === 'audiometry' ||
      reportType === 'spirometry' ||
      reportType === 'physical_examination'
    ) {
      return reportType
    }
  }
  return ''
}

const normalizeRecordedSiteGender = (value: string): string => {
  const text = value.trim().toLowerCase()
  if (!text) return ''
  if (['m', 'male', 'man', 'laki-laki', 'laki', 'pria'].includes(text)) return 'male'
  if (['f', 'female', 'woman', 'perempuan', 'wanita'].includes(text)) return 'female'
  return value
}

const readRecordedSiteValue = (raw: Record<string, unknown>, keys: string[]): string => {
  const wanted = new Set(keys.map(normalizeRecordedSiteKey))
  const seen = new Set<unknown>()
  const visit = (item: unknown, depth: number): string => {
    if (!item || depth > 3 || seen.has(item)) return ''
    if (typeof item !== 'object' || Array.isArray(item)) return ''
    seen.add(item)
    const record = item as Record<string, unknown>
    for (const [key, value] of Object.entries(record)) {
      if (!wanted.has(normalizeRecordedSiteKey(key))) continue
      const text = stringFrom(value)
      if (text) return text
    }
    for (const value of Object.values(record)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const nested = visit(value, depth + 1)
        if (nested) return nested
      }
    }
    return ''
  }
  return visit(raw, 0)
}

const normalizeRecordedSiteKey = (value: string): string => value.replace(/[^a-z0-9]/gi, '').toLowerCase()

export const stableSourceHash = (value: unknown): string => {
  return createHash('sha1').update(stableJson(value)).digest('hex').slice(0, 20)
}

const putIfPresent = (body: Record<string, unknown>, key: string, value: unknown): void => {
  const text = stringFrom(value)
  if (text) body[key] = text
}
