import { reactive } from 'vue';
import { Message } from '@arco-design/web-vue';
import { authEmitter } from '@/emitter/auth.emitter';
import { loginApi, logoutApi, meApi, type CurrentCustomer } from '@/networking/auth.api';

const TOKEN_KEY = 'bitterless-desktop-token';
const DEVICE_SEED_KEY = 'bitterless-desktop-device-seed';
const DEVICE_ID_KEY = 'bitterless-desktop-device-id';
const BOOTSTRAP_DEVICE_PREFIX = 'bootstrap';

const getToken = (): string | null => localStorage.getItem(TOKEN_KEY);

const setToken = (token: string): void => {
  localStorage.setItem(TOKEN_KEY, token);
};

const clearToken = (): void => {
  localStorage.removeItem(TOKEN_KEY);
};

const createRandomHex32 = (): string => {
  if (crypto.randomUUID) {
    return crypto.randomUUID().replace(/-/g, '');
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
};

const getOrCreateDeviceSeed = (): string => {
  let seed = localStorage.getItem(DEVICE_SEED_KEY);
  if (!seed) {
    seed = createRandomHex32();
    localStorage.setItem(DEVICE_SEED_KEY, seed);
  }
  return seed;
};

const getBootstrapDeviceId = (): string => `${BOOTSTRAP_DEVICE_PREFIX}-${getOrCreateDeviceSeed()}`;

const getCustomerDeviceId = (customerId: number): string => {
  const tail = String(customerId).padStart(8, '0').slice(-8);
  return `${tail}${getOrCreateDeviceSeed()}`;
};

const decodeJwtPayload = (token: string): { sub?: number; scope?: string } | null => {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const json = decodeURIComponent(
      atob(padded)
        .split('')
        .map((c) => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`)
        .join('')
    );
    return JSON.parse(json);
  } catch {
    return null;
  }
};

class AuthStore {
  current: CurrentCustomer | null = null;
  loading = false;
  checking = false;

  isAuthenticated = (): boolean => !!getToken();

  get token(): string | null {
    return getToken();
  }

  get deviceId(): string {
    return localStorage.getItem(DEVICE_ID_KEY) || '';
  }

  loginWithPassword = async (email: string, password: string): Promise<void> => {
    this.loading = true;
    try {
      const bootstrapDeviceId = getBootstrapDeviceId();
      const bootstrapLogin = await loginApi({ email, password, device_id: bootstrapDeviceId });
      const payload = decodeJwtPayload(bootstrapLogin.token);
      const customerId = payload?.scope === 'customer' ? payload.sub : undefined;

      if (!customerId) {
        setToken(bootstrapLogin.token);
        await this.fetchMe();
        await authEmitter.activateSession();
        return;
      }

      const customerDeviceId = getCustomerDeviceId(customerId);
      const finalLogin = await loginApi({ email, password, device_id: customerDeviceId });

      await logoutApi(bootstrapLogin.token).catch(() => undefined);

      localStorage.setItem(DEVICE_ID_KEY, customerDeviceId);
      setToken(finalLogin.token);
      await this.fetchMe();
      await authEmitter.activateSession();
    } catch (err: any) {
      Message.error(err?.message || '登录失败');
      throw err;
    } finally {
      this.loading = false;
    }
  };

  fetchMe = async (): Promise<CurrentCustomer> => {
    const token = getToken();
    if (!token) {
      throw new Error('Missing token');
    }

    this.checking = true;
    try {
      const me = await meApi(token);
      this.current = me;
      if (!localStorage.getItem(DEVICE_ID_KEY)) {
        localStorage.setItem(DEVICE_ID_KEY, getCustomerDeviceId(me.id));
      }
      return me;
    } finally {
      this.checking = false;
    }
  };

  clearLocalSession = (): void => {
    clearToken();
    this.current = null;
  };

  logout = async (): Promise<void> => {
    const token = getToken();
    try {
      if (token) {
        await logoutApi(token);
      }
    } catch {
      // Local logout should still complete when the server token is already gone.
    }
    this.clearLocalSession();
  };
}

export const authStore = reactive<AuthStore>(new AuthStore());
