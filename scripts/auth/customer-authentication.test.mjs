import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import {
  AuthHttpError,
  AuthRequestTimeoutError,
  SessionEligibilityError,
  SessionPayloadError,
  activateCustomerToken,
  parseCustomerAuthResult,
  parseCurrentCustomerSession,
  runWithAuthRequestTimeout,
  scheduleBestEffort,
  settleBestEffort,
  shouldApplyAuthInvalidation,
  shouldInvalidateCustomerSession,
} from '../../src/renderer/home/src/stores/auth/authSession.service.ts';
import { TodoistSyncActivationService } from '../../src/renderer/home/src/stores/auth/todoistSyncActivation.service.ts';
import {
  CORE_SQLITE_TARGET_PRELOAD_REGISTERED_EVENT,
  readCoreSqliteTargetPreloadRegistration,
} from '../../src/shared/sqlite/coreSqliteRuntime.shared.ts';

const root = resolve(import.meta.dirname, '../..');
const read = (path) => readFileSync(join(root, path), 'utf8');

const CURRENT_PROD_CORE_URL = 'https://prod-bitterless-hcqmtqwtox.cn-shanghai.fcapp.run';

test('customer session payload requires the complete protected-route contract', () => {
  const valid = {
    id: 7,
    email: 'customer@example.com',
    nickname: null,
    scope: 'customer',
    status: 'active',
    has_password: true,
    must_set_password: false,
  };
  assert.deepEqual(parseCurrentCustomerSession(valid), valid);

  for (const invalid of [
    null,
    { status: 'active' },
    { ...valid, id: 0 },
    { ...valid, email: '' },
    { ...valid, scope: 'admin' },
    { ...valid, status: 'unknown' },
    { ...valid, has_password: 'yes' },
    { ...valid, must_set_password: undefined },
  ]) {
    assert.throws(() => parseCurrentCustomerSession(invalid), SessionPayloadError);
  }
});

test('password and OTP success payloads require a non-empty customer token contract', () => {
  const valid = {
    token: 'signed-token',
    scope: 'customer',
    email: ' customer@example.com ',
  };
  assert.deepEqual(parseCustomerAuthResult(valid), {
    ...valid,
    email: 'customer@example.com',
  });

  for (const invalid of [
    null,
    {},
    { ...valid, token: undefined },
    { ...valid, token: '' },
    { ...valid, token: ' signed-token ' },
    { ...valid, scope: 'admin' },
    { ...valid, email: ' ' },
  ]) {
    assert.throws(() => parseCustomerAuthResult(invalid), SessionPayloadError);
  }

  const api = read('src/renderer/home/src/networking/auth.api.ts');
  const tokenService = read('src/renderer/home/src/stores/auth/authToken.service.ts');
  assert.equal((api.match(/parseCustomerAuthResult\(/g) ?? []).length, 2);
  assert.match(tokenService, /typeof token !== 'string'/);
});

test('new tokens persist through transient validation and clear on authoritative rejection', async () => {
  const transientError = new AuthHttpError(503, 'Core unavailable');
  let persistedToken = null;
  let invalidatedToken = null;
  let revokedToken = null;

  await assert.rejects(
    activateCustomerToken({
      token: 'transient-token',
      persist: (token) => {
        persistedToken = token;
      },
      validate: async () => {
        throw transientError;
      },
      invalidate: (token) => {
        invalidatedToken = token;
      },
      revoke: async (token) => {
        revokedToken = token;
      },
    }),
    transientError,
  );
  assert.equal(persistedToken, 'transient-token');
  assert.equal(invalidatedToken, null);
  assert.equal(revokedToken, null);

  const rejectedError = new AuthHttpError(401, 'Invalid token');
  await assert.rejects(
    activateCustomerToken({
      token: 'rejected-token',
      persist: (token) => {
        persistedToken = token;
      },
      validate: async () => {
        throw rejectedError;
      },
      invalidate: (token) => {
        invalidatedToken = token;
      },
      revoke: async (token) => {
        revokedToken = token;
      },
    }),
    rejectedError,
  );
  assert.equal(persistedToken, 'rejected-token');
  assert.equal(invalidatedToken, 'rejected-token');
  assert.equal(revokedToken, 'rejected-token');
});

test('auth requests time out with an abort signal and accept explicit cancellation', async () => {
  let timedOutSignalAborted = false;
  let responseHeadersResolved = false;
  await assert.rejects(
    runWithAuthRequestTimeout(
      async (signal) => {
        await Promise.resolve();
        responseHeadersResolved = true;
        return await new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            timedOutSignalAborted = signal.aborted;
            reject(signal.reason);
          }, { once: true });
        });
      },
      5,
    ),
    AuthRequestTimeoutError,
  );
  assert.equal(responseHeadersResolved, true);
  assert.equal(timedOutSignalAborted, true);

  const controller = new AbortController();
  const cancellation = new Error('cancelled by user');
  const request = runWithAuthRequestTimeout(
    async (signal) => await new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }),
    1_000,
    controller.signal,
  );
  controller.abort(cancellation);
  await assert.rejects(request, (error) => error === cancellation);
});

