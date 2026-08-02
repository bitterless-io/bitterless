export type BestEffortOperation = () => Promise<unknown>;

export class AuthHttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'AuthHttpError';
    this.status = status;
  }
}

export class SessionEligibilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionEligibilityError';
  }
}

export class SessionPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionPayloadError';
  }
}

export class AuthRequestTimeoutError extends Error {
  constructor(message = '请求超时，请重试') {
    super(message);
    this.name = 'AuthRequestTimeoutError';
  }
}

export type AbortableAuthOperation<T> = (signal: AbortSignal) => Promise<T>;

export const runWithAuthRequestTimeout = async <T>(
  operation: AbortableAuthOperation<T>,
  timeoutMs: number,
  externalSignal?: AbortSignal | null,
): Promise<T> => {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('Auth request timeout must be a positive number');
  }

  const controller = new AbortController();
  const forwardAbort = (): void => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) {
    forwardAbort();
  } else {
    externalSignal?.addEventListener('abort', forwardAbort, { once: true });
  }

  const timeoutError = new AuthRequestTimeoutError();
  let timedOut = false;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      controller.abort(timeoutError);
      reject(timeoutError);
    }, timeoutMs);
  });

  try {
    if (controller.signal.aborted) {
      const reason = controller.signal.reason;
      throw reason instanceof Error ? reason : new Error('请求已取消');
    }
    return await Promise.race([operation(controller.signal), timeout]);
  } catch (error) {
    if (timedOut) throw timeoutError;
    throw error;
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
    externalSignal?.removeEventListener('abort', forwardAbort);
  }
};

export const shouldApplyAuthInvalidation = (
  currentSessionId: string | null | undefined,
  invalidatedSessionId: string | null | undefined,
): boolean =>
  !!currentSessionId &&
  !!invalidatedSessionId &&
  currentSessionId === invalidatedSessionId;

export interface CustomerAuthResult {
  token: string;
  scope: 'customer';
  email: string;
}

export const parseCustomerAuthResult = (value: unknown): CustomerAuthResult => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new SessionPayloadError('登录响应无效，请重试');
  }

  const payload = value as Record<string, unknown>;
  const token = payload.token;
  const scope = payload.scope;
  const email = payload.email;
  if (
    typeof token !== 'string' ||
    token.trim().length === 0 ||
    token !== token.trim() ||
    scope !== 'customer' ||
    typeof email !== 'string' ||
    email.trim().length === 0
  ) {
    throw new SessionPayloadError('登录响应无效，请重试');
  }

  return { token, scope, email: email.trim() };
};

export interface CurrentCustomerSession {
  id: number;
  email: string;
  nickname?: string | null;
  scope: 'customer';
  status: 'invited' | 'active' | 'inactive';
  has_password: boolean;
  must_set_password: boolean;
}

export const parseCurrentCustomerSession = (value: unknown): CurrentCustomerSession => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new SessionPayloadError('账号信息响应无效，请稍后重试');
  }

  const payload = value as Record<string, unknown>;
  const id = payload.id;
  const email = payload.email;
  const nickname = payload.nickname;
  const scope = payload.scope;
  const status = payload.status;
  const hasPassword = payload.has_password;
  const mustSetPassword = payload.must_set_password;
  const validStatus = status === 'invited' || status === 'active' || status === 'inactive';
  const validNickname =
    nickname === undefined || nickname === null || typeof nickname === 'string';

  if (
    typeof id !== 'number' ||
    !Number.isSafeInteger(id) ||
    id <= 0 ||
    typeof email !== 'string' ||
    email.trim().length === 0 ||
    !validNickname ||
    scope !== 'customer' ||
    !validStatus ||
    typeof hasPassword !== 'boolean' ||
    typeof mustSetPassword !== 'boolean'
  ) {
    throw new SessionPayloadError('账号信息响应无效，请稍后重试');
  }

  return {
    id,
    email,
    ...(nickname !== undefined ? { nickname } : {}),
    scope,
    status,
    has_password: hasPassword,
    must_set_password: mustSetPassword,
  };
};

export const shouldInvalidateCustomerSession = (error: unknown): boolean =>
  error instanceof SessionEligibilityError ||
  (error instanceof AuthHttpError && error.status === 401);

export const activateCustomerToken = async <T>(options: {
  token: string;
  persist: (token: string) => void;
  validate: (token: string) => Promise<T>;
  invalidate: (token: string) => void;
  revoke: (token: string) => Promise<unknown>;
}): Promise<T> => {
  options.persist(options.token);
  try {
    return await options.validate(options.token);
  } catch (error) {
    if (shouldInvalidateCustomerSession(error)) {
      options.invalidate(options.token);
      await Promise.resolve().then(() => options.revoke(options.token)).catch(() => undefined);
    }
    throw error;
  }
};

export const scheduleBestEffort = (
  operation: BestEffortOperation,
  onRejected: (error: unknown) => void
): void => {
  void Promise.resolve().then(operation).catch(onRejected);
};

export const settleBestEffort = async (operations: BestEffortOperation[]): Promise<void> => {
  await Promise.allSettled(operations.map(async (operation) => await operation()));
};
