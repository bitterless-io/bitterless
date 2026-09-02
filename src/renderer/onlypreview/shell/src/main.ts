import { createApp, nextTick } from 'vue';
import ArcoVue from '@arco-design/web-vue';
import '@arco-design/web-vue/dist/arco.less';
import '@arco-design/web-vue/es/style/theme/global.less';
import { initializeOnlyPreviewI18n, onlyPreviewI18n } from '../../common/onlyPreviewI18n';
import { onlyPreviewClient } from '../../common/onlyPreviewClient';
import { onlyPreviewEnv } from '../../common/contextBridge/onlyPreviewEnv.bridge';

type ShellBootstrapPhase =
  | 'renderer-script'
  | 'renderer-language'
  | 'renderer-import'
  | 'renderer-mount'
  | 'renderer-receipt';

const reportShellStage = (phase: ShellBootstrapPhase, outcome?: 'success' | 'failure'): void => {
  const { hostToken, openTag } = onlyPreviewEnv;
  if (!hostToken || !openTag) return;
  void onlyPreviewClient
    .reportShellMounted({ hostToken, openTag, phase, outcome })
    .catch(() => undefined);
};

const bootstrap = async (): Promise<void> => {
  try {
    reportShellStage('renderer-script');
    await initializeOnlyPreviewI18n();
    reportShellStage('renderer-language');
    const { default: App } = await import('./App.vue');
    reportShellStage('renderer-import');
    createApp(App).use(ArcoVue).provide('onlyPreviewI18n', onlyPreviewI18n).mount('#app');
    await nextTick();
    reportShellStage('renderer-mount');
    reportShellStage('renderer-receipt', 'success');
  } catch (error) {
    reportShellStage('renderer-receipt', 'failure');
    throw error;
  }
};

void bootstrap();
