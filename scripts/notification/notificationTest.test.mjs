/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '../..');
const read = (path) => readFileSync(join(root, path), 'utf8');

test('Settings places Notification immediately above Log', () => {
  const setting = read('src/renderer/home/src/views/setting/Setting.vue');
  const navigation = read('src/shared/setting/settingNavigation.contract.ts');

  assert.match(navigation, /'systemPrompt',\s*'notification',\s*'log',\s*'about'/);

  const notificationNav = setting.indexOf('@click="onNavClick(\'notification\')"');
  const logNav = setting.indexOf('@click="onNavClick(\'log\')"');
  const notificationContent = setting.indexOf(
    '<NotificationSetting v-if="settingNavStore.activeTab === \'notification\'" />'
  );
  const logContent = setting.indexOf('<LogSetting v-if="settingNavStore.activeTab === \'log\'" />');

  assert.ok(notificationNav >= 0, 'Missing Notification navigation item');
  assert.ok(logNav > notificationNav, 'Notification navigation must precede Log');
  assert.ok(notificationContent >= 0, 'Missing Notification Settings content');
  assert.ok(logContent > notificationContent, 'Notification content must precede Log');
  assert.match(
    setting,
    /\{\{ i18nHelper\.setting\.notification\.tabTitle \}\}\s*<\/div>\s*<div\s+class="setting__nav-item"\s+:class="\{ 'setting__nav-item--active': settingNavStore\.activeTab === 'log' \}"/
  );
  assert.match(
    setting,
    /<NotificationSetting v-if="settingNavStore\.activeTab === 'notification'" \/>\s*<LogSetting v-if="settingNavStore\.activeTab === 'log'" \/>/
  );
});

test('Notification Settings renders one mini notification test button', () => {
  const component = read(
    'src/renderer/home/src/views/setting/components/NotificationSetting/NotificationSetting.vue'
  );
  const english = read('src/renderer/common/i18n/en.ts');
  const chinese = read('src/renderer/common/i18n/zh.ts');

  assert.equal((component.match(/<a-button\b/g) ?? []).length, 1);
  assert.match(component, /<a-button\s+[\s\S]*?size="mini"/);
  assert.match(component, /\{\{ i18nHelper\.setting\.notification\.test \}\}/);
  assert.match(
    english,
    /notification:\s*\{\s*tabTitle: 'Notification',\s*test: 'notification test'/
  );
  assert.match(chinese, /notification:\s*\{\s*tabTitle: '通知',\s*test: 'notification test'/);
});

test('Renderer uses one typed XPC request and suppresses concurrent clicks', () => {
  const component = read(
    'src/renderer/home/src/views/setting/components/NotificationSetting/NotificationSetting.vue'
  );
  const store = read(
    'src/renderer/home/src/views/setting/components/NotificationSetting/notificationSetting.store.ts'
  );

  assert.match(
    store,
    /import type \{ NotificationSettingsApi \} from '@shared\/setting\/settingNavigation\.contract'/
  );
  assert.match(store, /createXpcRendererEmitter<NotificationSettingsApi>\('NotificationHandler'\)/);
  assert.match(store, /if \(this\.testing\) return/);
  assert.match(
    store,
    /this\.testing = true;[\s\S]*await notificationEmitter\.sendTestNotification\(\);[\s\S]*finally \{\s*this\.testing = false;/
  );
  assert.equal((store.match(/notificationEmitter\.sendTestNotification\(\)/g) ?? []).length, 1);
  assert.match(component, /:loading="notificationSettingStore\.testing"/);
  assert.match(component, /:disabled="notificationSettingStore\.testing"/);
  assert.match(component, /@click="notificationSettingStore\.sendTestNotification\(\)"/);
  assert.doesNotMatch(`${component}\n${store}`, /ipcRenderer|ipcMain/);
});

test('Main delegates the XPC test request to the notification center without completion audio', () => {
  const handler = read('src/main/xpc/notification.handler.ts');
  const xpc = read('src/main/xpc/xpc.helper.ts');
  const notifier = read('src/main/notificationcenter/notify.helper.ts');
  const notifyTest = notifier.match(
    / {2}notifyTest\(\): void \{[\s\S]*?\n {2}\}(?=\n\n {2}private showThreadCompletedNotification)/
  );

  assert.match(xpc, /import '\.\/notification\.handler'/);
  assert.match(
    handler,
    /class NotificationHandler extends XpcMainHandler implements NotificationSettingsApi/
  );
  assert.match(
    handler,
    /async sendTestNotification\(\): Promise<void> \{\s*notifyHelper\.notifyTest\(\);\s*\}/
  );
  assert.ok(notifyTest, 'Missing notification-center test notification method');
  assert.match(
    notifyTest[0],
    /new Notification\(\{\s*title: 'Notification test',\s*body: 'Bitterless notifications are working\.'\s*\}\)/
  );
  assert.match(notifyTest[0], /notification\.show\(\)/);
  assert.doesNotMatch(notifyTest[0], /playThreadCompletionSound|spawn\(/);
  assert.doesNotMatch(handler, /playThreadCompletionSound|notifyThreadCompleted/);
});

test('package exposes the notification source test', () => {
  const packageJson = JSON.parse(read('package.json'));

  assert.equal(
    packageJson.scripts['test:notification'],
    'node --test scripts/notification/notificationTest.test.mjs'
  );
});
