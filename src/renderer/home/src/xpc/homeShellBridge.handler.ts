import { watch } from 'vue';
import { XpcRendererHandler, xpcRenderer } from 'electron-xpc/renderer';
import type {
  HomeShellAuthCommandFailure,
  HomeShellAuthCommandResult,
  HomeShellAuthErrorCode,
  HomeShellAuthErrorMessage,
  HomeShellAuthSnapshot,
  HomeShellBridgeApi,
  HomeShellCommandAck,
  HomeShellOtpLoginRequest,
  HomeShellOtpRequest,
  HomeShellPasswordChangeRequest,
  HomeShellPasswordLoginRequest,
  HomeShellPasswordResetRequest,
  HomeShellSessionSummary
} from '@shared/home/homeShellBridge.contract';
import {
  HOME_SHELL_AUTH_ERROR_MESSAGES,
  HOME_SHELL_AUTH_SNAPSHOT_CHANGED_EVENT,
  parseHomeShellOtpLoginRequest,
  parseHomeShellOtpRequest,
  parseHomeShellPasswordChangeRequest,
  parseHomeShellPasswordLoginRequest,
  parseHomeShellPasswordResetRequest
} from '@shared/home/homeShellBridge.contract';
import router from '@/router';
import { todoWindowEmitter } from '@/emitter/todoWindow.emitter';
import { authStore, customerNeedsPasswordSetup } from '@/stores/auth/auth.store';
import {
  AuthHttpError,
  AuthRequestTimeoutError,
  SessionEligibilityError,
  SessionPayloadError
} from '@/stores/auth/authSession.service';
import {
  cancelCustomerSessionRecovery,
  restoreCustomerSession
} from '@/stores/auth/authSessionRecovery.service';
import { customerAuthPresentationRevision } from '@/stores/auth/authToken.service';

const HOME_SHELL_AUTHORITY_EPOCH_KEY = 'bitterless-home-shell-authority-epoch';

const allocateAuthorityEpoch = (): number => {
  let previousEpoch = 0;
  try {
    const previousValue = Number.parseInt(
      localStorage.getItem(HOME_SHELL_AUTHORITY_EPOCH_KEY) || '',
      10
    );
    previousEpoch = Number.isSafeInteger(previousValue) && previousValue > 0 ? previousValue : 0;
  } catch {
    // Date.now still gives a comparable epoch when storage is temporarily unavailable.
  }
  const epoch = Math.max(Date.now(), previousEpoch + 1);
  try {
    localStorage.setItem(HOME_SHELL_AUTHORITY_EPOCH_KEY, String(epoch));
  } catch {
    // A later authoritative read remains fail-closed even without persisted epoch storage.
  }
  return epoch;
};

const authorityEpoch = allocateAuthorityEpoch();
let authSnapshotRevision = 0;

const readAuthPhase = (): HomeShellAuthSnapshot['phase'] => {
  if (!authStore.isAuthenticated()) return 'signed-out';

  let phase: HomeShellAuthSnapshot['phase'] = 'saved-session';
  if (authStore.checking) {
    phase = 'restoring';
  } else if (customerNeedsPasswordSetup(authStore.current)) {
    phase = 'password-setup';
  } else if (authStore.current?.status === 'active') {
    phase = 'ready';
  }
  return phase;
};

const captureAuthSnapshot = (): HomeShellAuthSnapshot => {
  const phase = readAuthPhase();
  return {
    authorityEpoch,
    revision: ++authSnapshotRevision,
    phase,
    email:
      phase === 'ready' || phase === 'password-setup' ? authStore.current?.email || null : null,
    loading: authStore.loading,
    loggingOut: authStore.loggingOut,
    sendingOtp: authStore.sendingOtp,
    resettingPassword: authStore.resettingPassword
  };
};

const isCancellationError = (error: unknown): boolean =>
  (error instanceof DOMException && error.name === 'AbortError') ||
  (error instanceof Error && /取消|cancel|abort/i.test(error.message));

const getSafeAuthErrorMessage = (
  code: HomeShellAuthErrorCode,
  error: unknown
): HomeShellAuthErrorMessage => {
  if (code === 'invalid-request') return HOME_SHELL_AUTH_ERROR_MESSAGES.invalidRequest;
  if (code === 'cancelled') return HOME_SHELL_AUTH_ERROR_MESSAGES.cancelled;
  if (error instanceof AuthRequestTimeoutError) return HOME_SHELL_AUTH_ERROR_MESSAGES.timeout;
  if (error instanceof SessionEligibilityError) return HOME_SHELL_AUTH_ERROR_MESSAGES.invalidState;
  if (error instanceof SessionPayloadError) return HOME_SHELL_AUTH_ERROR_MESSAGES.invalidResponse;
  if (error instanceof AuthHttpError) {
    if (error.status === 403) return HOME_SHELL_AUTH_ERROR_MESSAGES.forbidden;
    if (error.status === 409) return HOME_SHELL_AUTH_ERROR_MESSAGES.invalidState;
    if (error.status === 429) return HOME_SHELL_AUTH_ERROR_MESSAGES.rateLimited;
    if (error.status >= 500) return HOME_SHELL_AUTH_ERROR_MESSAGES.unavailable;
    if ([400, 401, 404, 422].includes(error.status)) {
      return HOME_SHELL_AUTH_ERROR_MESSAGES.credentialsRejected;
    }
  }
  return HOME_SHELL_AUTH_ERROR_MESSAGES.failed;
};

