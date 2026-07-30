import { isMutatingHttpMethod } from '@maestro-main/drive/apiSafety'
import {
  collectApiReads,
  collectApiWrites,
  type AgentUiAction,
  type AuthHint,
  type BrowserCommand
} from '@maestro-main/drive/replayEngine'
import { clipText } from '@maestro-main/capture/traceTimeline'
import {
  apiEndpointContract,
  buildAuthHint,
  skillEndpointPath
} from '@maestro-main/skills/skillContract.helper'
import type { SkillRecipe } from '@maestro-main/skills/skillRecipe.types'
import type { AgentActivityStep } from '@maestro-shared/coach.api'

const REPLAY_RESPONSE_PREVIEW_LIMIT = 2_000

export const apiActivityPhase = (method: string): AgentActivityStep['phase'] => {
  return ['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase()) ? 'api-read' : 'api-call'
}

export const apiActivityPath = (url: string, baseUrl: string): string => {
  try {
    const parsed = new URL(url, baseUrl)
    return parsed.pathname + parsed.search
  } catch {
    return url
  }
}

export const describeApiAuthResolution = (
  auth?: { header: string; source: string; key?: string; applied: boolean }[]
): string => {
  if (!auth?.length) return ''
  return auth
    .map((item) => {
      const source = item.applied ? item.source : 'missing'
      return item.key ? `${source}(${item.key})` : source
    })
    .join(', ')
}

export const hostFromUrl = (url: string | undefined): string => {
  if (!url) return ''
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}

export const normalizeApiQuery = (
  value: unknown
): Record<string, string | number | boolean> | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const out: Record<string, string | number | boolean> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
      out[key] = item
    }
  }
  return Object.keys(out).length ? out : undefined
}

export const normalizeBrowserCommandId = (value: unknown): string | undefined => {
  const text = cleanShortText(value)
  if (!text) return undefined
  return text.replace(/\s+/g, '_').slice(0, 80)
}

export const browserCommandHasMutatingFetch = (command: BrowserCommand): boolean => {
  if (command.command === 'fetch') return isMutatingHttpMethod(command.method)
  if (command.command === 'parallel') {
    return command.commands.some(browserCommandHasMutatingFetch)
  }
  return false
}

export const isBrowserFetchResultCommand = (command: string): boolean => {
  return command === 'fetch' || command.endsWith('.fetch')
}

export const normalizeBrowserExecAuth = (value: unknown): AuthHint[] | undefined => {
  const raw = Array.isArray(value) ? value : value && typeof value === 'object' ? [value] : []
  const hints: AuthHint[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const record = item as Record<string, unknown>
    const header = cleanHeaderName(record.header)
    if (!header || isForbiddenDynamicAuthHeader(header)) continue
    const candidateKeys = uniqueStrings([
      ...asShortStringList(record.candidateKeys),
      ...asShortStringList(record.candidate_keys),
      ...asShortStringList(record.keys),
      ...asShortStringList(record.storageKeys),
      ...asShortStringList(record.storage_keys),
      ...asShortStringList(record.cookieNames),
      ...asShortStringList(record.cookie_names)
    ]).slice(0, 16)
    const meta = cleanShortText(record.meta)
    const prefix = cleanAuthPrefix(record.prefix)
    if (!candidateKeys.length && !meta) continue
    hints.push({ header, candidateKeys, prefix, meta })
  }
  return hints.length ? hints : undefined
}

