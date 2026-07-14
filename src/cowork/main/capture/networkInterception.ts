import type { HeaderMap } from '@cowork-shared/trace.types'

export type NetworkInterceptionAction = 'block' | 'mock_response' | 'rewrite_request' | 'rewrite_response'
export type NetworkInterceptionStage = 'request' | 'response'

export interface NetworkInterceptionRule {
  id: string
  action: NetworkInterceptionAction
  method?: string
  urlContains: string
  once: boolean
  enabled: boolean
  note?: string
  status?: number
  headers?: Record<string, string>
  body?: string
  rewriteUrl?: string
  rewriteMethod?: string
  rewriteHeaders?: Record<string, string>
  createdAt: number
}

export interface NetworkInterceptionMatchInput {
  method?: string
  url?: string
  stage: NetworkInterceptionStage
}

export interface NormalizeNetworkInterceptionRuleResult {
  ok: boolean
  rule?: NetworkInterceptionRule
  error?: string
}

const BODY_LIMIT = 100_000
const URL_CONTAINS_LIMIT = 300

const normalizeMethod = (value: unknown): string => {
  const method = String(value || '').trim().toUpperCase()
  return /^[A-Z]{2,16}$/.test(method) ? method : ''
}

const normalizeHeaderName = (value: string): string => value.trim().toLowerCase()

const isSensitiveHeader = (name: string): boolean => /^(authorization|cookie|set-cookie|x-csrf-token|x-xsrf-token)$/i.test(name)

const normalizeHeaders = (value: unknown, opts: { allowSensitive?: boolean } = {}): Record<string, string> | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const out: Record<string, string> = {}
  for (const [rawKey, rawValue] of Object.entries(value as Record<string, unknown>)) {
    const key = normalizeHeaderName(rawKey)
    if (!key || isSensitiveHeader(key) && !opts.allowSensitive) continue
    if (rawValue == null) continue
    const text = String(rawValue)
    if (text.length > 2_000) continue
    out[key] = text
  }
  return Object.keys(out).length ? out : undefined
}

const normalizeBody = (value: unknown): string | undefined => {
  if (value == null) return undefined
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  if (text.length > BODY_LIMIT) return text.slice(0, BODY_LIMIT)
  return text
}

export const normalizeNetworkInterceptionRule = (
  value: unknown,
  id: string,
  createdAt = Date.now()
): NormalizeNetworkInterceptionRuleResult => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, error: 'rule must be an object' }
  const raw = value as Record<string, unknown>
  const action = String(raw.action || '').trim() as NetworkInterceptionAction
  if (!['block', 'mock_response', 'rewrite_request', 'rewrite_response'].includes(action)) {
    return { ok: false, error: 'action must be block, mock_response, rewrite_request, or rewrite_response' }
  }
  const urlContains = String(raw.url_contains || raw.urlContains || '').trim()
  if (!urlContains) return { ok: false, error: 'url_contains is required' }
  if (urlContains.length > URL_CONTAINS_LIMIT) return { ok: false, error: 'url_contains is too long' }
  const method = normalizeMethod(raw.method)
  const statusRaw = Number(raw.status ?? raw.statusCode)
  const status = Number.isFinite(statusRaw) && statusRaw >= 100 && statusRaw <= 599 ? Math.trunc(statusRaw) : undefined
  const body = normalizeBody(raw.body)
  const headers = normalizeHeaders(raw.headers, { allowSensitive: action === 'mock_response' || action === 'rewrite_response' })
  const rewriteHeaders = normalizeHeaders(raw.request_headers || raw.requestHeaders)
  const rewriteMethod = normalizeMethod(raw.rewrite_method || raw.rewriteMethod)
  const rewriteUrl = String(raw.rewrite_url || raw.rewriteUrl || '').trim()
  if (action === 'rewrite_request' && !rewriteUrl && !rewriteMethod && !rewriteHeaders) {
    return { ok: false, error: 'rewrite_request requires rewrite_url, rewrite_method, or request_headers' }
  }
  if ((action === 'mock_response' || action === 'rewrite_response') && body == null && status == null && !headers) {
    return { ok: false, error: `${action} requires body, status, or headers` }
  }
  return {
    ok: true,
    rule: {
      id,
      action,
      method: method || undefined,
      urlContains,
      once: raw.once === false ? false : true,
      enabled: raw.enabled === false ? false : true,
      note: String(raw.note || '').trim().slice(0, 300) || undefined,
      status,
      headers,
      body,
      rewriteUrl: rewriteUrl || undefined,
      rewriteMethod: rewriteMethod || undefined,
      rewriteHeaders,
      createdAt
    }
  }
}

