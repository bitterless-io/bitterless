import { createApp } from 'vue';
import ArcoVue from '@arco-design/web-vue';
import '@arco-design/web-vue/dist/arco.less';
import '@arco-design/web-vue/es/style/theme/global.less';
import '@renderer/common/assets/style/theme.less';
import App from './App.vue';
import './xpc/language.subscriber';

createApp(App).use(ArcoVue).mount('#app');
