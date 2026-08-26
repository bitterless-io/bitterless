/* eslint-disable @typescript-eslint/explicit-function-return-type, no-regex-spaces */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '../..');
const read = (path) => readFileSync(join(root, path), 'utf8');

const requireMatch = (source, pattern, message) => {
  const match = source.match(pattern);
  assert.ok(match, message);
  return match[0];
};

test('cold start, tray, Dock activation, and second instance open Maestro directly', () => {
  const appMain = read('src/main/app.main.ts');
  const createHome = requireMatch(
    appMain,
    /createHome: async \(\) => \{[\s\S]*?\n    \},\n    refreshMcpShim:/,
    'Missing Home-runtime startup stage',
  );
  const trayShow = requireMatch(
    appMain,
    /trayHelper\.init\(\{[\s\S]*?show: \(\) => \{[\s\S]*?\n          \},\n        \}\);/,
    'Missing tray show callback',
  );
  const dockActivation = requireMatch(
    appMain,
    /app\.on\('activate', \(\) => \{[\s\S]*?\n        \}\);/,
    'Missing Dock activation callback',
  );
  const secondInstance = requireMatch(
    appMain,
    /app\.on\('second-instance',[\s\S]*?\n  \}\);\n  void app\.whenReady/,
    'Missing second-instance handler',
  );

  assert.ok(
    createHome.indexOf('mainWindowHelper.create') <
      createHome.indexOf('maestroWindowHandler.openMaestroWindow()'),
    'the hidden Home runtime must exist before Maestro is opened',
  );
  assert.match(trayShow, /maestroWindowHandler\.openMaestroWindow\(\)/);
  assert.match(dockActivation, /maestroWindowHandler\.openMaestroWindow\(\)/);
  assert.match(secondInstance, /maestroWindowHandler\.openMaestroWindow\(\)/);
  assert.doesNotMatch(
    `${createHome}\n${trayShow}\n${dockActivation}\n${secondInstance}`,
    /authHandler|showPrimaryWindow/,
  );
});

test('AuthHandler never reveals legacy Home and all primary paths converge on Maestro', () => {
  const handler = read('src/main/xpc/auth.handler.ts');
  const showHome = requireMatch(
    handler,
    /  async showHomeWindow\(\): Promise<void> \{[\s\S]*?\n  \}/,
    'Missing legacy showHome compatibility entrypoint',
  );
  const showPrimary = requireMatch(
    handler,
    /  async showPrimaryWindow\(\): Promise<void> \{[\s\S]*?\n  \}/,
    'Missing primary-window entrypoint',
  );
  const showMaestro = requireMatch(
    handler,
    /  private async _showMaestroPrimaryWindow\(\): Promise<void> \{[\s\S]*?\n  \}/,
    'Missing single visible-window helper',
  );
  const deactivate = requireMatch(
    handler,
    /  private async _deactivateSession\(\): Promise<void> \{[\s\S]*?\n  \}/,
    'Missing auth teardown',
  );

  assert.doesNotMatch(handler, /mainWindowHelper\.show\s*\(/);
  assert.match(showHome, /await this\._showMaestroPrimaryWindow\(\)/);
  assert.match(showPrimary, /await this\._showMaestroPrimaryWindow\(\)/);
  assert.match(showMaestro, /await maestroWindowHandler\.openMaestroWindow\(\)/);
  assert.match(showMaestro, /finally \{\s+mainWindowHelper\.hide\(\)/);
  assert.ok(
    deactivate.indexOf('await this._closeSecondaryWindows()') <
      deactivate.indexOf('await this._ensureMainWindow()'),
  );
  assert.ok(
    deactivate.indexOf('await this._ensureMainWindow()') <
      deactivate.indexOf('await this._showMaestroPrimaryWindow()'),
  );
  assert.doesNotMatch(handler, /AUTH_ACTIVATION_FAILED_EVENT|recoveryToken|primaryVisibility/);
});

test('legacy Home helper is a hidden-only runtime while detached DevTools remain available', () => {
  const helper = read('src/main/windows/mainWindow.helper.ts');
  const baseHelper = read('src/main/windows/window.helper.ts');
  const showOverride = requireMatch(
    helper,
    /  override show\(\): void \{[\s\S]*?\n  \}/,
    'Missing defensive hidden-only show override',
  );

  assert.match(helper, /protected showOnReady = false/);
  assert.match(helper, /skipTaskbar: true/);
  assert.match(helper, /window\.on\('show',[\s\S]*?window\.hide\(\)/);
  assert.match(showOverride, /this\.hide\(\)/);
  assert.match(baseHelper, /openDevTools\(\{ mode: 'detach' \}\)/);
});

test('renderer auth contract has no recovery coordinator or tokenized visibility handshake', () => {
  const authType = read('src/shared/auth/auth.type.ts');
  const store = read('src/renderer/home/src/stores/auth/auth.store.ts');
  const login = read('src/renderer/home/src/views/login/Login.vue');
  const subscriber = read('src/renderer/home/src/xpc/auth.subscriber.ts');
  const invalidation = requireMatch(
    subscriber,
    /const applyInvalidation = async \(params: AuthInvalidationPayload\): Promise<void> => \{[\s\S]*?\n\};/,
    'Missing renderer invalidation flow',
  );

  assert.match(authType, /activateSession\(\): Promise<void>/);
  assert.match(authType, /showHomeWindow\(\): Promise<void>/);
  assert.doesNotMatch(authType, /Recovery|recovery|AuthActivationResult/);
  assert.match(store, /scheduleBestEffort\(\(\) => authEmitter\.activateSession\(\)/);
  assert.doesNotMatch(`${store}\n${login}\n${subscriber}`, /authActivationRecovery/);
  assert.equal(
    existsSync(join(root, 'src/main/xpc/authPrimaryVisibility.service.ts')),
    false,
  );
  assert.equal(
    existsSync(join(root, 'src/renderer/home/src/xpc/authActivationRecovery.service.ts')),
    false,
  );
  assert.equal(
    existsSync(
      join(root, 'src/renderer/home/src/xpc/authActivationRecoveryCoordinator.service.ts'),
    ),
    false,
  );
  assert.ok(
    invalidation.indexOf("name: 'login'") <
      invalidation.indexOf('authEmitter.deactivateSession()'),
    'renderer must enter Login before starting teardown',
  );
});
