import { createApp } from 'vue';
import { initializeOnlyPreviewI18n, onlyPreviewI18n } from '../../common/onlyPreviewI18n';

const bootstrap = async (): Promise<void> => {
  await initializeOnlyPreviewI18n();
  const { default: App } = await import('./App.vue');
  createApp(App).provide('onlyPreviewI18n', onlyPreviewI18n).mount('#app');
};

void bootstrap();
