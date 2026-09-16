import { createApp } from 'vue'
import ArcoVue from '@arco-design/web-vue'
import '@arco-design/web-vue/dist/arco.less'
import '@arco-design/web-vue/es/style/theme/global.less'
import '../../common/style.css'
import { i18n } from '@renderer/common/i18n/i18n.helper'
import { initializeRendererLanguage } from '@renderer/common/i18n/rendererLanguage'
import { tabAliasStore } from './tabAlias.store'
// **静态 import,不许改回 `await import()`。** 打包后动态 import 要走 Vite 的 `__vitePreload`,
// 它给拆出去的 CSS 建一个 `<link rel="stylesheet" crossorigin>` 并等它的 load/error —— 页面是
// `file://` 且带 `default-src 'self'` 的 CSP,那条链上任何一环拒掉就把整个 `import()` 抛掉,
// 而 `loadFile` 的 Promise 早就 resolve 了(HTML 本身是加载成功的)。结果是主进程认为表单已就绪、
// 挂上一张什么都没画的透明覆盖层:点 `Alias…` 看不到任何东西,一行错误都没有
// (docs/issues/maestro-tab-alias-does-nothing.md)。其余每个 maestro 渲染入口都是静态 import。
import TabAliasApp from './TabAliasApp.vue'

const bootstrap = async (): Promise<void> => {
  // 准备工作**不许挡住挂载**:这一层是盖在操作区上的透明覆盖层,没挂载就是一张什么都没画的
  // 全矩形 —— 点了 `Alias…` 什么也看不到。语言拿不到最多是英文,快照拿不到下一次广播还会补。
  try {
    await initializeRendererLanguage()
    // 先把快照拉回来再挂载:这个 view 的加载完成正是 main 挂它进子节点列表的闸门,挂载时表单
    // 一定已经有内容可画,不会先闪一帧空白对话框。
    await tabAliasStore.init()
  } catch (error) {
    console.error('[maestro tab alias] bootstrap degraded:', error)
  }
  createApp(TabAliasApp).use(ArcoVue).use(i18n).mount('#app')
}

void bootstrap()