export const mergeAuthHints = (
  base: AuthHint[],
  extra?: AuthHint | AuthHint[] | null
): AuthHint[] => {
  const list = [...(base || []), ...(Array.isArray(extra) ? extra : extra ? [extra] : [])]
  const out: AuthHint[] = []
  const seen = new Set<string>()
  for (const hint of list) {
    if (!hint?.header || isForbiddenDynamicAuthHeader(hint.header)) continue
    const normalized: AuthHint = {
      header: cleanHeaderName(hint.header),
      candidateKeys: uniqueStrings(asShortStringList(hint.candidateKeys)).slice(0, 16),
      prefix: cleanAuthPrefix(hint.prefix),
      meta: cleanShortText(hint.meta)
    }
    if (!normalized.header || (!normalized.candidateKeys?.length && !normalized.meta)) continue
    const key = `${normalized.header.toLowerCase()}|${(normalized.candidateKeys || []).join(',')}|${normalized.meta || ''}|${normalized.prefix || ''}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(normalized)
  }
  return out
}

export const sanitizeReplayHeaders = (
  value: unknown
): Record<string, string> | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const blocked =
    /^(authorization|cookie|set-cookie|host|origin|referer|user-agent|content-length)$/i
  const dynamicSecret =
    /(csrf|xsrf|token|secret|credential|session|jwt|bearer|api[-_]?key)/i
  const out: Record<string, string> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (blocked.test(key) || dynamicSecret.test(key)) continue
    const lower = key.toLowerCase()
    if (lower.startsWith('sec-') || lower === 'accept-encoding') continue
    const text =
      typeof raw === 'string'
        ? raw
        : Array.isArray(raw)
          ? raw.join(', ')
          : raw == null
            ? ''
            : String(raw)
    if (text) out[key] = text
  }
  return Object.keys(out).length ? out : undefined
}

export const compactReplayData = (value: unknown): unknown => {
  if (typeof value === 'string') return clipText(value, 24_000)
  if (value == null || typeof value !== 'object') return value
  try {
    const text = JSON.stringify(value)
    if (text.length <= 24_000) return value
    return { truncated: true, preview: clipText(text, 24_000) }
  } catch {
    return String(value)
  }
}

export const replayResponsePreview = (value: unknown): string | undefined => {
  if (value === undefined) return undefined
  let text: string
  try {
    text = typeof value === 'string' ? value : JSON.stringify(value)
  } catch {
    text = String(value)
  }
  const trimmed = text.trim()
  return trimmed ? clipText(trimmed, REPLAY_RESPONSE_PREVIEW_LIMIT) : undefined
}

export const parseBrowserCommand = (entry: unknown): BrowserCommand | null => {
  if (!entry || typeof entry !== 'object') return null
  const record = entry as Record<string, unknown>
  const command = String(record.command || '')
  const id = normalizeBrowserCommandId(record.id)
  if (command === 'read_context') {
    return {
      command,
      id,
      keys: Array.isArray(record.keys) ? record.keys.map(String) : undefined
    }
  }
  if (command === 'fetch' && typeof record.url === 'string') {
    return {
      command,
      id,
      url: record.url,
      method: typeof record.method === 'string' ? record.method : undefined,
      query: normalizeApiQuery(record.query),
      headers: sanitizeReplayHeaders(record.headers),
      auth: normalizeBrowserExecAuth(
        record.auth ?? record.header_policy ?? record.headerPolicy
      ),
      body: record.body
    }
  }
  if (command === 'parallel' && Array.isArray(record.commands)) {
    const commands = record.commands
      .map(parseBrowserCommand)
      .filter((item): item is BrowserCommand => Boolean(item))
    return commands.length ? { command, id, commands } : null
  }
  return null
}

export const parseAgentUiActions = (
  value: unknown
): AgentUiAction[] => {
  const rawList = Array.isArray(value) ? value : [value]
  const allowed = ['click', 'fill', 'select', 'check', 'submit']
  const actions: AgentUiAction[] = []
  for (const entry of rawList) {
    if (!entry || typeof entry !== 'object') continue
    const record = entry as Record<string, unknown>
    const action = String(record.action || '')
    if (allowed.indexOf(action) < 0) continue
    const ref = typeof record.ref === 'string' ? record.ref.trim() : ''
    const selector = ref
      ? `[data-coach-ref="${ref.replace(/"/g, '\\"')}"]`
      : typeof record.selector === 'string'
        ? record.selector
        : ''
    if (!selector) continue
    actions.push({
      action: action as AgentUiAction['action'],
      selector,
      value: typeof record.value === 'string' ? record.value : undefined,
      checked: typeof record.checked === 'boolean' ? record.checked : undefined
    })
  }
  return actions
}

export const describeUiActionResult = (result: {
  target?: { tag: string; id: string; name: string }
  selector: string
}): string => {
  const target = result.target
  if (!target) return result.selector
  const parts = [target.tag]
  if (target.id) parts.push(target.id)
  if (target.name) parts.push(target.name)
  return parts.join(' | ')
}

