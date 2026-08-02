import { createRouter, createWebHashHistory } from 'vue-router';
import { defaultRoutes } from './defaultRoutes';
import { authStore, customerNeedsPasswordSetup } from '@/stores/auth/auth.store';

const router = createRouter({
  history: createWebHashHistory(),
  routes: defaultRoutes
});

router.beforeEach(async (to) => {
  if (to.meta.public) return true;

  if (!authStore.isAuthenticated()) {
    return { name: 'login', query: { redirect: to.fullPath } };
  }

  if (!authStore.current) {
    try {
      await authStore.restoreSession();
    } catch {
      return { name: 'login', query: { redirect: to.fullPath } };
    }
  }

  if (customerNeedsPasswordSetup(authStore.current)) {
    return { name: 'login', query: { redirect: to.fullPath } };
  }

  if (authStore.current?.status !== 'active') {
    authStore.clearLocalSession();
    return { name: 'login', query: { redirect: to.fullPath } };
  }

  return true;
});

router.beforeResolve((to) => {
  if (to.meta.public) return true;
  if (
    !authStore.isAuthenticated() ||
    customerNeedsPasswordSetup(authStore.current) ||
    authStore.current?.status !== 'active'
  ) {
    return { name: 'login', query: { redirect: to.fullPath } };
  }
  return true;
});

export default router;
