export interface ClaudeLoopbackCallbackFence {
  protocol: 'http:';
  hostname: string;
  port: string;
  pathname: string;
}

const isAnthropicHost = (hostname: string): boolean =>
  hostname === 'claude.ai' ||
  hostname.endsWith('.claude.ai') ||
  hostname === 'claude.com' ||
  hostname.endsWith('.claude.com') ||
  hostname === 'anthropic.com' ||
  hostname.endsWith('.anthropic.com');

const isLoopbackHost = (hostname: string): boolean =>
  hostname === 'localhost' ||
  hostname === '127.0.0.1' ||
  hostname === '::1' ||
  hostname === '[::1]';

const hasCredentials = (url: URL): boolean => url.username !== '' || url.password !== '';

export const resolveClaudeLoopbackCallbackFence = (
  authorizationUrl: URL
): ClaudeLoopbackCallbackFence | null => {
  if (hasCredentials(authorizationUrl)) return null;
  for (const key of ['redirect_uri', 'redirect_url', 'callback_url']) {
    const raw = authorizationUrl.searchParams.get(key);
    if (!raw) continue;
    try {
      const callback = new URL(raw);
      if (
        hasCredentials(callback) ||
        callback.protocol !== 'http:' ||
        !isLoopbackHost(callback.hostname.toLowerCase())
      ) {
        continue;
      }
      return {
        protocol: 'http:',
        hostname: callback.hostname.toLowerCase(),
        port: callback.port,
        pathname: callback.pathname
      };
    } catch {
      // Ignore malformed provider callback metadata and keep the fence closed.
    }
  }
  return null;
};

export const isAllowedClaudeAuthNavigation = (
  candidate: string,
  loopbackCallback: ClaudeLoopbackCallbackFence | null
): boolean => {
  try {
    const url = new URL(candidate);
    if (hasCredentials(url)) return false;
    const hostname = url.hostname.toLowerCase();
    if (url.protocol === 'https:' && isAnthropicHost(hostname)) return true;
    return Boolean(
      loopbackCallback &&
      url.protocol === loopbackCallback.protocol &&
      hostname === loopbackCallback.hostname &&
      url.port === loopbackCallback.port &&
      url.pathname === loopbackCallback.pathname
    );
  } catch {
    return false;
  }
};
