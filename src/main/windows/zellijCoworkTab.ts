import { registerMaestroCompositeTab } from '@maestro-main/windows/main/compositeTab.registry';
import {
  MAESTRO_ZELLIJ_DISPLAY_URL,
  MAESTRO_ZELLIJ_TAB_ID
} from '@maestro-shared/compositeTab.identity';
import { MAESTRO_ICON_ZELLIJ } from '@maestro-shared/compositeTabIcon';
import { zellijWindowService } from '@main/zellij/zellijWindow.service';

/**
 * Zellij as a Maestro tab, so the terminal opens inside the operation view instead of a window of
 * its own (Ral 2026-09-11).
 *
 * Mirrors `trenchCoworkTab.ts`: the registry is Maestro's, the mount is ours, and the dependency
 * points one way only — Maestro carries a native `View` without knowing what is in it, which is what
 * `check:maestro`'s alias boundary enforces.
 *
 * NOT `singleton`, unlike the other two: Zellij's shared piece is one HTTP server, and a server is
 * multi-client by construction, so N tabs are simply N clients (Ral 2026-09-11:「支持开多个不是
 * 单例类型的」). That is also why there is no module-level `host` here any more — several tabs are
 * live at once, and each lifecycle callback is told which one it is about.
 */
export const registerZellijCoworkTab = (): void => {
  registerMaestroCompositeTab({
    id: MAESTRO_ZELLIJ_TAB_ID,
    title: 'Zellij',
    favicon: MAESTRO_ICON_ZELLIJ,
    displayUrl: MAESTRO_ZELLIJ_DISPLAY_URL,
    // The tab comes back next launch, and its `instanceId` is what puts it back on its own session.
    restorable: true,
    open: async (host) => {
      await zellijWindowService.openOnTab(host);
    },
    close: (host) => zellijWindowService.closeTab(host),
    setActive: (host, active) => zellijWindowService.setTabActive(host, active),
    refresh: (host) => zellijWindowService.refreshTab(host)
  });
};
