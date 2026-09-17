import { createApp, nextTick } from 'vue';
import ArcoVue from '@arco-design/web-vue';
import '@arco-design/web-vue/dist/arco.less';
import '@arco-design/web-vue/es/style/theme/global.less';
import '../../common/style.css';
import { i18n } from '@renderer/common/i18n/i18n.helper';
import { initializeRendererLanguage } from '@renderer/common/i18n/rendererLanguage';
import { historyStore } from './history.store';
import HistoryApp from './HistoryApp.vue';
import { browserHistoryError, browserHistoryLog } from '@maestro-shared/browserHistoryDiagnostics.service';

const bootstrap = async (): Promise<void> => {
  let phase = 'language';
  try {
    browserHistoryLog('renderer.bootstrap.begin');
    browserHistoryLog('renderer.language.begin');
    await initializeRendererLanguage();
    browserHistoryLog('renderer.language.success');
    phase = 'vue-mount';
    browserHistoryLog('renderer.vue-mount.begin');
    createApp(HistoryApp).use(ArcoVue).use(i18n).mount('#app');
    await nextTick();
    browserHistoryLog('renderer.vue-mount.success');
    phase = 'snapshot';
    browserHistoryLog('renderer.snapshot.begin');
    await historyStore.init();
    browserHistoryLog('renderer.snapshot.success');
  } catch (error) {
    browserHistoryLog('renderer.bootstrap.failure', { reason: phase, ...browserHistoryError(error) });
    throw error;
  }
};

void bootstrap();
