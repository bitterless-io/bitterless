import { reactive } from 'vue';
import { Message } from '@arco-design/web-vue';
import { homeShellBridge } from '@renderer/common/homeShellBridge.client';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';

class AccountSettingState {
  email = '';
  loading = false;
  loadFailed = false;
  loggingOut = false;

  async loadAccount(): Promise<void> {
    if (this.loading) return;

    this.loading = true;
    this.loadFailed = false;
    try {
      const session = await homeShellBridge.getSessionSummary();
      const email = session.email.trim();
      if (!email) throw new Error('Account email is empty.');
      this.email = email;
    } catch (err) {
      this.email = '';
      this.loadFailed = true;
      console.error('[AccountSettingState] Failed to load account information:', err);
    } finally {
      this.loading = false;
    }
  }

  async logout(): Promise<void> {
    if (this.loggingOut) return;

    this.loggingOut = true;
    try {
      await homeShellBridge.logout();
    } catch (err) {
      this.loggingOut = false;
      Message.error(i18nHelper.setting.account.logoutFailed);
      console.error('[AccountSettingState] Failed to log out:', err);
    }
  }
}

export const accountSettingStore = reactive(new AccountSettingState());
