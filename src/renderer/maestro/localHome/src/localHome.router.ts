import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router';
import MiniApp from '@/views/miniApp/MiniApp.vue';

const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/mini-app' },
  { path: '/mini-app', name: 'mini-app', component: MiniApp, props: { host: 'cowork' } },
  { path: '/sign-in', name: 'sign-in', component: () => import('./SignInGuide.vue') },
  { path: '/account/password', name: 'account-password', component: () => import('./ChangePassword.vue') },
  {
    path: '/setting',
    name: 'setting',
    component: () => import('@/views/setting/Setting.vue'),
    props: { showChatMenuControl: false }
  },
  { path: '/:pathMatch(.*)*', redirect: '/mini-app' }
];

export const localHomeRouter = createRouter({
  history: createWebHashHistory(),
  routes
});
