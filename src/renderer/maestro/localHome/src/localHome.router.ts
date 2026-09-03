import { h } from 'vue';
import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router';
import MiniApp from '@/views/miniApp/MiniApp.vue';

const AuthGateRoute = {
  name: 'AuthGateRoute',
  render: () => h('span', { hidden: true, 'aria-hidden': 'true' })
};

const routes: RouteRecordRaw[] = [
  { path: '/', name: 'auth-gate', component: AuthGateRoute },
  { path: '/mini-app', name: 'mini-app', component: MiniApp },
  {
    path: '/setting',
    name: 'setting',
    component: () => import('@/views/setting/Setting.vue'),
    props: { showChatMenuControl: false }
  },
  { path: '/:pathMatch(.*)*', name: 'auth-gate-fallback', component: AuthGateRoute }
];

export const localHomeRouter = createRouter({
  history: createWebHashHistory(),
  routes
});
