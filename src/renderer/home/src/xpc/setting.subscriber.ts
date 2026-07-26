import { createXpcRendererEmitter, xpcRenderer, type XpcPayload } from 'electron-xpc/renderer';
import router from '@/router';
import {
  SETTING_OPEN_EVENT,
  parseSettingOpenNotice,
  type SettingNavigationApi,
  type SettingOpenNotice
} from '@shared/setting/settingNavigation.contract';
import { settingNavStore } from '@/views/setting/store/settingNav.store';

const settingNavigationEmitter = createXpcRendererEmitter<SettingNavigationApi>(
  'MainWindowHandler'
) as SettingNavigationApi;

const openSetting = async (notice: SettingOpenNotice): Promise<void> => {
  settingNavStore.requestOpen(notice.tab);
  // The customer authentication guard owns the login route; the selected tab waits for login.
  if (router.currentRoute.value.name === 'login') return;
  await router.push({ name: 'setting' }).catch(() => undefined);
  settingNavStore.consumeOpenRequest();
};

export const initSettingSubscriber = (): void => {
  xpcRenderer.subscribe(SETTING_OPEN_EVENT, async (payload: XpcPayload) => {
    const notice = parseSettingOpenNotice(payload.params);
    if (!notice) return;
    await openSetting(notice);
  });

  // Main holds one navigation while Home is still loading; claim it once this renderer is live.
  void settingNavigationEmitter
    .consumePendingSetting()
    .then(async (pending) => {
      const notice = parseSettingOpenNotice(pending);
      if (notice) await openSetting(notice);
    })
    .catch((error: unknown) => {
      console.error('[Home] Pending Setting navigation failed:', error);
    });
};
