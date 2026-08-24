/* eslint-disable no-control-regex -- terminal output parsing intentionally matches BEL and ESC. */
const AUTHORIZATION_URL_CANDIDATE = /(https:\/\/[^\s\u0007\u001b"'<>]+)(?=[\s\u0007\u001b])/giu;
const TERMINAL_ESCAPE = /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001b\\))/gu;
/* eslint-enable no-control-regex */
const AUTHORIZATION_URL_PREFIX = 'https://';
const MAXIMUM_PENDING_AUTHORIZATION_URL_CHARACTERS = 64 * 1024;

const isTrustedAuthorizationUrl = (candidate: URL): boolean => {
  if (candidate.username !== '' || candidate.password !== '') return false;
  const hostname = candidate.hostname.toLowerCase();
  const trustedHost =
    hostname === 'claude.ai' ||
    hostname.endsWith('.claude.ai') ||
    hostname === 'claude.com' ||
    hostname.endsWith('.claude.com') ||
    hostname === 'anthropic.com' ||
    hostname.endsWith('.anthropic.com');
  if (!trustedHost || candidate.protocol !== 'https:') return false;

  const marker = `${candidate.pathname}${candidate.search}`.toLowerCase();
  return (
    marker.includes('oauth') ||
    marker.includes('authorize') ||
    candidate.searchParams.has('client_id') ||
    candidate.searchParams.has('code_challenge')
  );
};

export const findClaudeAuthorizationUrl = (output: string): URL | null => {
  for (const match of output.matchAll(AUTHORIZATION_URL_CANDIDATE)) {
    const raw = match[1]?.replace(/&amp;/giu, '&').replace(/[),.;]+$/gu, '');
    if (!raw) continue;
    try {
      const candidate = new URL(raw);
      if (isTrustedAuthorizationUrl(candidate)) return candidate;
    } catch {
      // The bounded output may end in a partial URL candidate.
    }
  }
  return null;
};

export interface ClaudeAuthorizationOutputChunk {
  authorizationUrl: URL | null;
  completedOutput: string;
  pendingAuthorizationTail: string;
}

export const parseClaudeAuthorizationOutputChunk = (
  previousPendingTail: string,
  chunk: string
): ClaudeAuthorizationOutputChunk => {
  const output = `${previousPendingTail}${chunk}`;
  const authorizationUrl = findClaudeAuthorizationUrl(output);
  if (authorizationUrl) {
    return { authorizationUrl, completedOutput: output, pendingAuthorizationTail: '' };
  }

  const lowerOutput = output.toLowerCase();
  const start = lowerOutput.lastIndexOf(AUTHORIZATION_URL_PREFIX);
  if (start >= 0) {
    const tail = output.slice(start);
    if (
      tail.length <= MAXIMUM_PENDING_AUTHORIZATION_URL_CHARACTERS &&
      !/[\s\u0007\u001b"'<>]/u.test(tail)
    ) {
      return {
        authorizationUrl: null,
        completedOutput: output.slice(0, start),
        pendingAuthorizationTail: tail
      };
    }
  }

  const maximumPrefixLength = Math.min(AUTHORIZATION_URL_PREFIX.length - 1, output.length);
  for (let length = maximumPrefixLength; length > 0; length -= 1) {
    const suffix = output.slice(-length);
    if (AUTHORIZATION_URL_PREFIX.startsWith(suffix.toLowerCase())) {
      return {
        authorizationUrl: null,
        completedOutput: output.slice(0, -length),
        pendingAuthorizationTail: suffix
      };
    }
  }

  return { authorizationUrl: null, completedOutput: output, pendingAuthorizationTail: '' };
};

export const hasClaudeManualCodePrompt = (output: string): boolean => {
  const plain = output.replace(TERMINAL_ESCAPE, '').replace(/\r/gu, '');
  return /(?:paste|enter)\s+(?:the\s+)?(?:(?:oauth|authorization)\s+)?code(?:\s+here)?(?:\s+if\s+prompted)?\s*[:>]\s*$/imu.test(
    plain
  );
};
