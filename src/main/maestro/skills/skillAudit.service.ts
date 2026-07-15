import type { SkillAuditIssue, SkillAuditResult } from '@maestro-shared/coach.api'
import type { SkillRecipe } from './skillRecipe.types'

const SENSITIVE_HEADER_RE = /^(authorization|cookie|set-cookie|proxy-authorization|x-api-key|api-key|x-csrf-token|csrf-token|x-xsrf-token|x-auth-token|access-token|refresh-token)$/i
const SENSITIVE_HEADER_NAME_RE = /(authorization|cookie|set-cookie|api[-_]?key|csrf|xsrf|auth[-_]?token|access[-_]?token|refresh[-_]?token)/i
const JWT_RE = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g
const BEARER_RE = /\bbearer\s+[A-Za-z0-9._~-]{12,}/gi
const HEADER_VALUE_RE = /(^|\n)(\s*(?:authorization|cookie|set-cookie|x-api-key|api-key|x-csrf-token|csrf-token|x-xsrf-token|x-auth-token|access-token|refresh-token)\s*[:=]\s*)[^\n]+/gi
const POSSIBLE_NIK_RE = /\b\d{16}\b/g
const POSSIBLE_BPJS_RE = /\bP\d{8,}\b/gi

export const sanitizeSkillBodyForStorage = (text: string): string => {
  return String(text || '')
    .replace(JWT_RE, '[REDACTED_JWT]')
    .replace(BEARER_RE, 'Bearer [REDACTED]')
    .replace(HEADER_VALUE_RE, '$1$2[REDACTED]')
    .replace(POSSIBLE_NIK_RE, '[REDACTED_16_DIGIT_ID]')
    .replace(POSSIBLE_BPJS_RE, '[REDACTED_BPJS_ID]')
}

export const sanitizeSkillScriptForStorage = (script?: string): string | undefined => {
  if (!script) return script
  return containsSecretLiteral(script) ? undefined : script
}

export const auditSkillPackage = (recipe: SkillRecipe, body = ''): SkillAuditResult => {
  const issues: SkillAuditIssue[] = []
  const add = (severity: SkillAuditIssue['severity'], code: string, message: string, path?: string): void => {
    issues.push({ severity, code, message, path })
  }

  for (const [index, item] of recipe.network.entries()) {
    const base = `recipe.network[${index}]`
    for (const key of Object.keys(item.headers || {})) {
      if (SENSITIVE_HEADER_RE.test(key) || SENSITIVE_HEADER_NAME_RE.test(key)) {
        add('error', 'sensitive-header', `Sensitive header "${key}" must be resolved live, not stored.`, `${base}.headers.${key}`)
      }
      const value = (item.headers || {})[key]
      const joined = Array.isArray(value) ? value.join('\n') : String(value || '')
      if (containsSecretLiteral(joined)) add('error', 'secret-header-value', `Header "${key}" contains a secret-like literal.`, `${base}.headers.${key}`)
    }
    for (const [policyIndex, policy] of (item.headerPolicy || []).entries()) {
      if (policy.kind !== 'static' && policy.fallback) {
        add('error', 'header-policy-fallback', 'Dynamic header policy must not persist a recorded fallback value.', `${base}.headerPolicy[${policyIndex}].fallback`)
      }
    }
    if (item.requestBody && requestBodyHasConcreteValues(item.requestBody)) {
      add('error', 'request-body-values', 'Request body must be shape-only; concrete values should be blanked.', `${base}.requestBody`)
    }
    if (item.responseBodyPreview) {
      add('error', 'response-body-preview', 'Response body previews must not be persisted in skills.', `${base}.responseBodyPreview`)
    }
  }

  for (const [index, step] of recipe.steps.entries()) {
    if (step.originalValue) add('error', 'step-original-value', 'Recorded UI input values must not be stored.', `recipe.steps[${index}].originalValue`)
    if (step.valueTemplate && !/^\{\{[a-zA-Z0-9_]+\}\}$/.test(step.valueTemplate)) {
      add('error', 'step-literal-value', 'UI value templates must reference vars only.', `recipe.steps[${index}].valueTemplate`)
    }
    if (step.yaml && /\[value="/.test(step.yaml)) add('error', 'snapshot-value', 'Step YAML still contains an input value.', `recipe.steps[${index}].yaml`)
  }

  for (const [index, snapshot] of recipe.snapshots.entries()) {
    if (/\[value="/.test(snapshot.yaml)) add('error', 'snapshot-value', 'Snapshot YAML still contains an input value.', `recipe.snapshots[${index}].yaml`)
  }

  if (recipe.script && containsSecretLiteral(recipe.script)) {
    add('error', 'script-secret-literal', 'Automation script contains a secret-like literal; it should use vars.* and live auth resolution.', 'recipe.script')
  }

  const bodyText = String(body || '')
  if (containsSecretLiteral(bodyText)) add('error', 'body-secret-literal', 'Skill markdown contains a secret-like literal.', 'SKILL.md')
  if (POSSIBLE_NIK_RE.test(bodyText)) add('warning', 'possible-16-digit-id', 'Skill markdown contains a 16-digit value that looks like an ID.', 'SKILL.md')
  POSSIBLE_NIK_RE.lastIndex = 0
  if (POSSIBLE_BPJS_RE.test(bodyText)) add('warning', 'possible-bpjs-id', 'Skill markdown contains a BPJS-like P-number.', 'SKILL.md')
  POSSIBLE_BPJS_RE.lastIndex = 0

  return {
    ok: !issues.some((issue) => issue.severity === 'error'),
    checkedAt: Date.now(),
    issues
  }
}

const containsSecretLiteral = (value: string): boolean => {
  if (!value) return false
  JWT_RE.lastIndex = 0
  BEARER_RE.lastIndex = 0
  HEADER_VALUE_RE.lastIndex = 0
  return JWT_RE.test(value) || BEARER_RE.test(value) || HEADER_VALUE_RE.test(value)
}

const requestBodyHasConcreteValues = (body: string): boolean => {
  const t = String(body || '').trim()
  if (!t) return false
  try {
    return jsonHasConcreteValues(JSON.parse(t))
  } catch {
    /* not JSON */
  }
  if (t.includes('=') && !t.includes('\n')) {
    try {
      const params = new URLSearchParams(t)
      for (const value of params.values()) if (value) return true
      return false
    } catch {
      return true
    }
  }
  return true
}

const jsonHasConcreteValues = (value: unknown): boolean => {
  if (Array.isArray(value)) return value.some(jsonHasConcreteValues)
  if (value && typeof value === 'object') return Object.values(value as Record<string, unknown>).some(jsonHasConcreteValues)
  if (typeof value === 'string') return value.length > 0
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'boolean') return value !== false
  return false
}
