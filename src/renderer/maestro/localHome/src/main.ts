import { createApp } from 'vue'
import ArcoVue from '@arco-design/web-vue'
import '@arco-design/web-vue/dist/arco.less'
import '@arco-design/web-vue/es/style/theme/global.less'
import 'markstream-vue/index.css'
import 'katex/dist/katex.min.css'
import {
  enableKatex,
  getUseMonaco,
  MarkdownCodeBlockNode,
  setCustomComponents
} from 'markstream-vue'
import '@renderer/common/assets/style/theme.less'
import '@/App.less'
import { i18n } from '@renderer/common/i18n/i18n.helper'
import { initializeRendererLanguage } from '@renderer/common/i18n/rendererLanguage'
import LocalHomeApp from './LocalHomeApp.vue'
import './localHome.less'

// A stable marker lets shared Chat code avoid importing the full Home router/login graph.
document.documentElement.dataset.bitterlessSurface = 'maestro-local-home'

enableKatex()
getUseMonaco()
setCustomComponents({ code_block: MarkdownCodeBlockNode })

const bootstrap = async (): Promise<void> => {
  await initializeRendererLanguage()
  createApp(LocalHomeApp).use(ArcoVue).use(i18n).mount('#app')
}

void bootstrap()
