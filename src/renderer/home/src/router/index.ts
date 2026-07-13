import { createRouter, createWebHashHistory } from 'vue-router';
import { defaultRoutes } from './defaultRoutes';
import { authStore } from '@/stores/auth/auth.store';

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
      await authStore.fetchMe();
    } catch {
      authStore.clearLocalSession();
      return { name: 'login', query: { redirect: to.fullPath } };
    }
  }

  if (authStore.current?.must_set_password) {
    return { name: 'login', query: { redirect: to.fullPath } };
  }

  return true;
});

export default router;
