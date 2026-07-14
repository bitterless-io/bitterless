import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router'
import WorkbenchRecordingView from './views/WorkbenchRecordingView.vue'
import WorkbenchSkillsView from './views/WorkbenchSkillsView.vue'
import WorkbenchIntegrationsView from './views/WorkbenchIntegrationsView.vue'
import WorkbenchInjectionsView from './views/WorkbenchInjectionsView.vue'
import WorkbenchToolsView from './views/WorkbenchToolsView.vue'
import WorkbenchModelsView from './views/WorkbenchModelsView.vue'
import WorkbenchAboutView from './views/WorkbenchAboutView.vue'
import WorkbenchLogView from './views/WorkbenchLogView.vue'
import { preferredWorkbenchPane } from './workbench.store'

const routes: RouteRecordRaw[] = [
  { path: '/', redirect: () => ({ name: preferredWorkbenchPane() }) },
  { path: '/capture', name: 'recording', component: WorkbenchRecordingView, alias: '/recording' },
  { path: '/skills', name: 'skills', component: WorkbenchSkillsView },
  { path: '/integrations', name: 'integrations', component: WorkbenchIntegrationsView },
  { path: '/injections', name: 'injections', component: WorkbenchInjectionsView },
  { path: '/tools', name: 'tools', component: WorkbenchToolsView },
  { path: '/models', name: 'models', component: WorkbenchModelsView },
  { path: '/about', name: 'about', component: WorkbenchAboutView },
  { path: '/log', name: 'log', component: WorkbenchLogView },
  { path: '/:pathMatch(.*)*', redirect: '/capture' }
]

export const workbenchRouter = createRouter({
  history: createWebHashHistory(),
  routes
})
