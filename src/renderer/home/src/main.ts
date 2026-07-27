import { createApp } from 'vue';
import 'markstream-vue/index.css';
import ArcoVue from '@arco-design/web-vue';
import '@arco-design/web-vue/dist/arco.less';
import '@arco-design/web-vue/es/style/theme/global.less';

import 'katex/dist/katex.min.css';
import {
  enableKatex,
  getUseMonaco,
  MarkdownCodeBlockNode,
  setCustomComponents
} from 'markstream-vue';
import '@renderer/common/assets/style/theme.less';
import { i18n } from '@renderer/common/i18n/i18n.helper';
import { initializeRendererLanguage } from '@renderer/common/i18n/rendererLanguage';
import './xpc/test.subscriber';
import { initAuthSubscriber } from './xpc/auth.subscriber';
import { initTodoistSyncRuntimeSubscriber } from './xpc/todoistSyncRuntime.subscriber';
import { initUpdateSubscriber } from './xpc/update.subscriber';

initTodoistSyncRuntimeSubscriber();

enableKatex();
getUseMonaco();
setCustomComponents({
  code_block: MarkdownCodeBlockNode
});

const bootstrap = async (): Promise<void> => {
  try {
    void initializeRendererLanguage().catch((error: unknown) => {
      console.error('[Home] Renderer language initialization failed:', error);
    });
  } catch (error) {
    console.error('[Home] Renderer language initialization failed:', error);
  }

  const [{ default: App }, { default: router }] = await Promise.all([
    import('./App.vue'),
    import('./router'),
  ]);
  initUpdateSubscriber();
  createApp(App).use(ArcoVue).use(router).use(i18n).mount('#app');

  initAuthSubscriber();
};

void bootstrap();
