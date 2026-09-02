export const HOME_SHELL_AUTH_SNAPSHOT_CHANGED_EVENT = 'home-shell/auth-snapshot-changed';

export type HomeShellAuthPhase =
  | 'unknown'
  | 'signed-out'
  | 'saved-session'
  | 'restoring'
  | 'password-setup'
  | 'ready';

export interface HomeShellAuthSnapshot {
  authorityEpoch: number;
  revision: number;
  phase: HomeShellAuthPhase;
  email: string | null;
  loading: boolean;
  loggingOut: boolean;
  sendingOtp: boolean;
  resettingPassword: boolean;
}

export const HOME_SHELL_INITIAL_AUTH_PROBE = {
  attempts: 6,
  timeoutMs: 500,
  retryDelayMs: 250
} as const;

export const getHomeShellInitialAuthProbeUpperBoundMs = (): number =>
  HOME_SHELL_INITIAL_AUTH_PROBE.attempts * HOME_SHELL_INITIAL_AUTH_PROBE.timeoutMs +
  (HOME_SHELL_INITIAL_AUTH_PROBE.attempts - 1) * HOME_SHELL_INITIAL_AUTH_PROBE.retryDelayMs;

export type HomeShellAuthErrorCode = 'invalid-request' | 'cancelled' | 'auth-failed';

export const HOME_SHELL_AUTH_ERROR_MESSAGES = {
  invalidRequest: '认证请求无效，请检查后重试',
  cancelled: '登录状态验证已取消',
  credentialsRejected: '邮箱、密码或验证码不正确',
  forbidden: '账号无权执行此操作',
  invalidState: '账号状态无效，请联系管理员',
  rateLimited: '操作过于频繁，请稍后重试',
  timeout: '请求超时，请重试',
  unavailable: 'Bitterless 服务暂时不可用，请稍后重试',
  invalidResponse: '认证服务响应无效，请重试',
  failed: '认证操作失败，请重试'
} as const;

export type HomeShellAuthErrorMessage =
  (typeof HOME_SHELL_AUTH_ERROR_MESSAGES)[keyof typeof HOME_SHELL_AUTH_ERROR_MESSAGES];

export interface HomeShellAuthCommandError {
  code: HomeShellAuthErrorCode;
  message: HomeShellAuthErrorMessage;
}

export interface HomeShellAuthCommandSuccess {
  ok: true;
  snapshot: HomeShellAuthSnapshot;
}

export interface HomeShellAuthCommandFailure {
  ok: false;
  snapshot: HomeShellAuthSnapshot;
  error: HomeShellAuthCommandError;
}

export type HomeShellAuthCommandResult = HomeShellAuthCommandSuccess | HomeShellAuthCommandFailure;

export interface HomeShellPasswordLoginRequest {
  email: string;
  password: string;
}

export interface HomeShellOtpRequest {
  email: string;
  purpose: 'login' | 'reset_password';
}

export interface HomeShellOtpLoginRequest {
  email: string;
  code: string;
}

export interface HomeShellPasswordResetRequest {
  email: string;
  code: string;
  newPassword: string;
  passwordConfirmation: string;
}

export interface HomeShellPasswordChangeRequest {
  newPassword: string;
}

export interface HomeShellSessionSummary {
  email: string;
}

export interface HomeShellCommandAck {
  ok: true;
}

export interface HomeShellBridgeApi {
  getAuthSnapshot(): Promise<HomeShellAuthSnapshot>;
  restoreAuthSession(): Promise<HomeShellAuthCommandResult>;
  cancelAuthSessionRecovery(): Promise<HomeShellAuthCommandResult>;
  loginWithPassword(request: HomeShellPasswordLoginRequest): Promise<HomeShellAuthCommandResult>;
  sendOtp(request: HomeShellOtpRequest): Promise<HomeShellAuthCommandResult>;
  loginWithOtp(request: HomeShellOtpLoginRequest): Promise<HomeShellAuthCommandResult>;
  resetPassword(request: HomeShellPasswordResetRequest): Promise<HomeShellAuthCommandResult>;
  changePassword(request: HomeShellPasswordChangeRequest): Promise<HomeShellAuthCommandResult>;
  discardPersistedSession(): Promise<HomeShellAuthCommandResult>;
  getSessionSummary(): Promise<HomeShellSessionSummary>;
  openTodo(): Promise<HomeShellCommandAck>;
  prepareLogout(): Promise<HomeShellCommandAck>;
}

const AUTH_PHASES: ReadonlySet<HomeShellAuthPhase> = new Set([
  'unknown',
  'signed-out',
  'saved-session',
  'restoring',
  'password-setup',
  'ready'
]);

const AUTH_ERROR_CODES: ReadonlySet<HomeShellAuthErrorCode> = new Set([
  'invalid-request',
  'cancelled',
  'auth-failed'
]);

const AUTH_ERROR_MESSAGES: ReadonlySet<HomeShellAuthErrorMessage> = new Set(
  Object.values(HOME_SHELL_AUTH_ERROR_MESSAGES)
);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const hasExactKeys = (value: Record<string, unknown>, keys: string[]): boolean => {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
};

