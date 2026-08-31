import { createApp } from 'vue'
import '@arco-design/web-vue/dist/arco.less'
import '@arco-design/web-vue/es/style/theme/global.less'
import 'markstream-vue/index.css'
import '../../common/style.css'
import { i18n } from '@renderer/common/i18n/i18n.helper'
import { initializeRendererLanguage } from '@renderer/common/i18n/rendererLanguage'

const bootstrap = async (): Promise<void> => {
  await initializeRendererLanguage()
  const { default: ControlApp } = await import('./ControlApp.vue')
  createApp(ControlApp).use(i18n).mount('#app')
}

void bootstrap()
