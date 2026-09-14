import { createApp } from 'vue';
import App from './App.vue';
import '@arco-design/web-vue/es/style/theme/global.less';
import '@arco-design/web-vue/es/button/style/index.less';
import '@renderer/common/assets/style/theme.less';
import './App.less';
import {
  initializeOnlyPreviewI18n,
  onlyPreviewI18n
} from '../../onlypreview/common/onlyPreviewI18n';

const bootstrap = async (): Promise<void> => {
  await initializeOnlyPreviewI18n();
  createApp(App).provide('onlyPreviewI18n', onlyPreviewI18n).mount('#app');
};

void bootstrap();
