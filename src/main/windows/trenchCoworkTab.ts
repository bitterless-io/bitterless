import { registerMaestroCompositeTab } from '@maestro-main/windows/main/compositeTab.registry';
import {
  MAESTRO_TRENCH_DISPLAY_URL,
  MAESTRO_TRENCH_TAB_ID
} from '@maestro-shared/compositeTab.identity';
import { coinWindowHandler } from '@main/xpc/coinWindow.handler';
import { coinWindowManager } from '@main/coin/coinWindow.manager';

export const registerTrenchCoworkTab = (): void => {
  registerMaestroCompositeTab({
    id: MAESTRO_TRENCH_TAB_ID,
    title: 'Trench',
    favicon: '',
    displayUrl: MAESTRO_TRENCH_DISPLAY_URL,
    // One bound coin runtime, so a second copy would have nothing of its own to show.
    singleton: true,
    requiresAuthentication: true,
    open: async (host) => {
      await coinWindowHandler.openOnTab(host);
    },
    close: (host) => coinWindowManager.closeTab(host),
    setActive: (host, active) => coinWindowManager.setTabActive(host, active),
    refresh: (host) => coinWindowManager.refreshTab(host)
  });
};
