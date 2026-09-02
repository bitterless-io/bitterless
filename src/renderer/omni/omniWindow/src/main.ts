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
import type { OmniRendererBootstrapPhase } from '@shared/omni/omniOpenDiagnostics.mjs';

const omniWindowEmitter = createXpcRendererEmitter<OmniWindowHandler>('OmniWindowHandler');
const env = (globalThis as any).omniCellEnv as OmniCellEnvApi | undefined;

interface WindowReadyIdentity {
  token: string;
  generation: number;
  role: 'window';
  cellId: null;
}

const getReadyIdentity = (): WindowReadyIdentity | null => {
  if (
    !env?.readyToken ||
    env.readyGeneration === null ||
    env.readyRole !== 'window' ||
    env.cellId !== null
  ) return null;
  return {
    token: env.readyToken,
    generation: env.readyGeneration,
    role: env.readyRole,
    cellId: env.cellId,
  };
};

const reportRendererOpenStage = (
  identity: WindowReadyIdentity | null,
  phase: OmniRendererBootstrapPhase,
  outcome?: 'success' | 'failure',
): void => {
  if (!identity) return;
  try {
    void omniWindowEmitter.rendererOpenStage({
      ...identity,
      phase,
      outcome: outcome ?? 'success',
    }).catch(() => {});
  } catch {
    // Diagnostics must never affect renderer startup.
  }
};

const bootstrap = async (): Promise<void> => {
  const identity = getReadyIdentity();
  let phase: OmniRendererBootstrapPhase = 'renderer-script';
  reportRendererOpenStage(identity, 'renderer-script');
  try {
    initUpdateSubscriber();
    phase = 'renderer-language';
    await initializeRendererLanguage();
    reportRendererOpenStage(identity, 'renderer-language');
    phase = 'renderer-import';
    const { default: App } = await import('./App.vue');
    reportRendererOpenStage(identity, 'renderer-import');
    phase = 'renderer-mount';
    createApp(App).use(ArcoVue).use(i18n).mount('#app');
    await nextTick();
    reportRendererOpenStage(identity, 'renderer-mount');
    if (!identity) return;
    const result = await omniWindowEmitter.rendererMountedReady(identity);
    if (!result?.accepted) return;
  } catch {
    reportRendererOpenStage(identity, phase, 'failure');
  }
};

void bootstrap().catch(() => {});
