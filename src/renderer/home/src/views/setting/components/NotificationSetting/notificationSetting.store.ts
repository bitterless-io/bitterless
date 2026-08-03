import { reactive } from 'vue';
import { createXpcRendererEmitter } from 'electron-xpc/renderer';
import type { NotificationSettingsApi } from '@shared/setting/settingNavigation.contract';

const notificationEmitter =
  createXpcRendererEmitter<NotificationSettingsApi>('NotificationHandler');

class NotificationSettingState {
  testing = false;

  async sendTestNotification(): Promise<void> {
    if (this.testing) return;

    this.testing = true;
    try {
      await notificationEmitter.sendTestNotification();
    } catch (err) {
      console.error('[NotificationSettingState] Failed to send test notification:', err);
    } finally {
      this.testing = false;
    }
  }
}

export const notificationSettingStore = reactive<NotificationSettingState>(
  new NotificationSettingState()
);
