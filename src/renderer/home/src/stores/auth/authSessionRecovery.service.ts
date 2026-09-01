import { authStore } from '@/stores/auth/auth.store';
import type { CurrentCustomer } from '@/networking/auth.api';

interface ActiveSessionRecovery {
  controller: AbortController;
  promise: Promise<CurrentCustomer>;
}

let activeSessionRecovery: ActiveSessionRecovery | null = null;

const getConsumerAbortError = (signal: AbortSignal): Error =>
  signal.reason instanceof Error ? signal.reason : new Error('请求已取消');

const startSessionRecovery = (): ActiveSessionRecovery => {
  const controller = new AbortController();
  const promise = authStore.restoreSession(controller.signal).finally(() => {
    if (activeSessionRecovery?.controller === controller) activeSessionRecovery = null;
  });
  const active = { controller, promise };
  activeSessionRecovery = active;
  return active;
};

export const restoreCustomerSession = async (signal?: AbortSignal): Promise<CurrentCustomer> => {
  if (signal?.aborted) throw getConsumerAbortError(signal);
  const active = activeSessionRecovery ?? startSessionRecovery();
  if (!signal) return await active.promise;

  let stopWaiting: (() => void) | undefined;
  const consumerCancelled = new Promise<never>((_resolve, reject) => {
    stopWaiting = () => reject(getConsumerAbortError(signal));
    signal.addEventListener('abort', stopWaiting, { once: true });
    if (signal.aborted) stopWaiting();
  });
  try {
    return await Promise.race([active.promise, consumerCancelled]);
  } finally {
    if (stopWaiting) signal.removeEventListener('abort', stopWaiting);
  }
};

export const cancelCustomerSessionRecovery = (): void => {
  activeSessionRecovery?.controller.abort(new Error('登录状态验证已取消'));
};
