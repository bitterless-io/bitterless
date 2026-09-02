import { createApp, nextTick } from 'vue'
import { createXpcRendererEmitter } from 'electron-xpc/renderer'
import '@arco-design/web-vue/dist/arco.less'
import '@arco-design/web-vue/es/style/theme/global.less'
import '../../common/style.css'
import { i18n } from '@renderer/common/i18n/i18n.helper'
import { initializeRendererLanguage } from '@renderer/common/i18n/rendererLanguage'
import {
  MAESTRO_HOME_READY_TOKEN_QUERY,
  type CoachXpcContract
} from '@maestro-shared/coach.api'

const coach = createXpcRendererEmitter<CoachXpcContract>('CoachXpcHandler')

const bootstrap = async (): Promise<void> => {
  const readyToken = new URL(window.location.href).searchParams.get(MAESTRO_HOME_READY_TOKEN_QUERY)
  if (!readyToken) throw new Error('[Maestro Home] Missing renderer readiness token')
  await initializeRendererLanguage()
  const { default: App } = await import('./App.vue')
  createApp(App).use(i18n).mount('#app')
  await nextTick()
  const result = await coach.homeRendererReady({ token: readyToken })
  if (!result?.accepted) throw new Error('[Maestro Home] Stale renderer readiness token')
}

void bootstrap()
