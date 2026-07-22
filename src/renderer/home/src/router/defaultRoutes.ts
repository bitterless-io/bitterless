import type { RouteRecordRaw } from 'vue-router';
import Chat from '@/views/chat/Chat.vue';
import Layout from '@/views/layout/Layout.vue';
import Login from '@/views/login/Login.vue';

const isDev = import.meta.env.VITE_ENV === 'dev';

const baseRoutes: RouteRecordRaw[] = [
  {
    path: 'chat',
    name: 'chat',
    component: Chat,
    meta: {
      icon: 'chat.png'
    }
  },
  {
    path: 'mini-app',
    name: 'miniApp',
    component: () => import('@/views/miniApp/MiniApp.vue'),
    meta: {
      icon: 'mini-app.png'
    }
  },
  {
    path: 'connector',
    name: 'connector',
    component: () => import('@/views/connector/Connector.vue'),
    meta: {
      icon: 'connector.png'
    }
  },
  {
    path: 'setting',
    name: 'setting',
    component: () => import('@/views/setting/Setting.vue'),
    meta: {
      icon: 'setting.png'
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
    redirect: '/chat',
    children: [...baseRoutes, ...(isDev ? devRoutes : [])]
  },
  {
    path: '/:pathMatch(.*)*',
    redirect: '/chat'
  }
];
