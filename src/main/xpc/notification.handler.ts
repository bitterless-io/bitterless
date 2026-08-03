import { XpcMainHandler } from 'electron-xpc/main';
import { notifyHelper } from '@main/notificationcenter/notify.helper';
import type { NotificationSettingsApi } from '@shared/setting/settingNavigation.contract';

export class NotificationHandler extends XpcMainHandler implements NotificationSettingsApi {
  async sendTestNotification(): Promise<void> {
    notifyHelper.notifyTest();
  }
}

export const notificationHandler = new NotificationHandler();