class HomeShellBridgeHandler extends XpcRendererHandler implements HomeShellBridgeApi {
  async getAuthSnapshot(): Promise<HomeShellAuthSnapshot> {
    return captureAuthSnapshot();
  }

  async restoreAuthSession(): Promise<HomeShellAuthCommandResult> {
    return await this._runAuthCommand(async () => {
      await restoreCustomerSession();
    });
  }

  async cancelAuthSessionRecovery(): Promise<HomeShellAuthCommandResult> {
    cancelCustomerSessionRecovery();
    return { ok: true, snapshot: captureAuthSnapshot() };
  }

  async loginWithPassword(
    value: HomeShellPasswordLoginRequest
  ): Promise<HomeShellAuthCommandResult> {
    let request: HomeShellPasswordLoginRequest;
    try {
      request = parseHomeShellPasswordLoginRequest(value);
    } catch (error) {
      return this._failure('invalid-request', error);
    }
    return await this._runAuthCommand(async () => {
      await authStore.loginWithPassword(request.email, request.password);
    });
  }

  async sendOtp(value: HomeShellOtpRequest): Promise<HomeShellAuthCommandResult> {
    let request: HomeShellOtpRequest;
    try {
      request = parseHomeShellOtpRequest(value);
    } catch (error) {
      return this._failure('invalid-request', error);
    }
    return await this._runAuthCommand(async () => {
      await authStore.sendOtp(request.email, request.purpose);
    });
  }

  async loginWithOtp(value: HomeShellOtpLoginRequest): Promise<HomeShellAuthCommandResult> {
    let request: HomeShellOtpLoginRequest;
    try {
      request = parseHomeShellOtpLoginRequest(value);
    } catch (error) {
      return this._failure('invalid-request', error);
    }
    return await this._runAuthCommand(async () => {
      await authStore.loginWithOtp(request.email, request.code);
    });
  }

  async resetPassword(value: HomeShellPasswordResetRequest): Promise<HomeShellAuthCommandResult> {
    let request: HomeShellPasswordResetRequest;
    try {
      request = parseHomeShellPasswordResetRequest(value);
    } catch (error) {
      return this._failure('invalid-request', error);
    }
    return await this._runAuthCommand(async () => {
      await authStore.resetPassword(
        request.email,
        request.code,
        request.newPassword,
        request.passwordConfirmation
      );
    });
  }

  async changePassword(value: HomeShellPasswordChangeRequest): Promise<HomeShellAuthCommandResult> {
    let request: HomeShellPasswordChangeRequest;
    try {
      request = parseHomeShellPasswordChangeRequest(value);
    } catch (error) {
      return this._failure('invalid-request', error);
    }
    return await this._runAuthCommand(async () => {
      await authStore.changePassword(request.newPassword);
    });
  }

  async discardPersistedSession(): Promise<HomeShellAuthCommandResult> {
    return await this._runAuthCommand(async () => {
      await authStore.logout();
    });
  }

  async getSessionSummary(): Promise<HomeShellSessionSummary> {
    return { email: authStore.current?.email || '' };
  }

  async openTodo(): Promise<HomeShellCommandAck> {
    await authStore.ensureTodoistSyncReady();
    await todoWindowEmitter.openTodoWindow();
    return { ok: true };
  }

  async prepareLogout(): Promise<HomeShellCommandAck> {
    const cleanup = authStore.prepareExternalLogout();
    await router.replace({ name: 'login' }).catch(() => undefined);
    void cleanup().catch((err) => {
      console.error('[HomeShellBridge] Deferred logout cleanup failed:', err);
    });
    return { ok: true };
  }

  private async _runAuthCommand(
    operation: () => Promise<void>
  ): Promise<HomeShellAuthCommandResult> {
    try {
      await operation();
      await this._syncHiddenRoute();
      return { ok: true, snapshot: captureAuthSnapshot() };
    } catch (error) {
      return this._failure(isCancellationError(error) ? 'cancelled' : 'auth-failed', error);
    }
  }

  private _failure(code: HomeShellAuthErrorCode, error: unknown): HomeShellAuthCommandFailure {
    return {
      ok: false,
      snapshot: captureAuthSnapshot(),
      error: { code, message: getSafeAuthErrorMessage(code, error) }
    };
  }

  private async _syncHiddenRoute(): Promise<void> {
    const routeName = readAuthPhase() === 'ready' ? 'chat' : 'login';
    if (router.currentRoute.value.name === routeName) return;
    await router.replace({ name: routeName }).catch(() => undefined);
  }
}

let handler: HomeShellBridgeHandler | null = null;
let authSnapshotWatcherInitialized = false;

const broadcastAuthSnapshot = (): void => {
  xpcRenderer.broadcast(HOME_SHELL_AUTH_SNAPSHOT_CHANGED_EVENT, captureAuthSnapshot());
};

export const initHomeShellBridge = (): void => {
  handler ??= new HomeShellBridgeHandler();
  if (authSnapshotWatcherInitialized) return;
  authSnapshotWatcherInitialized = true;
  watch(
    () => [
      authStore.current,
      authStore.loading,
      authStore.loggingOut,
      authStore.sendingOtp,
      authStore.resettingPassword,
      authStore.checking,
      customerAuthPresentationRevision.value
    ],
    broadcastAuthSnapshot,
    { immediate: true, flush: 'sync' }
  );
};
