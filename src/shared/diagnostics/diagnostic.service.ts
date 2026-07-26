// One exposure boundary for operator-facing failure causes. Redaction runs before truncation so a
// bound can never leak the prefix of a credential.
export const DIAGNOSTIC_TEXT_LIMIT = 240;

const REDACTIONS: Array<[RegExp, string]> = [
  [/\bsk-[A-Za-z0-9_-]{6,}/g, 'sk-***'],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{6,}/gi, 'Bearer ***'],
  [/\beyJ[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]+){1,2}/g, '***'],
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

export const sanitizeDiagnostic = (
  value: unknown,
  limit: number = DIAGNOSTIC_TEXT_LIMIT
): string => {
  const collapsed = diagnosticText(value).replace(/\s+/g, ' ').trim();
  if (!collapsed) return '';

  let redacted = collapsed;
  for (const [pattern, replacement] of REDACTIONS) {
    redacted = redacted.replace(pattern, replacement);
  }

  const bound = Math.max(1, Math.min(limit, DIAGNOSTIC_TEXT_LIMIT));
  if (redacted.length <= bound) return redacted;
  return `${redacted.slice(0, bound - 1).trimEnd()}…`;
};
