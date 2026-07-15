const JWT_RE = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g
const BEARER_RE = /\bbearer\s+[A-Za-z0-9._~-]{8,}/gi
const SECRET_JSON_FIELD_RE =
  /("(?:authorization|token|access_token|refresh_token|jwt_token|api[_-]?key|secret|credential|password)"\s*:\s*")([^"]+)(")/gi

export const sanitizeRuntimeError = (raw: unknown, source = 'provider'): string => {
  const text = typeof raw === 'string' ? raw.trim() : String(raw ?? '').trim()
  if (!text) return ''
  const redacted = text
    .replace(JWT_RE, '[REDACTED_JWT]')
    .replace(BEARER_RE, 'Bearer [REDACTED]')
    .replace(SECRET_JSON_FIELD_RE, '$1[REDACTED]$3')
  if (/<html|<!doctype|<\/html>|<body/i.test(redacted) || /Unable to load site|cloudflare|Ray ID/i.test(redacted)) {
    const ray = redacted.match(/Ray ID:\s*([a-z0-9]+)/i)?.[1]
    const ip = redacted.match(/IP:\s*([0-9a-f.:]+)/i)?.[1]
    const blocked = /Unable to load site|blocked|forbidden|access denied|cloudflare/i.test(redacted)
    return (
      `${source} returned an HTML error page` +
      (blocked ? ' — the request was blocked or the endpoint is unreachable from this network' : '') +
      (ip ? ` [IP ${ip}]` : '') +
      (ray ? ` [Ray ID ${ray}]` : '')
    )
  }
  const normalized = redacted.replace(/\s+/g, ' ')
  return normalized.length > 300 ? normalized.slice(0, 300) + '...' : normalized
}
