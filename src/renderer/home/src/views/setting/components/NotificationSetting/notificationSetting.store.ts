import { reactive } from 'vue';
import { Message } from '@arco-design/web-vue';
import { createXpcRendererEmitter } from 'electron-xpc/renderer';
import {
  parseNotificationTestResult,
  type NotificationTestError,
  type NotificationSettingsApi
} from '@shared/setting/settingNavigation.contract';
import { i18nHelper } from '@renderer/common/i18n/i18n.helper';

const notificationEmitter =
  createXpcRendererEmitter<NotificationSettingsApi>('NotificationHandler');

const getNotificationTestErrorMessage = (error: NotificationTestError): string => {
  switch (error) {
    case 'unsupported':
      return i18nHelper.setting.notification.testUnsupported;
    case 'show-failed':
      return i18nHelper.setting.notification.testShowFailed;
    case 'show-timeout':
      return i18nHelper.setting.notification.testShowTimeout;
  }
};

class NotificationSettingState {
  testing = false;

  async sendTestNotification(): Promise<void> {
    if (this.testing) return;

    this.testing = true;
    try {
      const result = parseNotificationTestResult(await notificationEmitter.sendTestNotification());
      if (result.ok) {
        Message.success(i18nHelper.setting.notification.testSuccess);
      } else {
        Message.error(getNotificationTestErrorMessage(result.error));
      }
    } catch (err) {
      console.error('[NotificationSettingState] Failed to send test notification:', err);
      Message.error(i18nHelper.setting.notification.testRequestFailed);
    } finally {
      this.testing = false;
    }
  }
}

export const notificationSettingStore = reactive<NotificationSettingState>(
  new NotificationSettingState()
);
