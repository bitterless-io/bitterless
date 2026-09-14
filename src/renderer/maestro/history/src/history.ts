import { createApp, nextTick } from 'vue';
import ArcoVue from '@arco-design/web-vue';
import '@arco-design/web-vue/dist/arco.less';
import '@arco-design/web-vue/es/style/theme/global.less';
import '../../common/style.css';
import { i18n } from '@renderer/common/i18n/i18n.helper';
import { initializeRendererLanguage } from '@renderer/common/i18n/rendererLanguage';
import { historyStore } from './history.store';
import HistoryApp from './HistoryApp.vue';

const bootstrap = async (): Promise<void> => {
  await initializeRendererLanguage();
  await historyStore.init();
  createApp(HistoryApp).use(ArcoVue).use(i18n).mount('#app');
  await nextTick();
  await historyStore.mounted();
};

void bootstrap();