test('auth invalidation applies only to the exact current session identity', () => {
  assert.equal(shouldApplyAuthInvalidation('session-b', 'session-b'), true);
  assert.equal(shouldApplyAuthInvalidation('session-b', 'session-a'), false);
  assert.equal(shouldApplyAuthInvalidation('session-b', undefined), false);
  assert.equal(shouldApplyAuthInvalidation(null, 'session-a'), false);

  const api = read('src/renderer/home/src/networking/auth.api.ts');
  const handler = read('src/main/xpc/auth.handler.ts');
  const subscriber = read('src/renderer/home/src/xpc/auth.subscriber.ts');
  const login = read('src/renderer/home/src/views/login/Login.vue');
  const router = read('src/renderer/home/src/router/index.ts');
  const invalidation = handler.match(
    /  async invalidateSession\([\s\S]*?\n  \}(?=\n\n  private async _ensureMainWindow)/,
  );

  assert.ok(invalidation, 'Missing Main invalidation relay');
  assert.match(api, /getCustomerSessionIdForToken\(token\)/);
  assert.match(api, /runWithAuthRequestTimeout/);
  assert.doesNotMatch(
    invalidation[0],
    /_closeSecondaryWindows|lockForAuthInvalidation|sessionShouldBeActive\s*=\s*false/,
  );
  assert.ok(
    subscriber.indexOf('shouldApplyAuthInvalidation') <
      subscriber.indexOf('authStore.clearLocalSession()'),
    'renderer must fence stale invalidation before clearing the current token',
  );
  assert.match(subscriber, /authEmitter\.deactivateSession\(\)/);
  assert.match(login, /sessionRecoveryAbortController/);
  assert.match(login, /authStore\.restoreSession\(controller\.signal\)/);
  const cancel = login.match(
    /const onCancelSessionRecovery = \(\): void => \{[\s\S]*?\n\};/,
  );
  const discard = login.match(
    /const onDiscardPersistedSession = async \(\): Promise<void> => \{[\s\S]*?\n\};/,
  );
  assert.ok(cancel, 'Missing non-destructive recovery cancellation');
  assert.ok(discard, 'Missing explicit saved-session discard');
  assert.match(cancel[0], /sessionRecoveryAbortController\?\.abort\(\)/);
  assert.match(cancel[0], /authStore\.cancelSessionRecovery\(\)/);
  assert.doesNotMatch(cancel[0], /logout|clearLocalSession/);
  assert.match(discard[0], /transitioning\.value/);
  assert.match(discard[0], /await authStore\.logout\(\)/);
  assert.match(router, /router\.beforeResolve/);
  assert.match(router, /!authStore\.isAuthenticated\(\)/);
  assert.ok(
    api.indexOf('return await parseResponse<T>') > api.indexOf('runWithAuthRequestTimeout'),
    'response parsing must remain inside the timeout operation',
  );
});

