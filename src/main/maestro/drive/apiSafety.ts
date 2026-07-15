import type { ApiCall } from './replayEngine'
import type { SkillRecipe } from '@maestro-main/skills/skillRecipe.types'

export type ApiSafety = 'safe' | 'confirm' | 'unsafe'

export interface SkillApiSafetyDecision {
  method: string
  path: string
  role: 'option-read' | 'context-read' | 'write' | 'other' | 'unknown'
  safety: ApiSafety
  matched: boolean
  reason: string
}

export const normalizeHttpMethod = (method?: string): string => String(method || 'GET').trim().toUpperCase() || 'GET'

export const isMutatingHttpMethod = (method?: string): boolean => /^(POST|PUT|PATCH|DELETE)$/i.test(normalizeHttpMethod(method))

export const classifySkillApiCall = (recipe: SkillRecipe, call: ApiCall): SkillApiSafetyDecision => {
  const method = normalizeHttpMethod(call.method)
  const target = normalizeEndpoint(call.url)
  const match = recipe.network.find((item) => {
    if (!item.method || normalizeHttpMethod(item.method) !== method) return false
    const recorded = normalizeEndpoint(item.url)
    if (recorded.host && target.host && recorded.host !== target.host) return false
    return recorded.path === target.path
  })

  if (match) {
    const role = match.apiRole || (isMutatingHttpMethod(method) ? 'write' : method === 'GET' ? 'context-read' : 'other')
    const safety =
      match.replaySafety || (role === 'write' || isMutatingHttpMethod(method) ? 'confirm' : role === 'other' ? 'unsafe' : 'safe')
    return {
      method,
      path: target.path,
      role,
      safety,
      matched: true,
      reason:
        safety === 'unsafe'
          ? 'matched recorded endpoint marked unsafe'
          : safety === 'confirm'
            ? 'matched recorded endpoint requires confirmation'
            : 'matched recorded safe endpoint'
    }
  }

  if (isMutatingHttpMethod(method)) {
    return {
      method,
      path: target.path,
      role: 'unknown',
      safety: 'confirm',
      matched: false,
      reason: 'unrecorded mutating endpoint requires confirmation'
    }
  }

  return {
    method,
    path: target.path,
    role: 'unknown',
    safety: 'safe',
    matched: false,
    reason: 'unrecorded read-like endpoint'
  }
}

const normalizeEndpoint = (rawUrl: string): { host?: string; path: string } => {
  const parsed = parseEndpoint(rawUrl)
  return {
    host: parsed.host,
    path: parsed.path
      .split('/')
      .map((segment) => (isDynamicPathSegment(segment) ? ':id' : segment))
      .join('/')
  }
}

const parseEndpoint = (rawUrl: string): { host?: string; path: string } => {
  const url = String(rawUrl || '').trim()
  if (!url) return { path: '/' }
  try {
    const parsed = new URL(url)
    return { host: parsed.hostname.toLowerCase().replace(/^www\./, ''), path: parsed.pathname || '/' }
  } catch {
    try {
      const parsed = new URL(url.startsWith('/') ? url : `/${url}`, 'https://coach.local')
      return { path: parsed.pathname || '/' }
    } catch {
      return { path: url.split('?')[0] || '/' }
    }
  }
}

const isDynamicPathSegment = (segment: string): boolean => {
  const decoded = decodeURIComponent(segment || '').trim()
  return (
    /^[0-9]{5,}$/.test(decoded) ||
    /^[a-f0-9]{8,}-[a-f0-9-]{12,}$/i.test(decoded) ||
    /^[A-Za-z0-9_-]{16,}$/.test(decoded)
  )
}
