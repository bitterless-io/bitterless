import { createApp } from 'vue';
import 'markstream-vue/index.css';
import ArcoVue from '@arco-design/web-vue';
import '@arco-design/web-vue/dist/arco.less';
import '@arco-design/web-vue/es/style/theme/global.less';

import 'katex/dist/katex.min.css';
import { enableKatex, getUseMonaco, MarkdownCodeBlockNode, setCustomComponents } from 'markstream-vue';
import '@renderer/common/assets/style/theme.less';
import App from './App.vue';
import router from './router';
import { i18n } from '@renderer/common/i18n/i18n.helper';
import { initConnectors } from './views/connector/connector.init';
import './xpc/test.subscriber';
import './xpc/language.subscriber';
import { initUpdateSubscriber } from './xpc/update.subscriber';

enableKatex();
getUseMonaco();
setCustomComponents({
  code_block: MarkdownCodeBlockNode
});

createApp(App).use(ArcoVue).use(router).use(i18n).mount('#app');

initUpdateSubscriber();

initConnectors().catch((err) => {
  console.error('[main] failed to initialize connectors:', err);
});