export const buildSkillContractText = (recipe: SkillRecipe): string => {
  const reads = collectApiReads(recipe)
  const writes = collectApiWrites(recipe)
  const uiSteps = recipe.steps.map((step) => {
    const target = step.target
    const label = target.label || target.text || ''
    const ref = label ? `"${label}"` : target.selector
    const id = target.name ? ` [name="${target.name}"]` : ''
    const value = step.valueTemplate ? ` = ${step.valueTemplate}` : ''
    return `${step.action} ${ref}${id}${value}`
  })
  const hasUi = uiSteps.length > 0
  return clipText(
    JSON.stringify(
      {
        id: recipe.id,
        name: recipe.name,
        description: recipe.description,
        inputs: recipe.inputs,
        input_shape:
          'Input names may be dotted paths such as patient.name. variables_json may use either {"patient.name":"Jane"} or {"patient":{"name":"Jane"}}; run_skill_script exposes both vars["patient.name"] and vars.patient.name.',
        has_script: !!recipe.script,
        field_rules: recipe.fieldRules ?? null,
        ui_flow: {
          note: hasUi
            ? 'WORKFLOW GUIDE — recorded_steps are the controls to operate IN ORDER, not a script. Execute them ONE AT A TIME with the page_snapshot → ui_act → page_snapshot loop: observe the live page after each action and adapt (handle dialogs, skip already-correct fields, re-read refs). Do NOT replay them as a batch.'
            : 'No UI steps recorded; observe with page_snapshot and operate the page step by step.',
          recorded_steps: uiSteps
        },
        api: {
          note: 'Call these endpoints directly via browser_exec.fetch. Cookies/session ride along automatically, and token headers are resolved LIVE in-page from the domain auth profile. Use browser_exec.parallel only for independent read/lookup endpoints. GROUND every id/code/option from option_reads before a write — never invent them. After each response, decide whether another API call or a UI step is needed.',
          auth:
            buildAuthHint([...reads, ...writes]).length > 0
              ? {
                  note: 'Value-free scheme only. Do not manually copy token values; browser_exec.fetch applies these headers from live storage/cookies/meta at call time.',
                  headers: buildAuthHint([...reads, ...writes])
                }
              : 'cookie-session — no token header recorded; cookies ride along automatically.',
          option_reads: reads.map((item) =>
            apiEndpointContract(item, 'option-read')
          ),
          write_templates: writes.map((item) => ({
            method: (item.method || 'POST').toUpperCase(),
            url: skillEndpointPath(item.url),
            role: item.apiRole || 'write',
            replay: item.replaySafety || 'confirm',
            body_kind: item.bodyKind || (item.requestBody ? 'raw' : 'none'),
            body_template: item.requestBody ?? null
          }))
        }
      },
      null,
      1
    )
  )
}

const cleanHeaderName = (value: unknown): string => {
  const text = typeof value === 'string' ? value.trim() : ''
  return /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,80}$/.test(text) ? text : ''
}

const isForbiddenDynamicAuthHeader = (header: string): boolean => {
  return /^(cookie|set-cookie|host|origin|referer|user-agent|content-length|proxy-authorization)$/i.test(
    header
  )
}

const cleanShortText = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  if (!text || text.length > 80 || /[\r\n]/.test(text) || looksLikeSecretLiteral(text)) {
    return undefined
  }
  return text
}

const cleanAuthPrefix = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  const text = value
  if (text.length > 40 || /[\r\n]/.test(text) || looksLikeSecretLiteral(text)) return undefined
  return text
}

const asShortStringList = (value: unknown): string[] => {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => cleanShortText(item))
    .filter((item): item is string => Boolean(item))
}

const uniqueStrings = (values: string[]): string[] => {
  const out: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    const key = value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(value)
  }
  return out
}

const looksLikeSecretLiteral = (value: string): boolean => {
  return (
    /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/.test(value) ||
    /\bbearer\s+[A-Za-z0-9._~-]{12,}/i.test(value) ||
    /^[A-Za-z0-9._~-]{120,}$/.test(value)
  )
}
