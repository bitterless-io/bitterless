import { createApp } from 'vue';
import { initializeOnlyPreviewI18n, onlyPreviewI18n } from '../../common/onlyPreviewI18n';
import { onlyPreviewGlobalSearchStore } from '../../shell/src/onlyPreviewGlobalSearch.store';
import { onlyPreviewGlobalSearchHostClient } from './onlyPreviewGlobalSearchHost.client';

const bootstrap = async (): Promise<void> => {
  await initializeOnlyPreviewI18n();
  onlyPreviewGlobalSearchStore.configure(
    () => onlyPreviewGlobalSearchStore.context,
    (result) => onlyPreviewGlobalSearchHostClient.openResult(result),
    (mode) => onlyPreviewGlobalSearchHostClient.close(mode)
  );
  onlyPreviewGlobalSearchStore.subscribe();
  await onlyPreviewGlobalSearchHostClient.initialize(
    (context) => {
      onlyPreviewGlobalSearchStore.setContext(context);
    },
    (origin) => onlyPreviewGlobalSearchStore.enter(origin),
    (active) => {
      if (active) {
        if (!onlyPreviewGlobalSearchStore.active) onlyPreviewGlobalSearchStore.enter();
      } else {
        onlyPreviewGlobalSearchStore.exit(false);
      }
    }
  );
  const { default: App } = await import('./App.vue');
  createApp(App).provide('onlyPreviewI18n', onlyPreviewI18n).mount('#app');
};

void bootstrap();
