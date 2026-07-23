import { markRaw, reactive } from 'vue';
import { Message } from '@arco-design/web-vue';
import { authEmitter } from '@/emitter/auth.emitter';
import { scheduleBestEffort, settleBestEffort } from '@/stores/auth/authSession.service';
import { todoistSyncSessionEmitter } from '@/stores/auth/todoistSyncSession.emitter';
import { TodoistSyncActivationService } from '@/stores/auth/todoistSyncActivation.service';
import type { TodoistSyncActivateParams } from '@shared/todoistSync/todoistSync.type';
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
const DEVICE_ID_KEY = 'bitterless-desktop-device-id';

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

const getOrCreateDeviceId = (): string => {
  const existingDeviceId = localStorage.getItem(DEVICE_ID_KEY);
  if (existingDeviceId !== null) return existingDeviceId;

  const deviceId = createRandomHex32();
  localStorage.setItem(DEVICE_ID_KEY, deviceId);
  return deviceId;
};

const getTodoistSyncActivateParams = (
  current: CurrentCustomer,
  coreToken: string | null,
  deviceId: string,
): TodoistSyncActivateParams => {
  if (!coreToken || !deviceId) {
    throw new Error('Todo sync activation is missing the Core token or device ID');
  }
  return { coreToken, customerId: current.id, deviceId };
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

class AuthStore {
  current: CurrentCustomer | null = null;
  loading = false;
  loggingOut = false;
  sendingOtp = false;
  resettingPassword = false;
  checking = false;
  private readonly installationDeviceId = getOrCreateDeviceId();
  private readonly todoistSyncActivation = markRaw(new TodoistSyncActivationService(
    async (params) => await todoistSyncSessionEmitter.activate(params),
  ));

  isAuthenticated(): boolean {
    return !!getToken();
  }

  get token(): string | null {
    return getToken();
  }

  get deviceId(): string {
    return this.installationDeviceId;
  }

  private async fetchValidatedCustomer(token: string): Promise<CurrentCustomer> {
    return ensureSessionEligibleCustomer(await meApi(token));
  }

  async ensureTodoistSyncReady(): Promise<void> {
    const current = this.current;
    if (!current) throw new Error('Todo runtime requires an authenticated customer');
    ensureSessionEligibleCustomer(current);
    if (current.status !== 'active' || customerNeedsPasswordSetup(current)) {
      throw new Error('账号尚未完成首次密码设置');
    }
    const params = getTodoistSyncActivateParams(current, getToken(), this.deviceId);
    await this.todoistSyncActivation.ensureReady(params);
  }

  onTodoistSyncRuntimeRegistered(targetId: string): void {
    if (!this.todoistSyncActivation.registerRuntimeTarget(targetId)) return;

    const current = this.current;
    if (
      !current ||
      current.status !== 'active' ||
      customerNeedsPasswordSetup(current)
    ) {
      return;
    }
    this.activateTodoistSync(current);
  }

  private activateTodoistSync(current: CurrentCustomer): void {
    let params: TodoistSyncActivateParams;
    try {
      params = getTodoistSyncActivateParams(current, getToken(), this.deviceId);
    } catch (error) {
      console.error('[AuthStore] Failed to prepare Todo sync activation:', error);
      return;
    }
    const activation = this.todoistSyncActivation.start(params);
    scheduleBestEffort(
      () => activation,
      (err) => {
        console.error('[AuthStore] Failed to activate Todo sync:', err);
      },
    );
  }

  private activateAuthenticatedSession(current: CurrentCustomer): void {
    ensureSessionEligibleCustomer(current);
    if (current.status !== 'active' || customerNeedsPasswordSetup(current)) {
      throw new Error('账号尚未完成首次密码设置');
    }

    scheduleBestEffort(() => authEmitter.activateSession(), (err) => {
      console.error('[AuthStore] Failed to activate optional authenticated runtimes:', err);
    });
    this.activateTodoistSync(current);
  }

  private async activateToken(token: string): Promise<CurrentCustomer> {
    let current: CurrentCustomer;
    try {
      current = await this.fetchValidatedCustomer(token);
    } catch (err) {
      this.clearLocalSession();
      await logoutApi(token).catch(() => undefined);
      throw err;
    }

    this.todoistSyncActivation.invalidate();
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
      const result = await loginApi({
        email,
        password,
        device_id: this.deviceId
      });
      await this.activateToken(result.token);
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
      const result = await verifyOtpApi({ email, code, device_id: this.deviceId });
      await this.activateToken(result.token);
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
    this.todoistSyncActivation.invalidate();
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
