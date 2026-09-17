import { createXpcRendererEmitter, xpcRenderer } from 'electron-xpc/renderer';
import type { AuthSessionApi } from '@shared/auth/auth.type';
import {
  HOME_SHELL_AUTH_SNAPSHOT_CHANGED_EVENT,
  parseHomeShellAuthCommandResult,
  parseHomeShellAuthSnapshot,
  parseHomeShellCommandAck,
  parseHomeShellSessionSummary,
  type HomeShellAuthCommandResult,
  type HomeShellAuthSnapshot,
  type HomeShellBridgeApi,
  type HomeShellOtpLoginRequest,
  type HomeShellOtpRequest,
  type HomeShellPasswordChangeRequest,
  type HomeShellPasswordLoginRequest,
  type HomeShellPasswordResetRequest,
  type HomeShellSessionSummary
} from '@shared/home/homeShellBridge.contract';

const homeShellEmitter = createXpcRendererEmitter<HomeShellBridgeApi>('HomeShellBridgeHandler');
const authSessionEmitter = createXpcRendererEmitter<AuthSessionApi>('AuthHandler');
const applicationAuthEmitter = createXpcRendererEmitter<{ invalidate(): Promise<void> }>(
  'ApplicationAuthHandler'
);
const controlEmitter = createXpcRendererEmitter<{ requestLogin(): Promise<void> }>(
  'CoachXpcHandler'
);

const HOME_SHELL_CALL_TIMEOUT_MS = 8_000;
const HOME_SHELL_AUTH_CALL_TIMEOUT_MS = 25_000;

const withHomeShellTimeout = async <T>(
  operation: Promise<T>,
  label: string,
  timeoutMs = HOME_SHELL_CALL_TIMEOUT_MS
): Promise<T> => {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutHandle = setTimeout(
      () => reject(new Error(`${label} timed out while waiting for the Home shell`)),
      timeoutMs
    );
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
  }
};

const runAuthCommand = async (
  operation: Promise<unknown>,
  label: string
): Promise<HomeShellAuthCommandResult> =>
  parseHomeShellAuthCommandResult(
    await withHomeShellTimeout(operation, label, HOME_SHELL_AUTH_CALL_TIMEOUT_MS)
  );

export const homeShellBridge = {
  async requestLogin(): Promise<void> {
    await withHomeShellTimeout(controlEmitter.requestLogin(), 'Show Control login');
  },
  subscribeAuthSnapshot(
    listener: (snapshot: HomeShellAuthSnapshot) => void,
    onInvalidSnapshot: () => void
  ): () => void {
    let active = true;
    let reading = false;
    let queued = false;
    const refresh = async (): Promise<void> => {
      if (!active) return;
      if (reading) {
        queued = true;
        return;
      }
      reading = true;
      try {
        // Broadcasts have no sender identity. Only the addressed authority can supply state.
        const snapshot = await homeShellBridge.getAuthSnapshot(500);
        if (active) listener(snapshot);
      } catch {
        if (active) onInvalidSnapshot();
      } finally {
        reading = false;
        if (active && queued) {
          queued = false;
          void refresh();
        }
      }
    };
    xpcRenderer.subscribe(HOME_SHELL_AUTH_SNAPSHOT_CHANGED_EVENT, () => void refresh());
    return () => {
      active = false;
      queued = false;
    };
  },

  async getAuthSnapshot(timeoutMs = HOME_SHELL_CALL_TIMEOUT_MS): Promise<HomeShellAuthSnapshot> {
    const value = await withHomeShellTimeout(
      homeShellEmitter.getAuthSnapshot(),
      'Auth snapshot',
      timeoutMs
    );
    return parseHomeShellAuthSnapshot(value);
  },

  async restoreAuthSession(): Promise<HomeShellAuthCommandResult> {
    return await runAuthCommand(homeShellEmitter.restoreAuthSession(), 'Restore auth session');
  },

  async cancelAuthSessionRecovery(): Promise<HomeShellAuthCommandResult> {
    return await runAuthCommand(
      homeShellEmitter.cancelAuthSessionRecovery(),
      'Cancel auth session recovery'
    );
  },

  async loginWithPassword(
    request: HomeShellPasswordLoginRequest
  ): Promise<HomeShellAuthCommandResult> {
    return await runAuthCommand(homeShellEmitter.loginWithPassword(request), 'Password login');
  },

  async sendOtp(request: HomeShellOtpRequest): Promise<HomeShellAuthCommandResult> {
    return await runAuthCommand(homeShellEmitter.sendOtp(request), 'Send auth OTP');
  },

  async loginWithOtp(request: HomeShellOtpLoginRequest): Promise<HomeShellAuthCommandResult> {
    return await runAuthCommand(homeShellEmitter.loginWithOtp(request), 'OTP login');
  },

  async resetPassword(request: HomeShellPasswordResetRequest): Promise<HomeShellAuthCommandResult> {
    return await runAuthCommand(homeShellEmitter.resetPassword(request), 'Reset password');
  },

  async changePassword(
    request: HomeShellPasswordChangeRequest
  ): Promise<HomeShellAuthCommandResult> {
    return await runAuthCommand(homeShellEmitter.changePassword(request), 'Change password');
  },

  async discardPersistedSession(): Promise<HomeShellAuthCommandResult> {
    return await runAuthCommand(
      homeShellEmitter.discardPersistedSession(),
      'Discard persisted session'
    );
  },

  async getSessionSummary(): Promise<HomeShellSessionSummary> {
    const value = await withHomeShellTimeout(
      homeShellEmitter.getSessionSummary(),
      'Session summary'
    );
    return parseHomeShellSessionSummary(value);
  },

  async openTodo(): Promise<void> {
    const snapshot = await homeShellBridge.getAuthSnapshot();
    if (snapshot.phase !== 'ready' || snapshot.loggingOut) {
      await homeShellBridge.requestLogin();
      return;
    }
    const value = await withHomeShellTimeout(homeShellEmitter.openTodo(), 'Open Todo');
    parseHomeShellCommandAck(value);
  },

  async logout(): Promise<void> {
    await withHomeShellTimeout(applicationAuthEmitter.invalidate(), 'Invalidate chat session');
    const value = await withHomeShellTimeout(homeShellEmitter.prepareLogout(), 'Prepare logout');
    parseHomeShellCommandAck(value);

    // Deactivation closes protected business renderers but retains browsing and Control.
    // Dispatch only after Home acknowledged local cleanup; do not await the caller's destruction.
    void authSessionEmitter.deactivateSession().catch((err) => {
      console.warn('[HomeShellBridge] Failed to request session deactivation:', err);
    });
  }
};
