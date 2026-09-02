import { createApp, nextTick } from 'vue';
import { createXpcRendererEmitter } from 'electron-xpc/renderer';
import ArcoVue from '@arco-design/web-vue';
import '@arco-design/web-vue/dist/arco.less';
import '@arco-design/web-vue/es/style/theme/global.less';
import '@renderer/common/assets/style/theme.less';
import { i18n } from '@renderer/common/i18n/i18n.helper';
import { initializeRendererLanguage } from '@renderer/common/i18n/rendererLanguage';
import { omniCellEnv } from './contextBridge/cellEnv.bridge';
import type { OmniWindowHandler } from '@main/xpc/omniWindow.handler';

const omniWindowEmitter = createXpcRendererEmitter<OmniWindowHandler>('OmniWindowHandler');

const bootstrap = async (): Promise<void> => {
  await initializeRendererLanguage();
  const { default: App } = await import('./App.vue');
  createApp(App).use(ArcoVue).use(i18n).mount('#app');
  await nextTick();

  const hasAnyReadyIdentity = Boolean(
    omniCellEnv.readyToken ||
    omniCellEnv.readyGeneration !== null ||
    omniCellEnv.readyRole !== null,
  );
  if (!hasAnyReadyIdentity) return;
  if (
    !omniCellEnv.readyToken ||
    omniCellEnv.readyGeneration === null ||
    omniCellEnv.readyRole !== 'browser-cell' ||
    !omniCellEnv.cellId
  ) {
    throw new Error('[Omni Cell] Incomplete renderer readiness identity');
  }
  const result = await omniWindowEmitter.rendererMountedReady({
    token: omniCellEnv.readyToken,
    generation: omniCellEnv.readyGeneration,
    role: omniCellEnv.readyRole,
    cellId: omniCellEnv.cellId,
  });
  if (!result?.accepted) {
    throw new Error('[Omni Cell] Stale renderer readiness identity');
  }
};

void bootstrap();
