import { createApp } from 'vue';
import ArcoVue from '@arco-design/web-vue';
import '@arco-design/web-vue/dist/arco.less';
import '@arco-design/web-vue/es/style/theme/global.less';
import { initializeOnlyPreviewI18n, onlyPreviewI18n } from '../../common/onlyPreviewI18n';

const bootstrap = async (): Promise<void> => {
  await initializeOnlyPreviewI18n();
  const { default: App } = await import('./App.vue');
  createApp(App).use(ArcoVue).provide('onlyPreviewI18n', onlyPreviewI18n).mount('#app');
};

void bootstrap();
