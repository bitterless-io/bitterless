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
import { initUpdateSubscriber } from './xpc/update.subscriber';

enableKatex();
getUseMonaco();
setCustomComponents({
  code_block: MarkdownCodeBlockNode
});

const bootstrap = async (): Promise<void> => {
  await initializeRendererLanguage();
  const [{ default: App }, { default: router }] = await Promise.all([
    import('./App.vue'),
    import('./router'),
  ]);
  createApp(App).use(ArcoVue).use(router).use(i18n).mount('#app');

  initAuthSubscriber();
  initUpdateSubscriber();
};

void bootstrap();
