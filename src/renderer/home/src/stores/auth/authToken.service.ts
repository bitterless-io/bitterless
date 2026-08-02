const TOKEN_KEY = 'bitterless-desktop-token';
const SESSION_ID_KEY = 'bitterless-desktop-session-id';

const createSessionId = (): string => {
  if (crypto.randomUUID) return crypto.randomUUID();

  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
};

export const getCustomerToken = (): string | null => localStorage.getItem(TOKEN_KEY);

export const getCustomerSessionId = (): string | null => {
  if (!getCustomerToken()) return null;

  const existingSessionId = localStorage.getItem(SESSION_ID_KEY);
  if (existingSessionId) return existingSessionId;

  const sessionId = createSessionId();
  localStorage.setItem(SESSION_ID_KEY, sessionId);
  return sessionId;
};

export const getCustomerSessionIdForToken = (token: string): string | null =>
  getCustomerToken() === token ? getCustomerSessionId() : null;

export const setCustomerToken = (token: string): void => {
  if (typeof token !== 'string' || token.trim().length === 0 || token !== token.trim()) {
    throw new Error('Invalid customer token');
  }

  if (getCustomerToken() !== token) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(SESSION_ID_KEY, createSessionId());
    return;
  }

  if (!localStorage.getItem(SESSION_ID_KEY)) {
    localStorage.setItem(SESSION_ID_KEY, createSessionId());
  }
};

export const clearCustomerToken = (): void => {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(SESSION_ID_KEY);
};
