import { createApp } from 'vue'
import ArcoVue from '@arco-design/web-vue'
import '@arco-design/web-vue/dist/arco.less'
import '@arco-design/web-vue/es/style/theme/global.less'
import '../../common/style.css'
import { i18n } from '@renderer/common/i18n/i18n.helper'
import { initializeRendererLanguage } from '@renderer/common/i18n/rendererLanguage'
import { tabAliasStore } from './tabAlias.store'

const bootstrap = async (): Promise<void> => {
  await initializeRendererLanguage()
  // 先把快照拉回来再挂载:这个 view 的加载完成正是 main 挂它进子节点列表的闸门,挂载时表单
  // 一定已经有内容可画,不会先闪一帧空白对话框。
  await tabAliasStore.init()
  const { default: TabAliasApp } = await import('./TabAliasApp.vue')
  createApp(TabAliasApp).use(ArcoVue).use(i18n).mount('#app')
}

void bootstrap()