export const interceptionRuleStage = (rule: NetworkInterceptionRule): NetworkInterceptionStage =>
  rule.action === 'rewrite_response' ? 'response' : 'request'

export const interceptionStagesForRules = (rules: NetworkInterceptionRule[]): NetworkInterceptionStage[] => {
  const stages = new Set<NetworkInterceptionStage>()
  for (const rule of rules) {
    if (!rule.enabled) continue
    stages.add(interceptionRuleStage(rule))
  }
  return Array.from(stages)
}

export const ruleMatchesPausedRequest = (rule: NetworkInterceptionRule, input: NetworkInterceptionMatchInput): boolean => {
  if (!rule.enabled) return false
  if (interceptionRuleStage(rule) !== input.stage) return false
  const url = String(input.url || '')
  if (!url.includes(rule.urlContains)) return false
  if (rule.method && normalizeMethod(input.method) !== rule.method) return false
  return true
}

export const findMatchingInterceptionRule = (
  rules: NetworkInterceptionRule[],
  input: NetworkInterceptionMatchInput
): NetworkInterceptionRule | undefined => {
  for (const rule of rules) {
    if (ruleMatchesPausedRequest(rule, input)) return rule
  }
  return undefined
}

export const mergeHeaders = (base: HeaderMap | undefined, patch: Record<string, string> | undefined): Record<string, string> | undefined => {
  const out: Record<string, string> = {}
  if (base) {
    for (const [key, value] of Object.entries(base)) {
      const normalizedKey = normalizeHeaderName(key)
      if (!normalizedKey) continue
      if (Array.isArray(value)) out[normalizedKey] = value.join(', ')
      else out[normalizedKey] = String(value)
    }
  }
  if (patch) {
    for (const [key, value] of Object.entries(patch)) out[normalizeHeaderName(key)] = value
  }
  return Object.keys(out).length ? out : undefined
}

export const fetchHeaderEntriesToMap = (value: unknown): Record<string, string> | undefined => {
  if (!Array.isArray(value)) return undefined
  const out: Record<string, string> = {}
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const name = normalizeHeaderName(String((item as Record<string, unknown>).name || ''))
    if (!name) continue
    out[name] = String((item as Record<string, unknown>).value ?? '')
  }
  return Object.keys(out).length ? out : undefined
}

export const hasHeader = (headers: Record<string, string> | undefined, name: string): boolean => {
  if (!headers) return false
  const normalized = normalizeHeaderName(name)
  return Object.keys(headers).some((key) => normalizeHeaderName(key) === normalized)
}

export const headerEntriesForFetch = (headers: Record<string, string> | undefined): Array<{ name: string; value: string }> | undefined => {
  if (!headers) return undefined
  const out: Array<{ name: string; value: string }> = []
  for (const [name, value] of Object.entries(headers)) out.push({ name, value })
  return out.length ? out : undefined
}

export const interceptionRuleSummary = (rule: NetworkInterceptionRule): string => {
  const method = rule.method ? `${rule.method} ` : ''
  const once = rule.once ? ' once' : ''
  return `${rule.action} ${method}*${rule.urlContains}*${once}`.trim()
}

export const publicInterceptionRule = (rule: NetworkInterceptionRule): Record<string, unknown> => ({
  id: rule.id,
  action: rule.action,
  method: rule.method,
  url_contains: rule.urlContains,
  once: rule.once,
  enabled: rule.enabled,
  note: rule.note,
  status: rule.status,
  has_body: rule.body != null,
  header_names: rule.headers ? Object.keys(rule.headers) : [],
  request_header_names: rule.rewriteHeaders ? Object.keys(rule.rewriteHeaders) : [],
  rewrite_url: rule.rewriteUrl,
  rewrite_method: rule.rewriteMethod,
  created_at: rule.createdAt
})
