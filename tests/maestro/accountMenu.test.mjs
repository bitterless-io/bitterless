import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EventEmitter } from 'node:events';
import ts from 'typescript';
const root = resolve(import.meta.dirname, '../..');
const read = path => readFileSync(resolve(root, path), 'utf8');
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const methods = (path, names, bindings = {}) => {
  const source = ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true);
  const members = source.statements.filter(ts.isClassDeclaration).flatMap(c => [...c.members]).filter(m => names.includes(m.name?.getText(source)));
  assert.equal(members.length, names.length);
  const code = ts.transpileModule('class Subject {' + members.map(m => m.getText(source)).join('\n') + '}', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new (new Function(...Object.keys(bindings), code + ';return Subject;')(...Object.values(bindings)))();
};
import { createRequire } from 'node:module';
const nativeRequire = createRequire(import.meta.url);
const load = (path, stubs = {}) => {
  const code = ts.transpileModule(read(path), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', '__dirname', code)(name => stubs[name] ?? nativeRequire(name), module, module.exports, '/app/out/main');
  return module.exports;
};
test('password form validates locally, prevents duplicate requests and clears password values on success', async () => {
  const wait = deferred(), sent = [];
  const { changePasswordStore: store } = load('src/renderer/maestro/localHome/src/changePassword.store.ts', { vue: { reactive: v => v }, 'electron-xpc/renderer': { createXpcRendererEmitter: () => ({ changeAiCrmsPassword: async p => { sent.push(p.password); await wait.promise; } }) }, '@renderer/common/homeShellBridge.client': { homeShellBridge: { changePassword: async p => { sent.push(p.newPassword); await wait.promise; return { ok: true }; } } } });
  store.password = 'short'; store.confirmation = 'short'; await store.submit();
  assert.equal(store.error, 'passwordPolicy'); assert.deepEqual(sent, []);
  store.password = 'validPass123'; store.confirmation = 'different'; await store.submit();
  assert.equal(store.error, 'passwordMismatch');
  store.confirmation = store.password;
  const changing = store.submit(); await store.submit();
  assert.deepEqual(sent, ['validPass123']);
  wait.resolve(); await changing;
  assert.equal(store.password, ''); assert.equal(store.confirmation, ''); assert.equal(store.pending, false); assert.equal(store.error, '');
});

test('account navigation reuses Home and creates a closable Home when a different miniapp is pinned', async () => {
  const loaded = [], active = [];
  const tab = { id: 'home', kind: 'home', pinned: true, view: { webContents: { isDestroyed: () => false, loadFile: async (...args) => loaded.push(args) } } };
  const browser = methods('src/main/maestro/windows/main/maestroBrowserView.service.ts', ['openAccountPassword'], { localHomeEntry: () => ({ file: '/app/home.html', url: 'file:///app/home.html' }) });
  let created = 0;
  Object.assign(browser, { tabs: [tab], ensureWarm: async () => {}, activateTab: async ({ id }) => active.push(id), broadcastTabs() {}, buildPinnedLocalHomeTab: () => { created++; return tab; } });
  await browser.openAccountPassword(); assert.equal(created, 0); assert.deepEqual(loaded[0], ['/app/home.html', { hash: '/account/password' }]);
  browser.tabs = [{ id: 'preview', kind: 'onlypreview', pinned: true }];
  await browser.openAccountPassword(); assert.equal(created, 1); assert.equal(browser.tabs[0].pinned, true); assert.equal(browser.tabs[1].pinned, false); assert.deepEqual(active, ['home', 'home']);
});

test('password response cannot reactivate an account cleared or replaced while awaiting the server', async () => {
  for (const phase of ['update', 'profile']) {
    let token = 'original', activated = 0;
    const updating = deferred(), validating = deferred();
    const store = methods('src/renderer/home/src/stores/auth/auth.store.ts', ['changePassword', 'fetchMe'], {
      getCustomerToken: () => token, changePasswordApi: () => updating.promise,
      customerNeedsPasswordSetup: () => false, SessionPayloadError: Error, shouldInvalidateCustomerSession: () => false, Message: { error() {} }
    });
    store.fetchValidatedCustomer = () => validating.promise;
    store.activateAuthenticatedSession = () => { activated++; };
    const result = store.changePassword('validPass123');
    if (phase === 'update') token = null;
    updating.resolve(); await Promise.resolve();
    if (phase === 'profile') token = 'replacement';
    validating.resolve({ status: 'active' });
    await assert.rejects(result, /Session changed|登录状态已变更/); assert.equal(activated, 0); assert.equal(store.current, undefined);
  }
});

test('logout uses XPC to invalidate Control, clear the authority, and refresh every subscribed miniapp', async () => {
  const contract = load('src/shared/home/homeShellBridge.contract.ts');
  const callbacks = {}, calls = [], received = [];
  let token = 'fixture';
  let snapshot = { authorityEpoch: 1, revision: 1, phase: 'ready', email: 'test@example.invalid', loading: false, loggingOut: false, sendingOtp: false, resettingPassword: false };
  const emitters = {
    ApplicationAuthHandler: { invalidate: async () => calls.push('invalidate') },
    HomeShellBridgeHandler: {
      getAuthSnapshot: async () => snapshot,
      prepareLogout: async () => {
        token = null; calls.push('clear');
        snapshot = { ...snapshot, revision: 2, phase: 'signed-out', email: null };
        callbacks[contract.HOME_SHELL_AUTH_SNAPSHOT_CHANGED_EVENT]({ params: snapshot });
        return { ok: true };
      }
    },
    AuthHandler: { deactivateSession: async () => calls.push('deactivate') },
    CoachXpcHandler: {}
  };
  const { homeShellBridge: bridge } = load('src/renderer/common/homeShellBridge.client.ts', {
    '@shared/home/homeShellBridge.contract': contract,
    'electron-xpc/renderer': { createXpcRendererEmitter: name => emitters[name], xpcRenderer: { subscribe: (name, callback) => { callbacks[name] = callback; } } }
  });
  bridge.subscribeAuthSnapshot(value => received.push(value), () => assert.fail('invalid auth snapshot'));
  await bridge.logout(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(token, null);
  assert.deepEqual(calls, ['invalidate', 'clear', 'deactivate']);
  assert.equal(received.at(-1).phase, 'signed-out');
  assert.equal(received.at(-1).email, null);
});

test('password update applies the validated profile to the same signed-in session', async () => {
  const current = { status: 'active', email: 'test@example.invalid' }, activated = [];
  const store = methods('src/renderer/home/src/stores/auth/auth.store.ts', ['changePassword', 'fetchMe'], {
    getCustomerToken: () => 'fixture', changePasswordApi: async () => {},
    customerNeedsPasswordSetup: () => false, SessionPayloadError: Error, shouldInvalidateCustomerSession: () => false, Message: { error() {} }
  });
  store.fetchValidatedCustomer = async () => current;
  store.activateAuthenticatedSession = value => activated.push(value);
  await store.changePassword('validPass123');
  assert.equal(store.current, current); assert.deepEqual(activated, [current]); assert.equal(store.loading, false);
});

const menuLabels = { unavailable: 'No email', signedOut: 'Not signed in', changePassword: 'Change password', logout: 'Log out' };
const nativeMenu = () => {
  let template, popupOptions;
  const { showAccountMenu } = load('src/main/maestro/windows/main/accountMenu.service.ts', {
    electron: { Menu: { buildFromTemplate: items => { template = items; return { popup: options => { popupOptions = options; } }; } } },
    '@main/i18n/nativeMessages': { getNativeMessages: () => ({ accountMenu: menuLabels }) },
    '@main/i18n/i18n.helper': { i18nHelper: { getMessages: () => ({ setting: { account: menuLabels } }) } }
  });
  const window = new EventEmitter(); window.isDestroyed = () => false;
  return { showAccountMenu, window, template: () => template, options: () => popupOptions };
};

test('native account menu presents the four requested rows and returns each selected action', async () => {
  for (const [index, action] of [[1, 'workbench'], [2, 'password'], [3, 'logout']]) {
    const f = nativeMenu();
    const result = f.showAccountMenu(f.window, { x: 400.4, y: 58.2, email: 'test@example.invalid', signedIn: true });
    assert.deepEqual(f.template().map(item => item.label), ['test@example.invalid', 'Workbench', 'Change password', 'Log out']);
    assert.equal(f.template()[0].enabled, false);
    assert.equal(f.template()[0].click, undefined);
    assert.equal(f.options().window, f.window); assert.equal(f.options().x, 400); assert.equal(f.options().y, 58);
    f.template()[index].click(); f.options().callback();
    assert.equal(await result, action);
    assert.equal(f.window.listenerCount('closed'), 0);
  }
});

test('signed-out users can still reach Workbench, while dismissal and window closure perform no action', async () => {
  for (const close of ['dismiss', 'window']) {
    const f = nativeMenu();
    const result = f.showAccountMenu(f.window, { x: 0, y: 40, email: '', signedIn: false });
    assert.equal(f.template()[0].label, 'Not signed in');
    assert.notEqual(f.template()[1].enabled, false);
    assert.equal(f.template()[2].enabled, false); assert.equal(f.template()[3].enabled, false);
    if (close === 'dismiss') f.options().callback(); else f.window.emit('closed');
    assert.equal(await result, null); assert.equal(f.window.listenerCount('closed'), 0);
  }
});

test('native menu selection dispatches the existing Workbench, password and logout actions once', async () => {
  const calls = [], pending = deferred();
  let selected = 'workbench';
  const coach = { showAccountMenu: async () => selected, openAccountPassword: async () => calls.push('password'), logoutAiCrms: async () => { calls.push('logout'); await pending.promise; } };
  const homeShellBridge = { logout: coach.logoutAiCrms, requestLogin: async () => calls.push('login') };
  const { accountMenuStore: store } = load('src/renderer/maestro/home/src/store/accountMenu.store.ts', {
    vue: { reactive: v => v }, 'electron-xpc/renderer': { createXpcRendererEmitter: () => coach },
    './workbench.store': { workbenchStore: { openTab: async () => calls.push('workbench') } },
    '@renderer/common/homeShellBridge.client': { homeShellBridge }
  });
  const params = { x: 0, y: 40, email: 'test@example.invalid', signedIn: true };
  await store.show(params); selected = 'password'; await store.show(params);
  assert.deepEqual(calls, ['workbench', 'password']); calls.length = 0;
  selected = null; await store.show(params); assert.deepEqual(calls, []);
  selected = 'logout'; const loggingOut = store.show(params); await Promise.resolve(); await store.show(params);
  assert.equal(store.pending, true); assert.deepEqual(calls, ['logout']);
  pending.resolve(); await loggingOut;
  assert.deepEqual(calls, ['logout', 'login']);
  homeShellBridge.logout = async () => { throw Error('storage failed'); };
  await store.show(params); assert.equal(store.error, 'logoutFailed'); assert.equal(store.pending, false);
});
