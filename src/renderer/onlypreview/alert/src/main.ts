import { createApp } from 'vue';
import { onlyPreviewAlertStore } from './onlyPreviewAlert.store';

// No i18n catalog: every string this surface renders — title, message, entry list, button labels —
// arrives inside the dialog payload, already localized by Main, which is also what makes the error
// dialog reusable by any caller. There is nothing here to translate.
const bootstrap = async (): Promise<void> => {
  await onlyPreviewAlertStore.initialize();
  const { default: App } = await import('./App.vue');
  createApp(App).mount('#app');
};

void bootstrap();
