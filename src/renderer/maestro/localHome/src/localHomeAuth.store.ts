import { reactive } from 'vue';
import { homeShellBridge } from '@renderer/common/homeShellBridge.client';
import type {
  HomeShellAuthCommandResult,
  HomeShellAuthSnapshot
} from '@shared/home/homeShellBridge.contract';
import {
  HOME_SHELL_INITIAL_AUTH_PROBE,
  isHomeShellAuthSnapshotNewer
} from '@shared/home/homeShellBridge.contract';
import type {
  LoginSurfaceAuthController,
  LoginSurfaceCustomer
} from '@/views/login/loginSurface.type';

const wait = async (durationMs: number): Promise<void> => {
  await new Promise<void>((resolve) => setTimeout(resolve, durationMs));
};

const getConsumerAbortError = (signal: AbortSignal): Error =>
  signal.reason instanceof Error ? signal.reason : new Error('请求已取消');

const waitForConsumer = async <T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> => {
  if (!signal) return await operation;
  if (signal.aborted) throw getConsumerAbortError(signal);

  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(getConsumerAbortError(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
  try {
    return await Promise.race([operation, aborted]);
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort);
  }
};

class LocalHomeAuthStore implements LoginSurfaceAuthController {
  snapshot: HomeShellAuthSnapshot | null = null;
  initializing = true;
  authorityUnavailable = false;
  private initialized = false;
  private refreshGeneration = 0;
  private latestAcceptedSnapshot: HomeShellAuthSnapshot | null = null;

  get current(): LoginSurfaceCustomer | null {
    if (!this.snapshot?.email) return null;
    if (this.snapshot.phase === 'ready') {
      return {
        email: this.snapshot.email,
        status: 'active',
        has_password: true,
        must_set_password: false
      };
    }
    if (this.snapshot.phase === 'password-setup') {
      return {
        email: this.snapshot.email,
        status: 'invited',
        has_password: false,
        must_set_password: true
      };
    }
    return null;
  }

  get loading(): boolean {
    return this.snapshot?.loading ?? false;
  }

  get loggingOut(): boolean {
    return this.snapshot?.loggingOut ?? false;
  }

  get sendingOtp(): boolean {
    return this.snapshot?.sendingOtp ?? false;
  }

  get resettingPassword(): boolean {
    return this.snapshot?.resettingPassword ?? false;
  }

  get checking(): boolean {
    return this.snapshot?.phase === 'restoring';
  }

  get ready(): boolean {
    return this.snapshot?.phase === 'ready';
  }

  get authResolved(): boolean {
    return Boolean(this.snapshot && this.snapshot.phase !== 'unknown');
  }

  readonly defaultRedirect = '/mini-app';
  readonly handlesOperationErrors = false;
  readonly handlesPostAuthNavigation = false;

  initialize(): void {
    if (this.initialized) return;
    this.initialized = true;
    homeShellBridge.subscribeAuthSnapshot(
      (snapshot) => this.applySnapshot(snapshot),
      () => this.handleInvalidSnapshot()
    );
    void this.refreshAuthSnapshot();
  }

  async refreshAuthSnapshot(): Promise<void> {
    const generation = ++this.refreshGeneration;
    this.initializing = true;
    this.authorityUnavailable = false;

    for (let attempt = 0; attempt < HOME_SHELL_INITIAL_AUTH_PROBE.attempts; attempt += 1) {
      try {
        const snapshot = await homeShellBridge.getAuthSnapshot(
          HOME_SHELL_INITIAL_AUTH_PROBE.timeoutMs
        );
        if (generation !== this.refreshGeneration) return;
        const accepted = this.applySnapshot(snapshot);
        if (accepted || this.snapshot) return;
      } catch {
        if (generation !== this.refreshGeneration || this.snapshot) return;
      }
      if (attempt + 1 < HOME_SHELL_INITIAL_AUTH_PROBE.attempts) {
        await wait(HOME_SHELL_INITIAL_AUTH_PROBE.retryDelayMs);
      }
    }

    if (generation !== this.refreshGeneration || this.snapshot) return;
    this.initializing = false;
    this.authorityUnavailable = true;
  }

  isAuthenticated(): boolean {
    return Boolean(
      this.snapshot && this.snapshot.phase !== 'unknown' && this.snapshot.phase !== 'signed-out'
    );
  }

  prepareSurface(): Promise<void> {
    return Promise.resolve();
  }

  async restoreSession(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw getConsumerAbortError(signal);
    await waitForConsumer(this.runCommand(homeShellBridge.restoreAuthSession()), signal);
  }

  async cancelSessionRecovery(): Promise<void> {
    await this.runCommand(homeShellBridge.cancelAuthSessionRecovery());
  }

  async clearLocalSession(): Promise<void> {
    await this.runCommand(homeShellBridge.discardPersistedSession());
  }

  async logout(): Promise<void> {
    await this.clearLocalSession();
  }

  async loginWithPassword(email: string, password: string): Promise<void> {
    await this.runCommand(homeShellBridge.loginWithPassword({ email, password }));
  }

  async sendOtp(email: string, purpose: 'login' | 'reset_password' = 'login'): Promise<void> {
    await this.runCommand(homeShellBridge.sendOtp({ email, purpose }));
  }

  async resetPassword(
    email: string,
    code: string,
    newPassword: string,
    passwordConfirmation: string
  ): Promise<void> {
    await this.runCommand(
      homeShellBridge.resetPassword({
        email,
        code,
        newPassword,
        passwordConfirmation
      })
    );
  }

  async loginWithOtp(email: string, code: string): Promise<void> {
    await this.runCommand(homeShellBridge.loginWithOtp({ email, code }));
  }

  async changePassword(newPassword: string): Promise<void> {
    await this.runCommand(homeShellBridge.changePassword({ newPassword }));
  }

  private applySnapshot(snapshot: HomeShellAuthSnapshot): boolean {
    if (!isHomeShellAuthSnapshotNewer(snapshot, this.latestAcceptedSnapshot)) return false;
    this.latestAcceptedSnapshot = snapshot;
    this.snapshot = snapshot;
    this.initializing = false;
    this.authorityUnavailable = false;
    return true;
  }

  private handleInvalidSnapshot(): void {
    this.snapshot = null;
    this.initializing = true;
    this.authorityUnavailable = false;
    void this.refreshAuthSnapshot();
  }

  private applyResultWithoutThrow(result: HomeShellAuthCommandResult): boolean {
    return this.applySnapshot(result.snapshot);
  }

  private async runCommand(operation: Promise<HomeShellAuthCommandResult>): Promise<void> {
    const result = await operation;
    const accepted = this.applyResultWithoutThrow(result);
    if (accepted && !result.ok) throw new Error(result.error.message);
  }
}

export const localHomeAuthStore = reactive<LocalHomeAuthStore>(new LocalHomeAuthStore());
