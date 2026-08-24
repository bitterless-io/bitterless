import { createApp } from 'vue'
import ArcoVue from '@arco-design/web-vue'
import '@arco-design/web-vue/dist/arco.css'
import '../../common/style.css'
import { i18n } from '@renderer/common/i18n/i18n.helper'
import { initializeRendererLanguage } from '@renderer/common/i18n/rendererLanguage'

const bootstrap = async (): Promise<void> => {
  await initializeRendererLanguage()
  const [{ default: WorkbenchApp }, { workbenchRouter }] = await Promise.all([
    import('./WorkbenchApp.vue'),
    import('./workbench.router')
  ])
  createApp(WorkbenchApp).use(ArcoVue).use(workbenchRouter).use(i18n).mount('#app')
}

void bootstrap()
