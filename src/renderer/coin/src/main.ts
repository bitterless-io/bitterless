import { createApp } from 'vue';
import ArcoVue from '@arco-design/web-vue';
import '@arco-design/web-vue/dist/arco.less';
import '@arco-design/web-vue/es/style/theme/global.less';
import '@renderer/common/assets/style/theme.less';
import { i18n } from '@renderer/common/i18n/i18n.helper';
import { initializeCoinLanguage } from './coinLanguage';

const bootstrap = async (): Promise<void> => {
  await initializeCoinLanguage();
  const { default: App } = await import('./App.vue');
  createApp(App).use(ArcoVue).use(i18n).mount('#app');
};

void bootstrap();
