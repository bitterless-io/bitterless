import { Message } from '@arco-design/web-vue';
import { xpcRenderer, type XpcPayload } from 'electron-xpc/renderer';
import router from '@/router';
import { authEmitter } from '@/emitter/auth.emitter';
import { authStore } from '@/stores/auth/auth.store';
import { shouldApplyAuthInvalidation } from '@/stores/auth/authSession.service';
import type { AuthInvalidationPayload } from '@shared/auth/auth.type';

const applyInvalidation = async (params: AuthInvalidationPayload): Promise<void> => {
  if (!shouldApplyAuthInvalidation(authStore.sessionId, params.sessionId)) return;

  const currentRoute = router.currentRoute.value;

  authStore.clearLocalSession();

  if (currentRoute.name !== 'login') {
    Message.warning(params.reason || '登录已失效，请重新登录');
  }

  await router
    .replace({
      name: 'login',
      query: currentRoute.name === 'login' ? {} : { redirect: currentRoute.fullPath }
    })
    .catch(() => undefined);

  void authEmitter.deactivateSession().catch((err) => {
    console.warn('[auth.subscriber] Failed to deactivate invalidated session:', err);
  });
};

export const initAuthSubscriber = (): void => {
  xpcRenderer.subscribe('auth/invalidated', async (payload: XpcPayload) => {
    const params = (payload.params || {}) as AuthInvalidationPayload;
    await applyInvalidation(params);
  });
};
