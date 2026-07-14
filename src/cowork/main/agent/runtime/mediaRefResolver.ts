import { basename } from 'path'
import type { AgentRuntimeImage, AgentRuntimeMediaRef } from './agentRuntime.types'

export type AgentRuntimeMediaTransport = 'path' | 'url'

interface ResolvedMediaRef {
  ref?: AgentRuntimeMediaRef
  label?: string
  warning?: string
}

export interface ResolveRuntimeMediaRefsParams {
  providerId: string
  modelId: string
  media: AgentRuntimeMediaRef[]
  maxImages: number
}

export interface RuntimeMediaResolution {
  transport: AgentRuntimeMediaTransport
  media: AgentRuntimeMediaRef[]
  images: AgentRuntimeImage[]
  labels: string[]
  warnings: string[]
}

export const mediaTransportForProvider = (providerId: string): AgentRuntimeMediaTransport => {
  const id = providerId.trim().toLowerCase()
  if (id === 'openai-codex' || id === 'anthropic') return 'path'
  return 'url'
}

export const isDownloadableMediaUrl = (value: string): boolean => /^https?:\/\//i.test(value.trim())

export const resolveRuntimeMediaRefs = (params: ResolveRuntimeMediaRefsParams): RuntimeMediaResolution => {
  const transport = mediaTransportForProvider(params.providerId)
  const media: AgentRuntimeMediaRef[] = []
  const images: AgentRuntimeImage[] = []
  const labels: string[] = []
  const warnings: string[] = []
  for (const ref of params.media) {
    if (!ref.path && !ref.url) continue
    const next = resolveOneRef(ref, transport)
    if (next.warning) warnings.push(next.warning)
    if (!next.ref) continue
    media.push(next.ref)
    if (next.label) labels.push(next.label)
    if (next.ref.kind === 'image' && next.ref.mimeType && images.length < params.maxImages) {
      images.push({ ...next.ref, kind: 'image', mimeType: next.ref.mimeType })
    }
  }
  return { transport, media, images, labels, warnings }
}

const resolveOneRef = (
  ref: AgentRuntimeMediaRef,
  transport: AgentRuntimeMediaTransport
): ResolvedMediaRef => {
  const safeUrl = ref.url && isDownloadableMediaUrl(ref.url) ? ref.url.trim() : ''
  const hasUnsupportedUrl = Boolean(ref.url && !safeUrl)
  const resolvedRef = hasUnsupportedUrl ? { ...ref, url: undefined } : ref
  const displayName = mediaDisplayName(resolvedRef, hasUnsupportedUrl)
  const size = typeof ref.size === 'number' ? `, ${(ref.size / 1024 / 1024).toFixed(2)} MB` : ''
  const mime = ref.mimeType || 'application/octet-stream'
  const unsupportedWarning = hasUnsupportedUrl
    ? `${displayName} has an inline/unsupported media URL; use a local path or downloadable http(s) URL instead.`
    : ''
  if (hasUnsupportedUrl && !ref.path) {
    return { warning: unsupportedWarning }
  }
  if (transport === 'url') {
    if (safeUrl) {
      return {
        ref: { ...resolvedRef, url: safeUrl },
        label: `${safeUrl} (${ref.kind}, ${mime}${size}, transport=url, name=${displayName})`,
        warning: unsupportedWarning || undefined
      }
    }
    return {
      ref: resolvedRef,
      label: `@${ref.path} (${ref.kind}, ${mime}${size}, transport=path, remote_url=missing, name=${displayName})`,
      warning: [
        unsupportedWarning,
        `${displayName} needs a downloadable URL for native remote media; no upload/signed-URL resolver is configured yet.`
      ].filter(Boolean).join(' ')
    }
  }
  if (!ref.path && safeUrl) {
    return {
      ref: { ...resolvedRef, url: safeUrl },
      label: `${safeUrl} (${ref.kind}, ${mime}${size}, transport=url, local_path=missing, name=${displayName})`
    }
  }
  return {
    ref: resolvedRef,
    label: `@${ref.path || ref.url} (${ref.kind}, ${mime}${size}, transport=path, name=${displayName})`,
    warning: unsupportedWarning || undefined
  }
}

const mediaDisplayName = (ref: AgentRuntimeMediaRef, inlineUrl: boolean): string => {
  if (ref.name) return ref.name
  if (ref.path) return basename(ref.path)
  if (ref.url && !inlineUrl) {
    try {
      const parsed = new URL(ref.url)
      return basename(parsed.pathname) || parsed.hostname || 'attachment'
    } catch {
      return 'attachment'
    }
  }
  return 'inline-media'
}
