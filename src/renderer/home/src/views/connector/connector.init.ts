import { wechatStore } from './wechat/wechat.store';

let initPromise: Promise<void> | null = null;

/**
 * Initialize all connectors on app startup.
 * This function should be called once during app initialization.
 */
export const initConnectors = async (): Promise<void> => {
  if (initPromise) return initPromise;

  initPromise = (async () => {
    console.log('[connectors] initializing all connectors...');

    await wechatStore.init();

    console.log('[connectors] all connectors initialized');
  })();

  return initPromise;
};
