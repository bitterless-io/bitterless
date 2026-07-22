import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import {
  scheduleBestEffort,
  settleBestEffort,
} from '../../src/renderer/home/src/stores/auth/authSession.service.ts';
import { TodoistSyncActivationService } from '../../src/renderer/home/src/stores/auth/todoistSyncActivation.service.ts';

const root = resolve(import.meta.dirname, '../..');
const read = (path) => readFileSync(join(root, path), 'utf8');

const CURRENT_PROD_CORE_URL = 'https://prod-bitterless-hcqmtqwtox.cn-shanghai.fcapp.run';

test('login, authenticated layout, and initial chat view use the entry bundle', () => {
  const routes = read('src/renderer/home/src/router/defaultRoutes.ts');

  assert.match(routes, /import Chat from '@\/views\/chat\/Chat\.vue';/);
  assert.match(routes, /import Layout from '@\/views\/layout\/Layout\.vue';/);
  assert.match(routes, /import Login from '@\/views\/login\/Login\.vue';/);
  assert.doesNotMatch(
    routes,
    /import\('@\/views\/(?:chat\/Chat|layout\/Layout|login\/Login)\.vue'\)/
  );
  assert.match(routes, /path: 'chat',\n    name: 'chat',\n    component: Chat,/);
  assert.match(routes, /path: '\/login',\n    name: 'login',\n    component: Login,/);
  assert.match(routes, /path: '\/',\n    component: Layout,\n    redirect: '\/chat',/);

  for (const view of [
    'miniApp/MiniApp',
    'connector/Connector',
    'setting/Setting',
    'debug/Debug',
    'plugins/pluginTest/PluginTest',
  ]) {
    assert.match(routes, new RegExp(`component: \\(\\) => import\\('@/views/${view}\\.vue'\\)`));
  }
});

test('production auth consistently uses the released Shanghai endpoint', () => {
  const rig = read('env.rig.json5');
  const api = read('src/renderer/home/src/networking/auth.api.ts');
  const csp = read('src/renderer/home/index.html');
  const main = read('src/main/app.main.ts');

  assert.equal((rig.match(new RegExp(CURRENT_PROD_CORE_URL, 'g')) ?? []).length, 2);
  assert.match(api, new RegExp(`const PROD_CORE_URL = '${CURRENT_PROD_CORE_URL}'`));
  assert.match(csp, new RegExp(`connect-src[^\"]*${CURRENT_PROD_CORE_URL}`));
  assert.match(main, new RegExp(`authOrigins[\\s\\S]*'${CURRENT_PROD_CORE_URL}'`));
});

