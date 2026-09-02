/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  HOME_SHELL_AUTH_ERROR_MESSAGES,
  HOME_SHELL_INITIAL_AUTH_PROBE,
  getHomeShellInitialAuthProbeUpperBoundMs,
  isHomeShellAuthSnapshotNewer,
  parseHomeShellAuthCommandResult,
  parseHomeShellAuthSnapshot
} from '../../src/shared/home/homeShellBridge.contract.ts';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
const source = (relativePath) => readFileSync(join(projectRoot, relativePath), 'utf8');

const signedOutSnapshot = {
  authorityEpoch: 100,
  revision: 1,
  phase: 'signed-out',
  email: null,
  loading: false,
  loggingOut: false,
  sendingOtp: false,
  resettingPassword: false
};

test('Home auth bridge snapshots and results are strict and token-free', () => {
  assert.deepEqual(parseHomeShellAuthSnapshot(signedOutSnapshot), signedOutSnapshot);
  assert.deepEqual(parseHomeShellAuthCommandResult({ ok: true, snapshot: signedOutSnapshot }), {
    ok: true,
    snapshot: signedOutSnapshot
  });
  assert.equal(
    isHomeShellAuthSnapshotNewer({ ...signedOutSnapshot, revision: 2 }, signedOutSnapshot),
    true
  );
  assert.equal(
    isHomeShellAuthSnapshotNewer({ ...signedOutSnapshot, authorityEpoch: 101 }, signedOutSnapshot),
    true
  );
  assert.equal(
    isHomeShellAuthSnapshotNewer({ ...signedOutSnapshot, revision: 1 }, signedOutSnapshot),
    false
  );
  assert.equal(
    isHomeShellAuthSnapshotNewer(
      { ...signedOutSnapshot, authorityEpoch: 99, revision: 999 },
      signedOutSnapshot
    ),
    false
  );
  assert.throws(() => parseHomeShellAuthSnapshot({ ...signedOutSnapshot, authorityEpoch: 0 }));
  assert.throws(() => parseHomeShellAuthSnapshot({ ...signedOutSnapshot, revision: 1.5 }));
  assert.throws(() => parseHomeShellAuthSnapshot({ ...signedOutSnapshot, token: 'secret' }));
  assert.throws(() =>
    parseHomeShellAuthCommandResult({
      ok: false,
      snapshot: signedOutSnapshot,
      error: { code: 'auth-failed', message: 'RAW_SENTINEL /Users/private/backend.log' }
    })
  );
  assert.deepEqual(
    parseHomeShellAuthCommandResult({
      ok: false,
      snapshot: signedOutSnapshot,
      error: { code: 'auth-failed', message: HOME_SHELL_AUTH_ERROR_MESSAGES.failed }
    }),
    {
      ok: false,
      snapshot: signedOutSnapshot,
      error: { code: 'auth-failed', message: HOME_SHELL_AUTH_ERROR_MESSAGES.failed }
    }
  );
  assert.throws(() =>
    parseHomeShellAuthCommandResult({
      ok: false,
      snapshot: signedOutSnapshot,
      error: {
        code: 'auth-failed',
        message: HOME_SHELL_AUTH_ERROR_MESSAGES.failed,
        rawCustomer: {}
      }
    })
  );
});

test('fixed Home subscribes before its initial auth read and fails closed', () => {
  const main = source('src/renderer/maestro/localHome/src/main.ts');
  const store = source('src/renderer/maestro/localHome/src/localHomeAuth.store.ts');
  const app = source('src/renderer/maestro/localHome/src/LocalHomeApp.vue');
  const router = source('src/renderer/maestro/localHome/src/localHome.router.ts');
  const client = source('src/renderer/common/homeShellBridge.client.ts');

  assert.ok(
    main.indexOf('localHomeAuthStore.initialize()') < main.indexOf('createApp(LocalHomeApp)')
  );
  assert.ok(
    store.indexOf('homeShellBridge.subscribeAuthSnapshot') <
      store.indexOf('void this.refreshAuthSnapshot()')
  );
  assert.equal(HOME_SHELL_INITIAL_AUTH_PROBE.timeoutMs, 500);
  assert.equal(getHomeShellInitialAuthProbeUpperBoundMs(), 4_250);
  assert.ok(getHomeShellInitialAuthProbeUpperBoundMs() <= 6_000);
  assert.match(store, /getAuthSnapshot\(\s*HOME_SHELL_INITIAL_AUTH_PROBE\.timeoutMs\s*\)/);
  assert.match(client, /async getAuthSnapshot\(timeoutMs = HOME_SHELL_CALL_TIMEOUT_MS\)/);
  assert.match(store, /authorityUnavailable = true/);
  assert.match(store, /isHomeShellAuthSnapshotNewer\(snapshot, this\.latestAcceptedSnapshot\)/);
  assert.match(store, /this\.snapshot = null;[\s\S]*void this\.refreshAuthSnapshot\(\)/);
  assert.match(client, /catch \{\s*onInvalidSnapshot\(\);\s*\}/);
  assert.ok(
    app.indexOf('v-if="!localHomeAuthStore.authResolved"') <
      app.indexOf('v-else-if="!localHomeAuthStore.ready"') &&
      app.indexOf('v-else-if="!localHomeAuthStore.ready"') < app.indexOf('<a-layout v-else')
  );
  assert.match(app, /<Login v-else-if="!localHomeAuthStore.ready"/);
  assert.match(router, /path: '\/', name: 'auth-gate'/);
  assert.doesNotMatch(router, /path: '\/', redirect: '\/mini-app'/);
  assert.match(app, /const becameReady = ready && wasReady === false/);
  assert.match(app, /!becameReady && !isAuthGate/);
  assert.match(app, /routeName === 'mini-app'/);
});