test('saved customer sessions survive transient restore failures', () => {
  assert.equal(
    shouldInvalidateCustomerSession(new AuthHttpError(401, 'Invalid token')),
    true,
  );
  assert.equal(
    shouldInvalidateCustomerSession(new SessionEligibilityError('Account inactive')),
    true,
  );
  assert.equal(
    shouldInvalidateCustomerSession(new AuthHttpError(500, 'Core unavailable')),
    false,
  );
  assert.equal(
    shouldInvalidateCustomerSession(new AuthHttpError(403, 'Unexpected policy response')),
    false,
  );
  assert.equal(
    shouldInvalidateCustomerSession(new SessionPayloadError('Invalid customer payload')),
    false,
  );
  assert.equal(shouldInvalidateCustomerSession(new TypeError('Failed to fetch')), false);

  const api = read('src/renderer/home/src/networking/auth.api.ts');
  const store = read('src/renderer/home/src/stores/auth/auth.store.ts');
  const router = read('src/renderer/home/src/router/index.ts');
  const login = read('src/renderer/home/src/views/login/Login.vue');
  const activateToken = store.match(
    / {2}private async activateToken\([\s\S]*?\n {2}\}(?=\n\n {2}async loginWithPassword)/
  );
  const fetchMe = store.match(
    / {2}async fetchMe\([\s\S]*?\n {2}\}(?=\n\n {2}async restoreSession)/
  );
  const restoreGuard = router.match(
    / {2}if \(!authStore\.current\) \{[\s\S]*?\n {2}\}/
  );
  const mountedRestore = login.match(/onMounted\(async \(\) => \{[\s\S]*?\n\}\);/);

  assert.ok(activateToken, 'Missing token activation flow');
  assert.ok(fetchMe, 'Missing saved-session validation flow');
  assert.ok(restoreGuard, 'Missing Router restore guard');
  assert.ok(mountedRestore, 'Missing Login restore flow');
  assert.match(api, /throw new AuthHttpError\(res\.status, message\)/);
  assert.match(activateToken[0], /activateCustomerToken\(\{/);
  assert.match(fetchMe[0], /shouldInvalidateCustomerSession\(err\)/);
  assert.doesNotMatch(restoreGuard[0], /clearLocalSession/);
  assert.doesNotMatch(mountedRestore[0], /clearLocalSession/);
  assert.match(login, /sessionRecoveryVisible/);
  assert.match(login, /onRetrySession/);
  assert.match(login, /onDiscardPersistedSession/);
});

test('login, authenticated layout, and initial Home view use the entry bundle', () => {
  const routes = read('src/renderer/home/src/router/defaultRoutes.ts');

  assert.match(routes, /import Chat from '@\/views\/chat\/Chat\.vue';/);
  assert.match(routes, /import Layout from '@\/views\/layout\/Layout\.vue';/);
  assert.match(routes, /import Login from '@\/views\/login\/LegacyLogin\.vue';/);
  assert.match(
    read('src/renderer/home/src/views/login/LegacyLogin.vue'),
    /import Login from '\.\/Login\.vue';/,
  );
  assert.doesNotMatch(
    routes,
    /import\('@\/views\/(?:chat\/Chat|layout\/Layout|login\/(?:Legacy)?Login)\.vue'\)/
  );
  assert.match(routes, /path: 'chat',\n    name: 'chat',\n    component: Chat,/);
  assert.match(routes, /path: '\/login',\n    name: 'login',\n    component: Login,/);
  assert.match(routes, /const defaultHomePath = '\/chat'/);
  assert.match(routes, /path: '\/',\n    component: Layout,\n    redirect: defaultHomePath,/);

  for (const view of ['debug/Debug', 'plugins/pluginTest/PluginTest']) {
    assert.match(routes, new RegExp(`component: \\(\\) => import\\('@/views/${view}\\.vue'\\)`));
  }
  assert.doesNotMatch(routes, /miniApp\/MiniApp|connector\/Connector|setting\/Setting/);
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
  const todoActivation = store.match(
    /  private activateTodoistSync\([\s\S]*?\n  \}(?=\n\n  private activateAuthenticatedSession)/
  );
  const readiness = store.match(
    /  async ensureTodoistSyncReady\([\s\S]*?\n  \}(?=\n\n  onTodoistSyncRuntimeRegistered)/
  );
  const restore = store.match(
    /  async restoreSession\([\s\S]*?\n  \}(?=\n\n  clearLocalSession)/
  );

  assert.ok(createDeviceId, 'Missing installation device ID factory');
  assert.ok(passwordLogin, 'Missing password login flow');
  assert.ok(otpLogin, 'Missing OTP login flow');
  assert.ok(activation, 'Missing authenticated Todo activation flow');
  assert.ok(todoActivation, 'Missing dedicated Todo activation flow');
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
  assert.match(
    todoActivation[0],
    /getTodoistSyncActivateParams\(current, getCustomerToken\(\), this\.deviceId\)/,
  );
  assert.match(activation[0], /this\.activateTodoistSync\(current\)/);
  assert.match(
    readiness[0],
    /getTodoistSyncActivateParams\(current, getCustomerToken\(\), this\.deviceId\)/,
  );
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
    activateToken[0].indexOf('persist: setCustomerToken') <
      activateToken[0].indexOf('this.activateAuthenticatedSession(current, previousSessionId)'),
    'validated Core session must commit before optional runtime activation'
  );
  assert.doesNotMatch(activateToken[0], /await this\.activateAuthenticatedSession/);
  assert.ok(
    activateToken[0].indexOf('const previousSessionId = getCustomerSessionId()') <
      activateToken[0].indexOf('persist: setCustomerToken'),
    'replacement must capture the old session before persisting the new token',
  );
  assert.match(activation[0], /snipingSessionActivation\.replace\(/);
  assert.match(activation[0], /previousSessionId !== sessionId/);
  assert.match(activation[0], /scheduleBestEffort\(\(\) => activation/);
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

test('Todo readiness deduplicates, rejects absent activation results, retries failure, and fences logout/account changes', async () => {
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

test('Core SQLite runtime generations ignore duplicates and fence pending Todo activation', async () => {
  const params = { coreToken: 'token-a', customerId: 1, deviceId: 'session-device-0001' };
  const pendingActivations = [];
  const activation = new TodoistSyncActivationService(
    async () => await new Promise((resolvePromise) => {
      pendingActivations.push(resolvePromise);
    }),
  );

  assert.equal(activation.registerRuntimeTarget('sqlite-generation-a'), true);
  assert.equal(activation.registerRuntimeTarget('sqlite-generation-a'), false);
  assert.throws(() => activation.registerRuntimeTarget('  '), /target ID is required/);

  const stale = activation.start(params);
  assert.equal(activation.registerRuntimeTarget('sqlite-generation-b'), true);
  const recovered = activation.start(params);
  assert.notEqual(recovered, stale);
  assert.equal(pendingActivations.length, 2);

  pendingActivations[0]({
    status: 'active',
    customerId: params.customerId,
    deviceId: params.deviceId,
    sessionGeneration: 1,
  });
  await assert.rejects(() => stale, /superseded/);

  pendingActivations[1]({
    status: 'active',
    customerId: params.customerId,
    deviceId: params.deviceId,
    sessionGeneration: 1,
  });
  await recovered;
});

test('Home observes browser-safe Core SQLite registrations before loading App and router', () => {
  const main = read('src/renderer/home/src/main.ts');
  const subscriber = read('src/renderer/home/src/xpc/todoistSyncRuntime.subscriber.ts');
  const store = read('src/renderer/home/src/stores/auth/auth.store.ts');
  const recovery = store.match(
    /  onTodoistSyncRuntimeRegistered\([\s\S]*?\n  \}(?=\n\n  private activateTodoistSync)/,
  );

  assert.equal(
    CORE_SQLITE_TARGET_PRELOAD_REGISTERED_EVENT,
    'core-sqlite/target-preload-registered',
  );
  assert.deepEqual(
    readCoreSqliteTargetPreloadRegistration({ targetId: 'sqlite-generation-a' }),
    { targetId: 'sqlite-generation-a' },
  );
  assert.equal(readCoreSqliteTargetPreloadRegistration({ targetId: '  ' }), null);
  assert.equal(readCoreSqliteTargetPreloadRegistration(null), null);

  assert.ok(
    main.indexOf('initTodoistSyncRuntimeSubscriber();') < main.indexOf("import('./App.vue')"),
    'Core SQLite runtime subscriber must initialize before the dynamic Home application imports',
  );
  assert.match(
    subscriber,
    /xpcRenderer\.subscribe\([\s\S]*CORE_SQLITE_TARGET_PRELOAD_REGISTERED_EVENT/,
  );
  assert.match(subscriber, /readCoreSqliteTargetPreloadRegistration\(payload\.params\)/);
  assert.match(subscriber, /authStore\.onTodoistSyncRuntimeRegistered\(registration\.targetId\)/);
  assert.ok(recovery, 'Missing Home Todo runtime generation recovery');
  assert.match(recovery[0], /this\.todoistSyncActivation\.registerRuntimeTarget\(targetId\)/);
  assert.match(recovery[0], /this\.activateTodoistSync\(current\)/);
  assert.doesNotMatch(recovery[0], /activateAuthenticatedSession|authEmitter/);
});

test('both Home Todo entry points await readiness before creating Todo content', () => {
  const embedded = read('src/renderer/home/src/views/todo/Todo.vue');
  const miniApp = read('src/renderer/home/src/views/miniApp/MiniApp.vue');
  const homeShellBridge = read('src/renderer/home/src/xpc/homeShellBridge.handler.ts');
  assert.ok(
    embedded.indexOf('await authStore.ensureTodoistSyncReady()') <
      embedded.indexOf('await todoWindowEmitter.showTodoView()'),
  );
  assert.match(miniApp, /await homeShellBridge\.openTodo\(\)/);
  assert.ok(
    homeShellBridge.indexOf('await authStore.ensureTodoistSyncReady()') <
      homeShellBridge.indexOf('await todoWindowEmitter.openTodoWindow()'),
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
  assert.match(
    login,
    /:disabled="\s*authStore\.loading \|\| authStore\.checking \|\| authStore\.loggingOut \|\| transitioning\s*"/,
  );
});

test('manual logout clears locally, navigates, and launches Main teardown without blocking login', () => {
  const store = read('src/renderer/home/src/stores/auth/auth.store.ts');
  const settings = read(
    'src/renderer/home/src/views/setting/components/AccountSetting/accountSetting.store.ts'
  );
  const homeShellClient = read('src/renderer/common/homeShellBridge.client.ts');
  const homeShellHandler = read('src/renderer/home/src/xpc/homeShellBridge.handler.ts');
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
    /  private _stopStaleActivation\(generation: number\): boolean \{[\s\S]*?\n  \}/
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
  assert.match(logout[0], /scheduleBestEffort\(async \(\) => \{/);
  assert.match(logout[0], /await settleBestEffort\(\[[\s\S]*cleanup/);
  assert.ok(
    logout[0].indexOf('scheduleBestEffort') < logout[0].indexOf('await settleBestEffort'),
    'Main teardown and remote cleanup must settle only inside the deferred operation'
  );
  assert.match(settings, /await homeShellBridge\.logout\(\)/);
  assert.match(homeShellHandler, /const cleanup = authStore\.prepareExternalLogout\(\)/);
  assert.match(homeShellHandler, /await router\.replace\(\{ name: 'login' \}\)/);
  assert.ok(
    homeShellClient.indexOf('homeShellEmitter.prepareLogout()') <
      homeShellClient.indexOf('authSessionEmitter.deactivateSession()'),
    'Home must enter Login before Main resets auth-scoped runtimes during teardown'
  );
  assert.match(emitter, /import type \{ AuthSessionApi \} from '@shared\/auth\/auth\.type'/);
  assert.match(emitter, /createXpcRendererEmitter<AuthSessionApi>\('AuthHandler'\)/);
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

test('Settings Account is flat and login has no eyebrow or panel border', () => {
  const account = read(
    'src/renderer/home/src/views/setting/components/AccountSetting/AccountSetting.vue'
  );
  const accountStyle = read(
    'src/renderer/home/src/views/setting/components/AccountSetting/AccountSetting.less'
  );
  const general = read(
    'src/renderer/home/src/views/setting/components/GeneralSetting/GeneralSetting.vue'
  );
  const login = read('src/renderer/home/src/views/login/Login.vue');
  const loginStyle = read('src/renderer/home/src/views/login/Login.less');

  assert.match(account, /account-setting__email/);
  assert.match(account, /i18nHelper\.setting\.account\.logout/);
  assert.doesNotMatch(accountStyle, /(?:border|background|box-shadow)\s*:/);
  assert.doesNotMatch(general, /general-setting__account|setting\.general\.account/);
  assert.doesNotMatch(login, /login-view__mark|login-view__mark-line/);

  const panel = loginStyle.match(/\.login-view__panel \{([\s\S]*?)\n\}/);
  assert.ok(panel, 'Missing login panel style');
  assert.doesNotMatch(panel[0], /border(?:-left)?:/);
  assert.doesNotMatch(loginStyle, /\.login-view__mark/);
});
