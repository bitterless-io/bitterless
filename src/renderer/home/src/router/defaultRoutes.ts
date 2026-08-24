import type { RouteRecordRaw } from 'vue-router';
import Chat from '@/views/chat/Chat.vue';
import Layout from '@/views/layout/Layout.vue';
import Login from '@/views/login/Login.vue';

const isDev = import.meta.env.VITE_ENV === 'dev';
const defaultHomePath = '/chat';

const baseRoutes: RouteRecordRaw[] = [
  {
    path: 'chat',
    name: 'chat',
    component: Chat,
    meta: {
      icon: 'chat.png'
    }
  }
];

const devRoutes: RouteRecordRaw[] = [
  {
    path: 'debug',
    name: 'debug',
    component: () => import('@/views/debug/Debug.vue'),
    meta: {
      icon: 'debug.png'
    }
  },
  {
    path: 'plugin-test',
    name: 'pluginTest',
    component: () => import('@/views/plugins/pluginTest/PluginTest.vue'),
    meta: {
      icon: 'plugin.png'
    }
  }
];

export const defaultRoutes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'login',
    component: Login,
    meta: {
      public: true
    }
  },
  {
    path: '/',
    component: Layout,
    redirect: defaultHomePath,
    children: [...baseRoutes, ...(isDev ? devRoutes : [])]
  },
  {
    path: '/:pathMatch(.*)*',
    redirect: defaultHomePath
  }
];
