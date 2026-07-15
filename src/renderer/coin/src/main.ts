import { createApp } from 'vue';
import ArcoVue from '@arco-design/web-vue';
import '@arco-design/web-vue/dist/arco.less';
import '@arco-design/web-vue/es/style/theme/global.less';
import '@renderer/common/assets/style/theme.less';
import { applyRendererLanguage, i18n } from '@renderer/common/i18n/i18n.helper';
import { initializeCoinLanguage } from './coinLanguage';

const LANGUAGE_BOOTSTRAP_TIMEOUT_MS = 5_000;

const safeErrorName = (error: unknown): string => {
  const value = error instanceof Error ? error.name : typeof error;
  return value.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 48) || 'unknown';
};

const initializeLanguageBeforeMount = async (): Promise<void> => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    await Promise.race([
      initializeCoinLanguage(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          const error = new Error('Coin language initialization timed out.');
          error.name = 'CoinLanguageTimeoutError';
          reject(error);
        }, LANGUAGE_BOOTSTRAP_TIMEOUT_MS);
      }),
    ]);
  } catch (error) {
    document.documentElement.dataset.coinBootstrap = 'degraded';
    applyRendererLanguage('en');
    console.error(
      `[Coin] Language initialization failed (${safeErrorName(error)}); using the default language.`,
    );
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const bootstrap = async (): Promise<void> => {
  await initializeLanguageBeforeMount();
  const { default: App } = await import('./App.vue');
  createApp(App).use(ArcoVue).use(i18n).mount('#app');
  if (!document.documentElement.dataset.coinBootstrap) {
    document.documentElement.dataset.coinBootstrap = 'ready';
  }
};

void bootstrap().catch((error) => {
  document.documentElement.dataset.coinBootstrap = 'failed';
  console.error(`[Coin] App bootstrap failed (${safeErrorName(error)}).`);
  const root = document.querySelector<HTMLElement>('#app');
  if (!root) return;
  root.setAttribute('role', 'alert');
  root.textContent = 'Coin could not start. Close and reopen Coin to retry.';
});
