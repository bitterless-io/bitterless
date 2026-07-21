import { reactive } from 'vue';
import { Message } from '@arco-design/web-vue';
import { authEmitter } from '@/emitter/auth.emitter';
import { scheduleBestEffort, settleBestEffort } from '@/stores/auth/authSession.service';
import { todoistSyncSessionEmitter } from '@/stores/auth/todoistSyncSession.emitter';
import {
  changePasswordApi,
  loginApi,
  logoutApi,
  meApi,
  resetPasswordApi,
  sendOtpApi,
  verifyOtpApi,
  type CurrentCustomer,
  type OtpPurpose
} from '@/networking/auth.api';

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

export const customerNeedsPasswordSetup = (customer: CurrentCustomer | null | undefined): boolean =>
  !!customer &&
  (customer.status === 'invited' || customer.must_set_password || !customer.has_password);

const ensureSessionEligibleCustomer = (customer: CurrentCustomer): CurrentCustomer => {
  const status = (customer as { status?: unknown }).status;
  if (status === 'active' || status === 'invited') return customer;
  if (status === 'inactive') {
    throw new Error('账号已停用，请联系管理员');
  }
  throw new Error('账号状态无效，请重新登录');
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
  loggingOut = false;
  sendingOtp = false;
  resettingPassword = false;
  checking = false;

  isAuthenticated(): boolean {
    return !!getToken();
  }

  get token(): string | null {
    return getToken();
  }

  get deviceId(): string {
    return localStorage.getItem(DEVICE_ID_KEY) || '';
  }

  private async fetchValidatedCustomer(token: string): Promise<CurrentCustomer> {
    return ensureSessionEligibleCustomer(await meApi(token));
  }

  private activateAuthenticatedSession(current: CurrentCustomer): void {
    ensureSessionEligibleCustomer(current);
    if (current.status !== 'active' || customerNeedsPasswordSetup(current)) {
      throw new Error('账号尚未完成首次密码设置');
    }

    scheduleBestEffort(() => authEmitter.activateSession(), (err) => {
      console.error('[AuthStore] Failed to activate optional authenticated runtimes:', err);
    });
    const coreToken = getToken();
    const deviceId = this.deviceId;
    if (!coreToken || !deviceId) {
      console.error('[AuthStore] Todo sync activation is missing the Core token or device ID');
      return;
    }
    scheduleBestEffort(
      () => todoistSyncSessionEmitter.activate({
        coreToken,
        customerId: current.id,
        deviceId,
      }),
      (err) => {
        console.error('[AuthStore] Failed to activate Todo sync:', err);
      },
    );
  }

  private async activateToken(token: string, deviceId: string): Promise<CurrentCustomer> {
    let current: CurrentCustomer;
    try {
      current = await this.fetchValidatedCustomer(token);
    } catch (err) {
      this.clearLocalSession();
      await logoutApi(token).catch(() => undefined);
      throw err;
    }

    localStorage.setItem(DEVICE_ID_KEY, deviceId);
    setToken(token);
    this.current = current;

    if (!customerNeedsPasswordSetup(current)) {
      this.activateAuthenticatedSession(current);
    }
    return current;
  }

  async loginWithPassword(email: string, password: string): Promise<void> {
    this.loading = true;
    try {
      const bootstrapDeviceId = getBootstrapDeviceId();
      const bootstrapLogin = await loginApi({ email, password, device_id: bootstrapDeviceId });
      const payload = decodeJwtPayload(bootstrapLogin.token);
      const customerId = payload?.scope === 'customer' ? payload.sub : undefined;

      if (!customerId) {
        await this.activateToken(bootstrapLogin.token, bootstrapDeviceId);
        return;
      }

      const customerDeviceId = getCustomerDeviceId(customerId);
      const finalLogin = await loginApi({
        email,
        password,
        device_id: customerDeviceId
      }).finally(() => logoutApi(bootstrapLogin.token).catch(() => undefined));

      await this.activateToken(finalLogin.token, customerDeviceId);
    } catch (err: any) {
      Message.error(err?.message || '登录失败');
      throw err;
    } finally {
      this.loading = false;
    }
  }

  async sendOtp(email: string, purpose: OtpPurpose = 'login'): Promise<void> {
    this.sendingOtp = true;
    try {
      await sendOtpApi({ email, purpose });
    } catch (err: any) {
      Message.error(
        err?.message || (purpose === 'reset_password' ? '重置验证码发送失败' : '验证码发送失败')
      );
      throw err;
    } finally {
      this.sendingOtp = false;
    }
  }

  async resetPassword(
    email: string,
    code: string,
    newPassword: string,
    passwordConfirmation: string
  ): Promise<void> {
    this.resettingPassword = true;
    try {
      await resetPasswordApi({
        email,
        code,
        new_password: newPassword,
        password_confirmation: passwordConfirmation
      });
      this.clearLocalSession();
    } catch (err: any) {
      Message.error(err?.message || '密码重置失败');
      throw err;
    } finally {
      this.resettingPassword = false;
    }
  }

  async loginWithOtp(email: string, code: string): Promise<void> {
    this.loading = true;
    try {
      const bootstrapDeviceId = getBootstrapDeviceId();
      const result = await verifyOtpApi({ email, code, device_id: bootstrapDeviceId });
      await this.activateToken(result.token, bootstrapDeviceId);
    } catch (err: any) {
      Message.error(err?.message || '验证码登录失败');
      throw err;
    } finally {
      this.loading = false;
    }
  }

  async changePassword(newPassword: string): Promise<void> {
    const token = getToken();
    if (!token) throw new Error('Missing token');

    this.loading = true;
    try {
      await changePasswordApi(token, { new_password: newPassword });
      const current = await this.fetchMe();
      if (current.status !== 'active' || customerNeedsPasswordSetup(current)) {
        this.clearLocalSession();
        throw new Error('账号尚未完成激活，请使用新密码重新登录');
      }
      this.activateAuthenticatedSession(current);
    } catch (err: any) {
      Message.error(err?.message || '密码设置失败');
      throw err;
    } finally {
      this.loading = false;
    }
  }

  async fetchMe(): Promise<CurrentCustomer> {
    const token = getToken();
    if (!token) {
      throw new Error('Missing token');
    }

    this.checking = true;
    try {
      const me = await this.fetchValidatedCustomer(token);
      this.current = me;
      if (!localStorage.getItem(DEVICE_ID_KEY)) {
        localStorage.setItem(DEVICE_ID_KEY, getCustomerDeviceId(me.id));
      }
      return me;
    } catch (err) {
      if (getToken() === token) {
        this.clearLocalSession();
      }
      throw err;
    } finally {
      this.checking = false;
    }
  }

  async restoreSession(): Promise<CurrentCustomer> {
    const current = await this.fetchMe();
    if (!customerNeedsPasswordSetup(current)) {
      this.activateAuthenticatedSession(current);
    }
    return current;
  }

  clearLocalSession(): void {
    clearToken();
    this.current = null;
  }

  async logout(): Promise<void> {
    if (this.loggingOut) return;

    const token = getToken();
    this.loggingOut = true;
    this.clearLocalSession();
    try {
      const cleanup = [
        () => authEmitter.deactivateSession(),
        () => todoistSyncSessionEmitter.deactivate(),
      ];
      if (token) cleanup.push(() => logoutApi(token));
      scheduleBestEffort(() => settleBestEffort(cleanup), (err) => {
        console.error('[AuthStore] Failed to settle optional logout cleanup:', err);
      });
    } finally {
      this.loggingOut = false;
    }
  }
}

export const authStore = reactive<AuthStore>(new AuthStore());
