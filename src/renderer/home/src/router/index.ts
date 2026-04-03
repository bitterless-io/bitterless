import { createRouter, createWebHashHistory } from 'vue-router';
import { defaultRoutes } from './defaultRoutes';

const router = createRouter({
  history: createWebHashHistory(),
  routes: defaultRoutes,
});

export default router;
