import { authEmitter } from '@/emitter/auth.emitter';

const TEST_CORE_URL = 'https://bl-test-api.terncloud.com';
const DEFAULT_PROD_CORE_URL = TEST_CORE_URL;
const DEFAULT_DEV_CORE_URL = TEST_CORE_URL;
const TOKEN_HEADER = '-x-bl-token';

export interface AuthLoginResult {
  token: string;
  scope: 'customer';
  email: string;
}

export interface CurrentCustomer {
  id: number;
  email: string;
  nickname?: string;
  scope: 'customer';
  has_password: boolean;
}

const getBaseUrl = (): string => {
  const configured = import.meta.env.VITE_BITTERLESS_CORE_URL;
  const fallback =
    import.meta.env.VITE_ENV === 'prod' ? DEFAULT_PROD_CORE_URL : DEFAULT_DEV_CORE_URL;
  return (configured || fallback).replace(/\/+$/, '');
};

const reportAuthInvalidation = async (
  status: number,
  reason: string,
  source: string
): Promise<void> => {
  try {
    await authEmitter.invalidateSession({ status, reason, source });
  } catch (err) {
    console.warn('[auth.api] Failed to report auth invalidation:', err);
  }
};

const parseResponse = async <T>(
  res: Response,
  context: { path: string; token?: string }
): Promise<T> => {
  const text = await res.text();
  let data: any = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { message: text };
  }
  if (!res.ok) {
    const message = Array.isArray(data?.message)
      ? data.message.join(', ')
      : data?.message || data?.error || `Request failed with ${res.status}`;
    if (res.status === 401 && context.token && context.path !== '/auth/logout') {
      await reportAuthInvalidation(res.status, message, context.path);
    }
    throw new Error(message);
  }
  return data as T;
};

const request = async <T>(
  path: string,
  options: RequestInit & { token?: string } = {}
): Promise<T> => {
  const headers = new Headers(options.headers);
  headers.set('content-type', 'application/json');
  if (options.token) {
    headers.set(TOKEN_HEADER, options.token);
  }

  const res = await fetch(`${getBaseUrl()}${path}`, {
    ...options,
    headers
  });
  return parseResponse<T>(res, { path, token: options.token });
};

export const loginApi = (data: {
  email: string;
  password: string;
  device_id: string;
}): Promise<AuthLoginResult> =>
  request<AuthLoginResult>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ ...data, scope: 'customer' })
  });

export const meApi = (token: string): Promise<CurrentCustomer> =>
  request<CurrentCustomer>('/auth/me', {
    method: 'GET',
    token
  });

export const logoutApi = (token: string): Promise<{ ok: true }> =>
  request<{ ok: true }>('/auth/logout', {
    method: 'POST',
    body: '{}',
    token
  });
