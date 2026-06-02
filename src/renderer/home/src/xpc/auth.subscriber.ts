import { Message } from '@arco-design/web-vue';
import { xpcRenderer, type XpcPayload } from 'electron-xpc/renderer';
import router from '@/router';
import { authStore } from '@/stores/auth/auth.store';
import type { AuthInvalidationPayload } from '@shared/auth/auth.type';

export const initAuthSubscriber = (): void => {
  xpcRenderer.subscribe('auth/invalidated', async (payload: XpcPayload) => {
    const params = (payload.params || {}) as AuthInvalidationPayload;
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
  });
};
