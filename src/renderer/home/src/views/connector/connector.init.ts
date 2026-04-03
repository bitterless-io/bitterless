import { wechatStore } from './wechat/wechat.store';

/**
 * Initialize all connectors on app startup.
 * This function should be called once during app initialization.
 */
export const initConnectors = async (): Promise<void> => {
  console.log('[connectors] initializing all connectors...');

  await wechatStore.init();

  console.log('[connectors] all connectors initialized');
};
