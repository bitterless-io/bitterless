import { readFileSync } from 'fs'
import { basename } from 'path'
import { File } from 'buffer'
import { fetch, FormData } from 'undici'
import { isDownloadableMediaUrl } from '@maestro-main/agent/runtime/mediaRefResolver'
import type { AgentRuntimeMediaRef } from '@maestro-main/agent/runtime/agentRuntime.types'
import { resolveAiCrmsRelayEndpoint } from '@maestro-main/networking/clients/relay.client'
import { normalizeCoachRegion } from '@maestro-shared/networking/coachRegion'
import type { AuthSession } from '@maestro-shared/session.api'

export interface MediaUploadParams {
  providerId: string
  refs: AgentRuntimeMediaRef[]
  session?: AuthSession | null
}

export interface MediaUploadResult {
  refs: AgentRuntimeMediaRef[]
  warnings: string[]
  uploaded: number
}

export const uploadMediaRefsForProvider = async (params: MediaUploadParams): Promise<MediaUploadResult> => {
  const normalized = normalizeUploadMediaRefs(params.refs)
  const uploadUrl = resolveMediaUploadUrl(params.providerId, params.session)
  if (!uploadUrl) {
    return {
      refs: normalized.refs,
      uploaded: 0,
      warnings: [...normalized.warnings, 'No media upload endpoint is configured for this remote provider.']
    }
  }

  const refs: AgentRuntimeMediaRef[] = []
  const warnings: string[] = [...normalized.warnings]
  let uploaded = 0
  for (const ref of normalized.refs) {
    if (ref.url || !ref.path) {
      if (ref.url || ref.path) refs.push(ref)
      continue
    }
    try {
      const url = await uploadOneMediaRef(uploadUrl, ref, params.session)
      refs.push({ ...ref, url })
      uploaded += 1
    } catch (err) {
      refs.push(ref)
      warnings.push(`${ref.name || basename(ref.path)} upload failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return { refs, warnings, uploaded }
}

const normalizeUploadMediaRefs = (refs: AgentRuntimeMediaRef[]): { refs: AgentRuntimeMediaRef[]; warnings: string[] } => {
  const nextRefs: AgentRuntimeMediaRef[] = []
  const warnings: string[] = []
  for (const ref of refs) {
    const next = normalizeUploadMediaRef(ref)
    if (ref.url && !next.url) {
      warnings.push(`${ref.name || ref.path || 'attachment'} has an inline/unsupported media URL; stripped before provider upload.`)
    }
    if (next.url || next.path) nextRefs.push(next)
  }
  return { refs: nextRefs, warnings }
}

const normalizeUploadMediaRef = (ref: AgentRuntimeMediaRef): AgentRuntimeMediaRef => {
  if (!ref.url) return ref
  if (isDownloadableMediaUrl(ref.url)) return { ...ref, url: ref.url.trim() }
  return { ...ref, url: undefined }
}

const resolveMediaUploadUrl = (providerId: string, session?: AuthSession | null): string => {
  const provider = providerId.trim().toLowerCase()
  const raw =
    (provider === 'ai-crms' ? process.env.COACH_AI_CRMS_MEDIA_UPLOAD_URL : '') ||
    process.env.COACH_MEDIA_UPLOAD_URL ||
    ''
  const value = raw.trim()
  if (!value) return ''
  if (/^https?:\/\//i.test(value)) return value.replace(/\/+$/, '')
  if (provider === 'ai-crms') {
    const endpoint = resolveAiCrmsRelayEndpoint(session)
    return new URL(value.replace(/^\/+/, ''), endpoint.baseUrl.replace(/\/+$/, '') + '/').toString()
  }
  return ''
}

const uploadOneMediaRef = async (url: string, ref: AgentRuntimeMediaRef, session?: AuthSession | null): Promise<string> => {
  if (!ref.path) throw new Error('missing local path')
  const form = new FormData()
  const name = ref.name || basename(ref.path)
  const file = new File([readFileSync(ref.path)], name, { type: ref.mimeType || 'application/octet-stream' })
  form.set('file', file)
  form.set('name', name)
  form.set('kind', ref.kind)
  if (ref.mimeType) form.set('mimeType', ref.mimeType)

  const headers: Record<string, string> = {}
  if (session?.jwt_token) headers.Authorization = `Bearer ${session.jwt_token}`
  if (session) {
    headers['x-region'] = normalizeCoachRegion(session.region)
    if (session.tenant_id) headers['x-workspace-id'] = session.tenant_id
  }

  const res = await fetch(url, { method: 'POST', headers, body: form })
  const text = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status}${text ? ` ${text.slice(0, 180)}` : ''}`)
  const uploadedUrl = extractUploadedUrl(text)
  if (!uploadedUrl) throw new Error('upload response did not include url/downloadUrl')
  return uploadedUrl
}

const extractUploadedUrl = (text: string): string => {
  const body = text.trim()
  if (/^https?:\/\//i.test(body)) return body
  try {
    const parsed = JSON.parse(body) as unknown
    return pickUrl(parsed)
  } catch {
    return ''
  }
}

const pickUrl = (value: unknown): string => {
  if (!value || typeof value !== 'object') return ''
  const record = value as Record<string, unknown>
  for (const key of [
    'url',
    'downloadUrl',
    'download_url',
    'signedUrl',
    'signed_url',
    'fileUrl',
    'file_url',
    'previewUrl',
    'preview_url',
    'publicUrl',
    'public_url'
  ]) {
    const candidate = record[key]
    if (typeof candidate === 'string' && /^https?:\/\//i.test(candidate)) return candidate
  }
  for (const key of ['data', 'file', 'result']) {
    const candidate = pickUrl(record[key])
    if (candidate) return candidate
  }
  return ''
}
