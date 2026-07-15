import { readFileSync } from 'fs'
import { basename } from 'path'
import { fetch } from 'undici'
import { normalizeCoachRegion, type CoachRegionCode } from '@maestro-shared/networking/coachRegion'
import type { AuthSession } from '@maestro-shared/session.api'

const DEFAULT_AI_CRMS_CORE_BASE_URLS: Record<CoachRegionCode, string> = {
  SG: 'https://crms-api.micromeet.ai',
  HK: 'https://crms-api-hk.micromeet.ai',
  ID: 'https://crms-api-id.micromeet.ai'
}

export interface AiCrmsCoreUploadParams {
  session: AuthSession
  path: string
  name?: string
  mimeType?: string
  size?: number
  purpose?: string
}

export interface AiCrmsCoreUploadResult {
  fileId: string
  fileUrl: string
  coreBaseUrl: string
  uploadUrl: string
  bytes: number
  name: string
  mimeType: string
}

interface UploadTicket {
  file_id: string
  upload_url: string
}

interface FileUrlResult {
  file_id?: string
  name?: string
  url?: string
}

const normalizeBaseUrl = (value: string): string => {
  const trimmed = value.trim().replace(/\/+$/, '')
  if (!trimmed) return ''
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  return `https://${trimmed.replace(/^\/+/, '')}`
}

export const resolveAiCrmsCoreBaseUrl = (session?: Pick<AuthSession, 'region'> | null): string => {
  const region = normalizeCoachRegion(session?.region)
  const envRegionKey = `COACH_AI_CRMS_CORE_BASE_URL_${region}`
  const coreDomainRegionKey = `CORE_DOMAIN_${region}`
  const raw =
    process.env[envRegionKey] ||
    process.env.COACH_AI_CRMS_CORE_BASE_URL ||
    process.env[coreDomainRegionKey] ||
    DEFAULT_AI_CRMS_CORE_BASE_URLS[region]
  return normalizeBaseUrl(raw)
}

export const uploadFileThroughAiCrmsCore = async (params: AiCrmsCoreUploadParams): Promise<AiCrmsCoreUploadResult> => {
  const coreBaseUrl = resolveAiCrmsCoreBaseUrl(params.session)
  if (!coreBaseUrl) throw new Error('AI-CRMS core base URL is not configured.')
  const name = params.name || basename(params.path)
  const mimeType = params.mimeType || 'application/octet-stream'
  const bytes = params.size ?? readFileSync(params.path).length
  const ticket = await corePost<UploadTicket>(coreBaseUrl, '/share/file/get-upload-url', params.session, {
    name,
    size: bytes,
    mime: mimeType,
    purpose: params.purpose || 'coach_voice_scribe'
  })
  if (!ticket.file_id || !ticket.upload_url) throw new Error('AI-CRMS core upload ticket did not include file_id/upload_url.')

  const uploadRes = await fetch(ticket.upload_url, {
    method: 'PUT',
    headers: { 'Content-Type': mimeType },
    body: readFileSync(params.path)
  })
  const uploadText = await uploadRes.text()
  if (!uploadRes.ok) throw new Error(`OSS upload failed: HTTP ${uploadRes.status}${uploadText ? ` ${uploadText.slice(0, 180)}` : ''}`)

  await corePost<{ file_id: string; upload_status: string }>(coreBaseUrl, '/share/file/complete-upload', params.session, {
    file_id: ticket.file_id
  })
  const fileUrl = await corePost<FileUrlResult>(coreBaseUrl, '/share/file/file-url', params.session, {
    file_id: ticket.file_id
  })
  if (!fileUrl.url) throw new Error('AI-CRMS core file-url did not include url.')

  return {
    fileId: ticket.file_id,
    fileUrl: fileUrl.url,
    coreBaseUrl,
    uploadUrl: ticket.upload_url,
    bytes,
    name,
    mimeType
  }
}

const corePost = async <T>(baseUrl: string, path: string, session: AuthSession, body: Record<string, unknown>): Promise<T> => {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    Authorization: `Bearer ${session.jwt_token}`,
    'Content-Type': 'application/json',
    'x-region': normalizeCoachRegion(session.region),
    lang: 'en'
  }
  if (session.tenant_id) headers['x-workspace-id'] = session.tenant_id
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  })
  const text = await res.text()
  const parsed = parseJson(text)
  if (!res.ok) throw new Error(`AI-CRMS core ${path} failed: HTTP ${res.status}${text ? ` ${text.slice(0, 180)}` : ''}`)
  return unwrapCorePayload<T>(parsed, path)
}

const parseJson = (text: string): unknown => {
  if (!text.trim()) return {}
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

const unwrapCorePayload = <T>(payload: unknown, path: string): T => {
  if (!payload || typeof payload !== 'object') return payload as T
  const record = payload as Record<string, unknown>
  if (record.success === false || typeof record.code === 'string') {
    const message = String(record.msg || record.message || `AI-CRMS core ${path} failed.`)
    throw new Error(message)
  }
  if ('data' in record || 'code' in record) {
    const code = record.code
    if (code !== undefined && code !== 0) {
      const message = String(record.message || `AI-CRMS core ${path} failed.`)
      throw new Error(message)
    }
    return ('data' in record ? record.data : record) as T
  }
  return payload as T
}
