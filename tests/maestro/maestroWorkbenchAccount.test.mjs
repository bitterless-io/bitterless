/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  SETTING_TABS,
  parseSettingOpenNotice
} from '../../src/shared/setting/settingNavigation.contract.ts';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
const source = (relativePath) => readFileSync(join(projectRoot, relativePath), 'utf8');

test('Account is a Settings category immediately after General', () => {
  assert.equal(SETTING_TABS.indexOf('account'), SETTING_TABS.indexOf('general') + 1);
  assert.deepEqual(parseSettingOpenNotice({ tab: 'account' }), { tab: 'account' });

  const setting = source('src/renderer/home/src/views/setting/Setting.vue');
  assert.match(setting, /@click="onNavClick\('account'\)"/);
  assert.match(setting, /i18nHelper\.setting\.account\.tabTitle/);
  assert.match(setting, /<AccountSetting v-if="settingNavStore\.activeTab === 'account'" \/>/);
  assert.ok(
    setting.indexOf("onNavClick('general')") < setting.indexOf("onNavClick('account')") &&
      setting.indexOf("onNavClick('account')") < setting.indexOf("onNavClick('llm')")
  );
});

test('Account owns identity loading and logout without duplicating General', () => {
  const account = source(
    'src/renderer/home/src/views/setting/components/AccountSetting/AccountSetting.vue'
  );
  const store = source(
    'src/renderer/home/src/views/setting/components/AccountSetting/accountSetting.store.ts'
  );
  const general = source(
    'src/renderer/home/src/views/setting/components/GeneralSetting/GeneralSetting.vue'
  );
  const generalStore = source(
    'src/renderer/home/src/views/setting/components/GeneralSetting/generalSetting.store.ts'
  );

  assert.match(account, /void accountSettingStore\.loadAccount\(\)/);
  assert.match(account, /v-if="accountSettingStore\.loading"/);
  assert.match(account, /v-else-if="accountSettingStore\.loadFailed"/);
  assert.match(account, /name="account-setting__retry"/);
  assert.match(account, /@click="accountSettingStore\.loadAccount\(\)"/);
  assert.match(account, /name="account-setting__logout"/);
  assert.match(account, /:loading="accountSettingStore\.loggingOut"/);
  assert.match(store, /await homeShellBridge\.getSessionSummary\(\)/);
  assert.match(store, /const email = session\.email\.trim\(\)/);
  assert.match(store, /if \(this\.loggingOut\) return/);
  assert.match(store, /await homeShellBridge\.logout\(\)/);
  assert.match(store, /Message\.error\(i18nHelper\.setting\.account\.logoutFailed\)/);
  assert.doesNotMatch(`${account}\n${store}`, /token|customerId|sessionId/);
  assert.doesNotMatch(`${general}\n${generalStore}`, /accountEmail|loggingOut|homeShellBridge/);
});

test('Account remains flat and uses the Settings Royal Blue palette', () => {
  const style = source(
    'src/renderer/home/src/views/setting/components/AccountSetting/AccountSetting.less'
  );

  assert.match(style, /padding: 24px/);
  assert.match(style, /var\(--color-royalblue-700\)/);
  assert.match(style, /var\(--color-royalblue-800\)/);
  assert.doesNotMatch(style, /(?:border|background|box-shadow)\s*:/);
});
