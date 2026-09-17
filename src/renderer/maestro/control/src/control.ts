import { createApp } from 'vue'
import { Button, Form, Input, Modal, Radio, Spin } from '@arco-design/web-vue'
import '@arco-design/web-vue/dist/arco.less'
import '@arco-design/web-vue/es/style/theme/global.less'
import 'markstream-vue/index.css'
import '../../common/style.css'
import { i18n } from '@renderer/common/i18n/i18n.helper'
import { initializeRendererLanguage } from '@renderer/common/i18n/rendererLanguage'
import { localHomeAuthStore } from '@renderer/maestro/localHome/src/localHomeAuth.store'
import ControlAuthApp from './ControlAuthApp.vue'

const bootstrap = async (): Promise<void> => {
  localHomeAuthStore.initialize()
  const app = createApp(ControlAuthApp).use(Button).use(Form).use(Input).use(Modal).use(Radio).use(Spin).use(i18n)
  app.mount('#app')
  window.addEventListener('pagehide', () => {
    app.unmount()
    localHomeAuthStore.dispose()
  }, { once: true })
  await initializeRendererLanguage()
}

void bootstrap()
