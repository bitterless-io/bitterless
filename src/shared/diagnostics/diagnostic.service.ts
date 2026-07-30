// One exposure boundary for operator-facing failure causes. Redaction runs before truncation so a
// bound can never leak the prefix of a credential.
export const DIAGNOSTIC_TEXT_LIMIT = 240;

const REDACTIONS: Array<[RegExp, string]> = [
  [/\bsk-[A-Za-z0-9_-]{6,}/g, 'sk-***'],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{6,}/gi, 'Bearer ***'],
  [/\beyJ[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]+){1,2}/g, '***'],
  [
    /\b(access_token|refresh_token|id_token|token|code|client_secret|password)=([^&\s]+)/gi,
    '$1=***'
  ],
  [
    /\b(authorization\s+code|oauth\s+code|user\s+code|device\s+code)\s*[:=]\s*[A-Za-z0-9._~-]{4,}\b/gi,
    '$1=***'
  ],
  [/\b(access\s+token|refresh\s+token|id\s+token)\s*[:=]\s*[A-Za-z0-9._~+/-]{4,}\b/gi, '$1=***'],
  [/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, '***@***'],
  [/(?:\/Users|\/home)\/[^\s/\\]+/g, '~'],
  [/[A-Za-z]:\\Users\\[^\s\\]+/gi, '~'],
  [/\b[A-Za-z0-9_-]{24,}\b/g, '***']
];

const OBJECT_TEXT_FIELDS = ['message', 'errorMessage', 'reason', 'code'] as const;

const diagnosticText = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Error) return value.message || value.name;
  if (Array.isArray(value)) return value.map((item) => diagnosticText(item)).join(' ');
  if (!value || typeof value !== 'object') return '';

  // A rejection that crossed a process boundary arrives as a plain object, not an Error.
  const record = value as Record<string, unknown>;
  for (const field of OBJECT_TEXT_FIELDS) {
    const candidate = record[field];
    if (typeof candidate === 'string' && candidate.trim()) return candidate;
    if (typeof candidate === 'number') return String(candidate);
  }
  return '';
};

export const sanitizeDiagnosticUrl = (value: unknown): string => {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return '';
  }
};

const redactEmbeddedUrls = (value: string): string =>
  value.replace(/https?:\/\/[^\s'"<>]+/gi, (candidate) => {
    const sanitized = sanitizeDiagnosticUrl(candidate);
    return sanitized || '[redacted-url]';
  });

export const sanitizeDiagnostic = (
  value: unknown,
  limit: number = DIAGNOSTIC_TEXT_LIMIT
): string => {
  const collapsed = diagnosticText(value).replace(/\s+/g, ' ').trim();
  if (!collapsed) return '';

  let redacted = redactEmbeddedUrls(collapsed);
  for (const [pattern, replacement] of REDACTIONS) {
    redacted = redacted.replace(pattern, replacement);
  }

  const bound = Math.max(1, Math.min(limit, DIAGNOSTIC_TEXT_LIMIT));
  if (redacted.length <= bound) return redacted;
  return `${redacted.slice(0, bound - 1).trimEnd()}…`;
};

const causeField = (
  record: Record<string, unknown>,
  field: 'name' | 'code' | 'message'
): string => {
  const value = record[field];
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  if (field === 'code' && typeof value === 'string' && /^[A-Z][A-Z0-9_-]{0,63}$/.test(value)) {
    return value;
  }
  return sanitizeDiagnostic(value, 120);
};

export const sanitizeErrorCauseChain = (value: unknown, maxDepth: number = 4): string => {
  const parts: string[] = [];
  const seen = new Set<object>();
  let current: unknown = value;
  const depthLimit = Math.max(1, Math.min(maxDepth, 6));

  for (let depth = 0; depth < depthLimit; depth += 1) {
    if (!current || typeof current !== 'object' || seen.has(current)) break;
    seen.add(current);
    const record = current as Record<string, unknown>;
    const name = causeField(record, 'name') || (current instanceof Error ? current.name : '');
    const code = causeField(record, 'code');
    const message =
      causeField(record, 'message') ||
      (current instanceof Error ? sanitizeDiagnostic(current.message, 120) : '');
    const fields = [
      name ? `name=${name}` : '',
      code ? `code=${code}` : '',
      message ? `message=${message}` : ''
    ].filter(Boolean);
    if (fields.length > 0) parts.push(fields.join(' '));
    current = record.cause;
  }

  const joined = parts.join(' <- ');
  if (joined.length <= DIAGNOSTIC_TEXT_LIMIT) return joined;
  return `${joined.slice(0, DIAGNOSTIC_TEXT_LIMIT - 1).trimEnd()}…`;
};
