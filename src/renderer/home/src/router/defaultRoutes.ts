import type { RouteRecordRaw } from 'vue-router';

const isDev = import.meta.env.VITE_ENV === 'dev';

const baseRoutes: RouteRecordRaw[] = [
  {
    path: 'chat',
    name: 'chat',
    component: () => import('@/views/chat/Chat.vue'),
    meta: {
      icon: 'chat.png',
    },
  },
  {
    path: 'mini-app',
    name: 'miniApp',
    component: () => import('@/views/miniApp/MiniApp.vue'),
    meta: {
      icon: 'mini-app.png',
    },
  },
  {
    path: 'connector',
    name: 'connector',
    component: () => import('@/views/connector/Connector.vue'),
    meta: {
      icon: 'connector.png',
    },
  },
  {
    path: 'setting',
    name: 'setting',
    component: () => import('@/views/setting/Setting.vue'),
    meta: {
      icon: 'setting.png',
    },
  },
];

const devRoutes: RouteRecordRaw[] = [
  {
    path: 'debug',
    name: 'debug',
    component: () => import('@/views/debug/Debug.vue'),
    meta: {
      icon: 'debug.png',
    },
  },
  {
    path: 'plugin-test',
    name: 'pluginTest',
    component: () => import('@/views/plugins/pluginTest/PluginTest.vue'),
    meta: {
      icon: 'plugin.png',
    },
  },
];

export const defaultRoutes: RouteRecordRaw[] = [
  {
    path: '/',
    component: () => import('@/views/layout/Layout.vue'),
    redirect: '/chat',
    children: [...baseRoutes, ...(isDev ? devRoutes : [])],
  },
];