const parseNonEmptyString = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Home shell ${label} must be a non-empty string`);
  }
  return value;
};

export const parseHomeShellAuthSnapshot = (value: unknown): HomeShellAuthSnapshot => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'authorityEpoch',
      'revision',
      'phase',
      'email',
      'loading',
      'loggingOut',
      'sendingOtp',
      'resettingPassword'
    ]) ||
    typeof value.authorityEpoch !== 'number' ||
    !Number.isSafeInteger(value.authorityEpoch) ||
    value.authorityEpoch <= 0 ||
    typeof value.revision !== 'number' ||
    !Number.isSafeInteger(value.revision) ||
    value.revision <= 0 ||
    typeof value.phase !== 'string' ||
    !AUTH_PHASES.has(value.phase as HomeShellAuthPhase) ||
    (value.email !== null && typeof value.email !== 'string') ||
    (typeof value.email === 'string' && value.email.trim().length === 0) ||
    ((value.phase === 'ready' || value.phase === 'password-setup') &&
      (typeof value.email !== 'string' || value.email.trim().length === 0)) ||
    ((value.phase === 'unknown' ||
      value.phase === 'signed-out' ||
      value.phase === 'saved-session') &&
      value.email !== null) ||
    typeof value.loading !== 'boolean' ||
    typeof value.loggingOut !== 'boolean' ||
    typeof value.sendingOtp !== 'boolean' ||
    typeof value.resettingPassword !== 'boolean'
  ) {
    throw new Error('Home shell returned an invalid auth snapshot');
  }

  return {
    authorityEpoch: value.authorityEpoch,
    revision: value.revision,
    phase: value.phase as HomeShellAuthPhase,
    email: value.email as string | null,
    loading: value.loading,
    loggingOut: value.loggingOut,
    sendingOtp: value.sendingOtp,
    resettingPassword: value.resettingPassword
  };
};

export const isHomeShellAuthSnapshotNewer = (
  candidate: HomeShellAuthSnapshot,
  current: HomeShellAuthSnapshot | null
): boolean =>
  current === null ||
  candidate.authorityEpoch > current.authorityEpoch ||
  (candidate.authorityEpoch === current.authorityEpoch && candidate.revision > current.revision);

export const parseHomeShellAuthCommandResult = (value: unknown): HomeShellAuthCommandResult => {
  if (!isRecord(value) || typeof value.ok !== 'boolean') {
    throw new Error('Home shell returned an invalid auth command result');
  }

  if (value.ok) {
    if (!hasExactKeys(value, ['ok', 'snapshot'])) {
      throw new Error('Home shell returned an invalid auth command result');
    }
    return { ok: true, snapshot: parseHomeShellAuthSnapshot(value.snapshot) };
  }

  if (!hasExactKeys(value, ['ok', 'snapshot', 'error']) || !isRecord(value.error)) {
    throw new Error('Home shell returned an invalid auth command result');
  }
  if (
    !hasExactKeys(value.error, ['code', 'message']) ||
    typeof value.error.code !== 'string' ||
    !AUTH_ERROR_CODES.has(value.error.code as HomeShellAuthErrorCode) ||
    typeof value.error.message !== 'string' ||
    !AUTH_ERROR_MESSAGES.has(value.error.message as HomeShellAuthErrorMessage)
  ) {
    throw new Error('Home shell returned an invalid auth command error');
  }

  return {
    ok: false,
    snapshot: parseHomeShellAuthSnapshot(value.snapshot),
    error: {
      code: value.error.code as HomeShellAuthErrorCode,
      message: value.error.message as HomeShellAuthErrorMessage
    }
  };
};

export const parseHomeShellPasswordLoginRequest = (
  value: unknown
): HomeShellPasswordLoginRequest => {
  if (!isRecord(value) || !hasExactKeys(value, ['email', 'password'])) {
    throw new Error('Invalid password login request');
  }
  return {
    email: parseNonEmptyString(value.email, 'email').trim(),
    password: parseNonEmptyString(value.password, 'password')
  };
};

export const parseHomeShellOtpRequest = (value: unknown): HomeShellOtpRequest => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['email', 'purpose']) ||
    (value.purpose !== 'login' && value.purpose !== 'reset_password')
  ) {
    throw new Error('Invalid OTP request');
  }
  return {
    email: parseNonEmptyString(value.email, 'email').trim(),
    purpose: value.purpose
  };
};

export const parseHomeShellOtpLoginRequest = (value: unknown): HomeShellOtpLoginRequest => {
  if (!isRecord(value) || !hasExactKeys(value, ['email', 'code'])) {
    throw new Error('Invalid OTP login request');
  }
  return {
    email: parseNonEmptyString(value.email, 'email').trim(),
    code: parseNonEmptyString(value.code, 'OTP code').trim()
  };
};

export const parseHomeShellPasswordResetRequest = (
  value: unknown
): HomeShellPasswordResetRequest => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['email', 'code', 'newPassword', 'passwordConfirmation'])
  ) {
    throw new Error('Invalid password reset request');
  }
  return {
    email: parseNonEmptyString(value.email, 'email').trim(),
    code: parseNonEmptyString(value.code, 'OTP code').trim(),
    newPassword: parseNonEmptyString(value.newPassword, 'new password'),
    passwordConfirmation: parseNonEmptyString(value.passwordConfirmation, 'password confirmation')
  };
};

export const parseHomeShellPasswordChangeRequest = (
  value: unknown
): HomeShellPasswordChangeRequest => {
  if (!isRecord(value) || !hasExactKeys(value, ['newPassword'])) {
    throw new Error('Invalid password change request');
  }
  return { newPassword: parseNonEmptyString(value.newPassword, 'new password') };
};

export const parseHomeShellSessionSummary = (value: unknown): HomeShellSessionSummary => {
  if (!isRecord(value) || !hasExactKeys(value, ['email']) || typeof value.email !== 'string') {
    throw new Error('Home shell returned an invalid session summary');
  }
  return { email: value.email };
};

export const parseHomeShellCommandAck = (value: unknown): HomeShellCommandAck => {
  if (!isRecord(value) || !hasExactKeys(value, ['ok']) || value.ok !== true) {
    throw new Error('Home shell command was not acknowledged');
  }
  return { ok: true };
};