test('password, OTP, restore, and Todo activation reuse one create-once installation device ID', () => {
  const store = read('src/renderer/home/src/stores/auth/auth.store.ts');
  const createDeviceId = store.match(
    /const getOrCreateDeviceId = \(\): string => \{[\s\S]*?\n\};/
  );
  const passwordLogin = store.match(
    /  async loginWithPassword\([\s\S]*?\n  \}(?=\n\n  async sendOtp)/
  );
  const otpLogin = store.match(
    /  async loginWithOtp\([\s\S]*?\n  \}(?=\n\n  async changePassword)/
  );
  const activation = store.match(
    /  private activateAuthenticatedSession\([\s\S]*?\n  \}(?=\n\n  private async activateToken)/
  );
  const readiness = store.match(
    /  async ensureTodoistSyncReady\([\s\S]*?\n  \}(?=\n\n  private activateAuthenticatedSession)/
  );
  const restore = store.match(
    /  async restoreSession\([\s\S]*?\n  \}(?=\n\n  clearLocalSession)/
  );

  assert.ok(createDeviceId, 'Missing installation device ID factory');
  assert.ok(passwordLogin, 'Missing password login flow');
  assert.ok(otpLogin, 'Missing OTP login flow');
  assert.ok(activation, 'Missing authenticated Todo activation flow');
  assert.ok(readiness, 'Missing explicit Todo readiness flow');
  assert.ok(restore, 'Missing session restore flow');
  assert.match(createDeviceId[0], /localStorage\.getItem\(DEVICE_ID_KEY\)/);
  assert.match(createDeviceId[0], /if \(existingDeviceId !== null\) return existingDeviceId/);
  assert.match(createDeviceId[0], /const deviceId = createRandomHex32\(\)/);
  assert.match(createDeviceId[0], /localStorage\.setItem\(DEVICE_ID_KEY, deviceId\)/);
  assert.equal(
    (store.match(/localStorage\.setItem\(DEVICE_ID_KEY/g) ?? []).length,
    1,
    'DEVICE_ID_KEY must have exactly one create-only write site'
  );
  assert.doesNotMatch(store, /localStorage\.removeItem\(DEVICE_ID_KEY/);
  assert.match(store, /private readonly installationDeviceId = getOrCreateDeviceId\(\)/);
  assert.match(store, /get deviceId\(\): string \{\n    return this\.installationDeviceId/);

  assert.equal((passwordLogin[0].match(/loginApi\(/g) ?? []).length, 1);
  assert.match(passwordLogin[0], /device_id: this\.deviceId/);
  assert.match(passwordLogin[0], /await this\.activateToken\(result\.token\)/);
  assert.match(otpLogin[0], /verifyOtpApi\(\{ email, code, device_id: this\.deviceId \}\)/);
  assert.match(otpLogin[0], /await this\.activateToken\(result\.token\)/);
  assert.match(activation[0], /getTodoistSyncActivateParams\(current, getToken\(\), this\.deviceId\)/);
  assert.match(readiness[0], /getTodoistSyncActivateParams\(current, getToken\(\), this\.deviceId\)/);
  assert.match(restore[0], /this\.activateAuthenticatedSession\(current\)/);

  assert.doesNotMatch(
    store,
    /DEVICE_SEED_KEY|BOOTSTRAP_DEVICE_PREFIX|getBootstrapDeviceId|getCustomerDeviceId|decodeJwtPayload/
  );
});

test('Core authentication commits without awaiting optional local runtimes', () => {
  const store = read('src/renderer/home/src/stores/auth/auth.store.ts');
  const activation = store.match(
    /  private activateAuthenticatedSession\([\s\S]*?\n  \}(?=\n\n  private async activateToken)/
  );
  const activateToken = store.match(
    /  private async activateToken\([\s\S]*?\n  \}(?=\n\n  async loginWithPassword)/
  );

  assert.ok(activation, 'Missing optional runtime activation helper');
  assert.ok(activateToken, 'Missing token activation boundary');
  assert.match(activation[0], /scheduleBestEffort\(\(\) => authEmitter\.activateSession\(\)/);
  assert.doesNotMatch(activation[0], /clearLocalSession|await authEmitter/);
  assert.ok(
    activateToken[0].indexOf('setToken(token)') <
      activateToken[0].indexOf('this.activateAuthenticatedSession(current)'),
    'validated Core session must commit before optional runtime activation'
  );
  assert.doesNotMatch(activateToken[0], /await this\.activateAuthenticatedSession/);
});

test('optional activation rejection is observed without becoming a session failure', async () => {
  const expected = new Error('optional runtime unavailable');
  let observed;

  scheduleBestEffort(
    async () => {
      throw expected;
    },
    (error) => {
      observed = error;
    }
  );
  await new Promise((resolvePromise) => setImmediate(resolvePromise));

  assert.equal(observed, expected);
});

test('Todo readiness deduplicates, rejects null ACKs, retries failure, and fences logout/account changes', async () => {
  const paramsA = { coreToken: 'token-a', customerId: 1, deviceId: 'session-device-0001' };
  const paramsB = { coreToken: 'token-b', customerId: 2, deviceId: 'session-device-0002' };
  let calls = 0;
  let resolvePending;
  const pending = new Promise((resolvePromise) => {
    resolvePending = resolvePromise;
  });
  const deduplicated = new TodoistSyncActivationService(async () => {
    calls += 1;
    return await pending;
  });
  const first = deduplicated.start(paramsA);
  const second = deduplicated.start(paramsA);
  assert.equal(first, second);
  assert.equal(calls, 1);
  resolvePending({
    status: 'active',
    customerId: paramsA.customerId,
    deviceId: paramsA.deviceId,
    sessionGeneration: 1,
  });
  await first;
  assert.equal(deduplicated.ensureReady(paramsA), first);
  assert.equal(calls, 1);

  let retryCalls = 0;
  const retried = new TodoistSyncActivationService(async () => {
    retryCalls += 1;
    if (retryCalls === 1) return null;
    return {
      status: 'active',
      customerId: paramsA.customerId,
      deviceId: paramsA.deviceId,
      sessionGeneration: 2,
    };
  });
  const failed = retried.start(paramsA);
  await assert.rejects(() => failed, /returned no result/);
  assert.equal(retried.start(paramsA), failed);
  assert.equal(retryCalls, 1);
  await retried.ensureReady(paramsA);
  assert.equal(retryCalls, 2);

  const pendingByCustomer = [];
  const fenced = new TodoistSyncActivationService(async () => await new Promise((resolvePromise) => {
    pendingByCustomer.push(resolvePromise);
  }));
  const staleAccount = fenced.start(paramsA);
  const currentAccount = fenced.start(paramsB);
  pendingByCustomer[0]({
    status: 'active',
    customerId: paramsA.customerId,
    deviceId: paramsA.deviceId,
    sessionGeneration: 3,
  });
  await assert.rejects(() => staleAccount, /superseded/);
  pendingByCustomer[1]({
    status: 'active',
    customerId: paramsB.customerId,
    deviceId: paramsB.deviceId,
    sessionGeneration: 4,
  });
  await currentAccount;

  const staleLogout = fenced.start(paramsB);
  assert.equal(staleLogout, currentAccount);
  fenced.invalidate();
  const afterLogout = fenced.start(paramsB);
  assert.notEqual(afterLogout, currentAccount);
});

test('both Home Todo entry points await readiness before creating Todo content', () => {
  const embedded = read('src/renderer/home/src/views/todo/Todo.vue');
  const miniApp = read('src/renderer/home/src/views/miniApp/MiniApp.vue');
  assert.ok(
    embedded.indexOf('await authStore.ensureTodoistSyncReady()') <
      embedded.indexOf('await todoWindowEmitter.showTodoView()'),
  );
  assert.ok(
    miniApp.indexOf('await authStore.ensureTodoistSyncReady()') <
      miniApp.indexOf('await todoWindowEmitter.openTodoWindow()'),
  );
  assert.match(embedded, /if \(!mounted\) await todoWindowEmitter\.hideTodoView\(\)/);
  assert.match(embedded, /if \(mounted\) Message\.error\(i18nHelper\.todo\.runtimeUnavailable\)/);
});

test('logout cleanup starts every operation and settles rejected cleanup', async () => {
  const events = [];

  await assert.doesNotReject(async () => {
    await settleBestEffort([
      async () => {
        events.push('main teardown');
        throw new Error('teardown rejected');
      },
      async () => {
        events.push('server revoke');
      },
    ]);
  });

  assert.deepEqual(events, ['main teardown', 'server revoke']);
});

test('login navigation is awaited and restore cannot overlap submit', () => {
  const login = read('src/renderer/home/src/views/login/Login.vue');

  assert.match(login, /const redirectAfterLogin = async \(\): Promise<void>/);
  assert.match(login, /transitioning\.value = true/);
  assert.match(login, /const failure = await router\.replace\(redirect\)/);
  assert.match(login, /isNavigationFailure\(failure\)/);
  assert.ok(
    login.indexOf('await redirectAfterLogin()') < login.indexOf("Message.success('登录成功')"),
    'login success must be announced only after navigation succeeds'
  );
  assert.match(login, /await continueAfterLogin\(\)/);
  assert.match(login, /authStore\.checking \|\| authStore\.loggingOut \|\| transitioning\.value/);
  assert.match(login, /:disabled="authStore\.loading \|\| authStore\.checking \|\| authStore\.loggingOut \|\| transitioning"/);
});

test('manual logout clears locally, navigates, and launches Main teardown without blocking login', () => {
  const store = read('src/renderer/home/src/stores/auth/auth.store.ts');
  const settings = read(
    'src/renderer/home/src/views/setting/components/GeneralSetting/generalSetting.store.ts'
  );
  const emitter = read('src/renderer/home/src/emitter/auth.emitter.ts');
  const handler = read('src/main/xpc/auth.handler.ts');
  const logout = store.match(/  async logout\(\): Promise<void> \{[\s\S]*?\n  \}/);
  const deactivate = handler.match(
    /  async deactivateSession\(\): Promise<void> \{[\s\S]*?\n  \}(?=\n\n  async invalidateSession)/
  );
  const teardown = handler.match(
    /  private async _deactivateSession\(\): Promise<void> \{[\s\S]*?\n  \}(?=\n\n  private async _closeSecondaryWindows)/
  );
  const staleActivation = handler.match(
    /  private _stopStaleActivation\(generation: number\): boolean \{[\s\S]*?\n  \}(?=\n\n  private async _deactivateSession)/
  );

  assert.ok(logout, 'Missing renderer logout flow');
  assert.ok(deactivate, 'Missing silent Main teardown');
  assert.ok(teardown, 'Missing Main teardown implementation');
  assert.ok(staleActivation, 'Missing stale activation gate');
  assert.ok(
    logout[0].indexOf('this.clearLocalSession()') < logout[0].indexOf('scheduleBestEffort'),
    'local session must clear before remote cleanup is launched'
  );
  assert.match(logout[0], /\(\) => authEmitter\.deactivateSession\(\)/);
  assert.match(logout[0], /scheduleBestEffort\(\(\) => settleBestEffort\(cleanup\)/);
  assert.doesNotMatch(logout[0], /await settleBestEffort/);
  assert.match(settings, /const cleanupPromise = authStore\.logout\(\)/);
  assert.match(settings, /await router\.replace\(\{ name: 'login' \}\)/);
  assert.match(emitter, /import type \{ AuthHandler \} from '@main\/xpc\/auth\.handler'/);
  assert.match(emitter, /createXpcRendererEmitter<AuthHandler>\('AuthHandler'\)/);
  assert.match(teardown[0], /await this\._closeSecondaryWindows\(\)/);
  assert.doesNotMatch(`${deactivate[0]}\n${teardown[0]}`, /xpcMain\.broadcast|auth\/invalidated/);
  assert.match(handler, /private deactivationPromise: Promise<void> \| null = null/);
  assert.ok(
    handler.indexOf('await deactivationPromise.catch') < handler.indexOf('await this._ensureSqliteWindow()'),
    'a newly authenticated session must wait for an older logout teardown'
  );
  assert.doesNotMatch(staleActivation[0], /_closeSecondaryWindows|_deactivateSession/);
  assert.match(staleActivation[0], /generation !== this\.sessionActivationGeneration/);
});

test('completed first-password setup retries only navigation after a route failure', () => {
  const login = read('src/renderer/home/src/views/login/Login.vue');
  const setup = login.match(/const onSetPassword = async \(\): Promise<void> => \{[\s\S]*?\n\};/);

  assert.ok(setup, 'Missing first-password setup handler');
  assert.ok(
    setup[0].indexOf('if (passwordSetupComplete.value)') <
      setup[0].indexOf('if (newPassword.value.length < 8)'),
    'completed setup must take the navigation-only retry path before password validation'
  );
  const completedPath = setup[0].match(
    /if \(passwordSetupComplete\.value\) \{[\s\S]*?\n  \}/
  );
  assert.ok(completedPath, 'Missing completed setup retry path');
  assert.match(completedPath[0], /await redirectAfterLogin\(\)/);
  assert.doesNotMatch(completedPath[0], /changePassword/);
  assert.ok(
    setup[0].indexOf('await authStore.changePassword(newPassword.value)') <
      setup[0].indexOf('passwordSetupComplete.value = true') &&
      setup[0].indexOf('passwordSetupComplete.value = true') <
        setup[0].lastIndexOf('await redirectAfterLogin()'),
    'successful password mutation must be recorded before navigation'
  );
  assert.match(login, /<template v-if="!passwordSetupComplete">/);
  assert.match(login, /i18nHelper\.auth\.continueToWorkspace/);
});

test('General account is flat and login has no eyebrow or panel border', () => {
  const general = read(
    'src/renderer/home/src/views/setting/components/GeneralSetting/GeneralSetting.vue'
  );
  const generalStyle = read(
    'src/renderer/home/src/views/setting/components/GeneralSetting/GeneralSetting.less'
  );
  const login = read('src/renderer/home/src/views/login/Login.vue');
  const loginStyle = read('src/renderer/home/src/views/login/Login.less');

  assert.match(general, /general-setting__account-email/);
  assert.match(general, /i18nHelper\.setting\.general\.account\.logout/);
  assert.doesNotMatch(generalStyle, /general-setting__account[^}]*border:/s);
  assert.doesNotMatch(login, /login-view__mark|login-view__mark-line/);

  const panel = loginStyle.match(/\.login-view__panel \{([\s\S]*?)\n\}/);
  assert.ok(panel, 'Missing login panel style');
  assert.doesNotMatch(panel[0], /border(?:-left)?:/);
  assert.doesNotMatch(loginStyle, /\.login-view__mark/);
});
