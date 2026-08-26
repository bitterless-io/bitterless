import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router'
import MiniApp from '@/views/miniApp/MiniApp.vue'
import Setting from '@/views/setting/Setting.vue'

const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/mini-app' },
  { path: '/mini-app', name: 'mini-app', component: MiniApp },
  {
    path: '/setting',
    name: 'setting',
    component: Setting,
    props: { showChatMenuControl: false }
  },
  { path: '/:pathMatch(.*)*', redirect: '/mini-app' }
]

export const localHomeRouter = createRouter({
  history: createWebHashHistory(),
  routes
})
