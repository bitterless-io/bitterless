import { createApp } from 'vue';
import ArcoVue from '@arco-design/web-vue';
import '@arco-design/web-vue/dist/arco.less';
import '@arco-design/web-vue/es/style/theme/global.less';
import '@renderer/common/assets/style/theme.less';
import { i18n } from '@renderer/common/i18n/i18n.helper';
import { initializeRendererLanguage } from '@renderer/common/i18n/rendererLanguage';
import { ZELLIJ_CHROME_HEIGHT } from '@shared/zellij/zellij.type';
import App from './App.vue';
import { bindMaestroRefresh } from './maestroRefresh';

// 工具条高度的唯一来源是 shared 那个常量 —— main 侧的首帧兜底 `contentBounds.y` 读的也是它。
// 在 `createApp` 之前写,第一帧就是对的高度(docs/features/zellij-terminal-chrome.md #2)。
document.documentElement.style.setProperty('--zellij-chrome-height', `${ZELLIJ_CHROME_HEIGHT}px`);

const bootstrap = async (): Promise<void> => {
  await initializeRendererLanguage();
  createApp(App).use(ArcoVue).use(i18n).mount('#app');
  // 挂在挂载之后:确认文案取 i18n,而语言在 `initializeRendererLanguage()` 里才定下来。
  bindMaestroRefresh();
};
void bootstrap();
