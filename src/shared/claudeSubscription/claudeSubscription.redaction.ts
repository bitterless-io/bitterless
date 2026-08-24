const AUTHORIZATION_URL = /https?:(?:(?:\\+)?\/){2}[^\s"'<>]+/giu;
const ANTHROPIC_TOKEN = /\bsk-ant-[a-z0-9._-]+\b/giu;
const BEARER_TOKEN = /\bBearer\s+[a-z0-9._~+/=-]+/giu;
const SENSITIVE_QUERY =
  /([?&](?:code|state|token|access_token|refresh_token|authorization_code|code_challenge|code_verifier|client_secret)=)[^&#\s]*/giu;
const SECRET_FIELD =
  '(?:authorization_code|authorization_url|authorization|oauth_token|access_token|refresh_token|id_token|client_secret|code_verifier|code_challenge|anthropic_api_key|anthropic_auth_token|claude_code_oauth_token|token|auth)';
const SECRET_ASSIGNMENT_FIELD =
  '(?:authorization_code|authorization_url|oauth_token|access_token|refresh_token|id_token|client_secret|code_verifier|code_challenge|anthropic_api_key|anthropic_auth_token|claude_code_oauth_token|token)';
const PLAIN_JSON_SECRET = new RegExp(`("${SECRET_FIELD}"\\s*:\\s*)"(?:\\\\.|[^"\\\\])*"`, 'giu');
const ESCAPED_JSON_SECRET = new RegExp(
  `(\\\\"${SECRET_FIELD}\\\\"\\s*:\\s*)\\\\"(?:\\\\\\\\.|[^"\\\\])*\\\\"`,
  'giu'
);
const SECRET_ASSIGNMENT = new RegExp(
  `\\b${SECRET_ASSIGNMENT_FIELD}\\b\\s*[=:]\\s*("(?:\\\\.|[^"\\\\])*"|'[^']*'|[^\\s,;}]+)`,
  'giu'
);
const AUTH_ASSIGNMENT = /\b(?:authorization|auth)\b\s*[=:]\s*([^\r\n,;]+)/giu;

const isAuthorizationUrl = (candidate: string): boolean => {
  const lower = candidate.replace(/\\+\//gu, '/').toLowerCase();
  if (lower.includes('/oauth/authorize') || lower.includes('/oauth2/authorize')) return true;
  if (lower.includes('/authorize?') || lower.includes('/authorize#')) return true;

  const hasOAuthQuery =
    lower.includes('client_id=') ||
    lower.includes('redirect_uri=') ||
    lower.includes('code_challenge=') ||
    lower.includes('response_type=code');
  const isAuthHost =
    lower.includes('claude.ai') || lower.includes('claude.com') || lower.includes('anthropic.com');
  return hasOAuthQuery && isAuthHost;
};

const redactAuthorizationUrl = (candidate: string): string => {
  const trailingBackslashes = candidate.match(/\\+$/u)?.[0] ?? '';
  const url = trailingBackslashes ? candidate.slice(0, -trailingBackslashes.length) : candidate;
  return isAuthorizationUrl(url) ? `[REDACTED_AUTHORIZATION_URL]${trailingBackslashes}` : candidate;
};

export const redactClaudeSubscriptionSecrets = (value: unknown): string => {
  const text = typeof value === 'string' ? value : String(value ?? '');

  return text
    .replace(AUTHORIZATION_URL, redactAuthorizationUrl)
    .replace(ESCAPED_JSON_SECRET, '$1\\"[REDACTED]\\"')
    .replace(PLAIN_JSON_SECRET, '$1"[REDACTED]"')
    .replace(ANTHROPIC_TOKEN, '[REDACTED_TOKEN]')
    .replace(BEARER_TOKEN, 'Bearer [REDACTED]')
    .replace(SECRET_ASSIGNMENT, (match, secret: string) => match.replace(secret, '[REDACTED]'))
    .replace(AUTH_ASSIGNMENT, (match, secret: string) => match.replace(secret, '[REDACTED]'))
    .replace(SENSITIVE_QUERY, '$1[REDACTED]');
};
