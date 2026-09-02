import { createApp, nextTick } from 'vue';
import { createXpcRendererEmitter } from 'electron-xpc/renderer';
import ArcoVue from '@arco-design/web-vue';
import '@arco-design/web-vue/dist/arco.less';
import '@arco-design/web-vue/es/style/theme/global.less';
import '@renderer/common/assets/style/theme.less';
import { i18n } from '@renderer/common/i18n/i18n.helper';
import { initializeRendererLanguage } from '@renderer/common/i18n/rendererLanguage';
import { initUpdateSubscriber } from '@renderer/home/src/xpc/update.subscriber';
import type { OmniCellEnvApi } from '@preload/omni/omni.preload';
import type { OmniWindowHandler } from '@main/xpc/omniWindow.handler';

const omniWindowEmitter = createXpcRendererEmitter<OmniWindowHandler>('OmniWindowHandler');

const bootstrap = async (): Promise<void> => {
  initUpdateSubscriber();
  await initializeRendererLanguage();
  const { default: App } = await import('./App.vue');
  createApp(App).use(ArcoVue).use(i18n).mount('#app');
  await nextTick();
  const env = (globalThis as any).omniCellEnv as OmniCellEnvApi;
  if (
    !env?.readyToken ||
    env.readyGeneration === null ||
    env.readyRole !== 'window' ||
    env.cellId !== null
  ) {
    throw new Error('[Omni Window] Missing or invalid renderer readiness identity');
  }
  const result = await omniWindowEmitter.rendererMountedReady({
    token: env.readyToken,
    generation: env.readyGeneration,
    role: env.readyRole,
    cellId: env.cellId,
  });
  if (!result?.accepted) {
    throw new Error('[Omni Window] Stale renderer readiness identity');
  }
};

void bootstrap();
