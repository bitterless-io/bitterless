import { createApp } from 'vue'
import ArcoVue from '@arco-design/web-vue'
import '@arco-design/web-vue/dist/arco.less'
import '@arco-design/web-vue/es/style/theme/global.less'
import '@renderer/common/assets/style/theme.less'
import '@/App.less'
import { i18n } from '@renderer/common/i18n/i18n.helper'
import { initializeRendererLanguage } from '@renderer/common/i18n/rendererLanguage'
import LocalHomeApp from './LocalHomeApp.vue'
import { localHomeRouter } from './localHome.router'
import './localHome.less'

const bootstrap = async (): Promise<void> => {
  await initializeRendererLanguage()
  createApp(LocalHomeApp).use(ArcoVue).use(i18n).use(localHomeRouter).mount('#app')
}

void bootstrap()
