import { reactive } from 'vue';
import type { SettingTab } from '@shared/setting/settingNavigation.contract';

class SettingNavState {
  activeTab: SettingTab = 'proxy';
  pendingOpen = false;

  select(tab: SettingTab): void {
    this.activeTab = tab;
  }

  requestOpen(tab: SettingTab): void {
    this.select(tab);
    this.pendingOpen = true;
  }

  consumeOpenRequest(): boolean {
    if (!this.pendingOpen) return false;
    this.pendingOpen = false;
    return true;
  }
}

export const settingNavStore = reactive<SettingNavState>(new SettingNavState());