test('fixed Home keeps credentials and tokens inside the hidden Home authority', () => {
  const app = source('src/renderer/maestro/localHome/src/LocalHomeApp.vue');
  const store = source('src/renderer/maestro/localHome/src/localHomeAuth.store.ts');
  const handler = source('src/renderer/home/src/xpc/homeShellBridge.handler.ts');
  const token = source('src/renderer/home/src/stores/auth/authToken.service.ts');
  const preload = source('src/preload/maestro/localHome.preload.ts');

  assert.doesNotMatch(`${app}\n${store}`, /auth\.store|networking\/auth|localStorage|fetch\(/);
  assert.match(store, /homeShellBridge\.loginWithPassword\(\{ email, password \}\)/);
  assert.match(handler, /authStore\.loginWithPassword\(request\.email, request\.password\)/);
  assert.match(handler, /HOME_SHELL_AUTH_SNAPSHOT_CHANGED_EVENT/);
  assert.match(handler, /revision: \+\+authSnapshotRevision/);
  assert.match(handler, /customerAuthPresentationRevision\.value/);
  assert.match(handler, /flush: 'sync'/);
  assert.doesNotMatch(handler, /error\.message\.trim|\.slice\(0, 300\)/);
  assert.match(token, /markCustomerAuthPresentationChanged\(\)/);
  assert.doesNotMatch(preload, /contextBridge|auth|token|sessionStorage|localStorage/);
  assert.match(preload, /import 'electron-xpc\/preload'/);
});

test('legacy and Maestro Home reuse one complete Login surface', () => {
  const routes = source('src/renderer/home/src/router/defaultRoutes.ts');
  const legacy = source('src/renderer/home/src/views/login/LegacyLogin.vue');
  const local = source('src/renderer/maestro/localHome/src/LocalHomeApp.vue');
  const login = source('src/renderer/home/src/views/login/Login.vue');
  const recovery = source('src/renderer/home/src/stores/auth/authSessionRecovery.service.ts');
  const router = source('src/renderer/home/src/router/index.ts');

  assert.match(routes, /import Login from '@\/views\/login\/LegacyLogin\.vue'/);
  assert.match(legacy, /import Login from '\.\/Login\.vue'/);
  assert.match(local, /import Login from '@\/views\/login\/Login\.vue'/);
  assert.match(login, /onSendOtp/);
  assert.match(login, /onResetPassword/);
  assert.match(login, /onSetPassword/);
  assert.match(login, /onDiscardPersistedSession/);
  assert.match(legacy, /handlesPostAuthNavigation: true/);
  assert.match(
    source('src/renderer/maestro/localHome/src/localHomeAuth.store.ts'),
    /handlesPostAuthNavigation = false/
  );
  assert.match(local, /:auth="localHomeAuthStore"/);
  assert.match(login, /if \(!authStore\.handlesPostAuthNavigation\) return/);
  assert.match(login, /NavigationFailureType\.duplicated/);
  assert.match(router, /restoreCustomerSession\(\)/);
  assert.match(recovery, /activeSessionRecovery \?\? startSessionRecovery\(\)/);
  const consumerRestore = recovery.match(
    /export const restoreCustomerSession =[\s\S]*?\n\};(?=\n\nexport const cancelCustomerSessionRecovery)/
  );
  assert.ok(consumerRestore);
  assert.match(consumerRestore[0], /Promise\.race\(\[active\.promise, consumerCancelled\]\)/);
  assert.doesNotMatch(consumerRestore[0], /active\.controller\.abort/);
  assert.match(recovery, /activeSessionRecovery\?\.controller\.abort/);
});
