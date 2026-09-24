/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import * as contract from '../../src/shared/home/homeShellBridge.contract.ts';

const root = resolve(import.meta.dirname, '../..');
const source = (path) => readFileSync(resolve(root, path), 'utf8');
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const snapshot = (revision, phase = 'ready', extra = {}) => ({
  authorityEpoch: 100,
  revision,
  sessionId: phase === 'signed-out' ? null : 'session-a',
  phase,
  email: phase === 'ready' ? 'test@example.invalid' : null,
  loading: false,
  loggingOut: false,
  sendingOtp: false,
  resettingPassword: false,
  ...extra
});
const controller = 'src/main/maestro/windows/main/maestroWindow.controller.ts';
const browser = 'src/main/maestro/windows/main/maestroBrowserView.service.ts';
const methods = (path, names, context = {}) => {
  const file = ts.createSourceFile(path, source(path), ts.ScriptTarget.Latest, true);
  const cls = file.statements.find(ts.isClassDeclaration);
  const members = cls.members.filter(
    (member) => ts.isMethodDeclaration(member) && names.includes(member.name.getText(file))
  );
  assert.equal(members.length, names.length);
  const code = ts.transpileModule(
    `class Subject { ${members.map((member) => member.getText(file)).join('\n')} }; return Subject;`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } }
  ).outputText;
  return new (new Function(...Object.keys(context), code)(...Object.values(context)))();
};
const loadAuth = () => {
  const callbacks = [];
  let read = async () => snapshot(1, 'signed-out');
  let validate = async () => ({ ok: true, snapshot: await read() });
  const xpc = {
    createXpcMainEmitter: () => ({ getAuthSnapshot: () => read(), validateAuthSession: () => validate() }),
    XpcMainHandler: class {},
    xpcMain: { subscribe: (_name, cb) => callbacks.push(cb) }
  };
  const code = ts.transpileModule(source('src/main/auth/applicationAuth.service.ts'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(
    (name) =>
      name === 'electron-xpc/main'
        ? xpc
        : {
            ...contract,
            HOME_SHELL_SESSION_VALIDATION_TIMEOUT_MS: 15,
            HOME_SHELL_INITIAL_AUTH_PROBE: { attempts: 2, timeoutMs: 5, retryDelayMs: 1 }
          },
    module,
    module.exports
  );
  return {
    auth: module.exports.applicationAuth,
    hint: () => callbacks[0]({ params: snapshot(999) }),
    setRead: (value) => {
      read = value;
    },
    setValidate: (value) => {
      validate = value;
    }
  };
};

test('application authority requires addressed ready, rejects setup/spoof/stale snapshots, fences logout', async () => {
  const { auth, hint, setRead } = loadAuth();
  assert.equal(auth.ready, false);
  setRead(async () => snapshot(1, 'password-setup'));
  hint();
  await auth.refresh();
  assert.equal(auth.ready, false);
  setRead(async () => snapshot(2));
  await auth.requireReady();
  const generation = auth.generation;
  setRead(async () => snapshot(1, 'signed-out'));
  await auth.refresh();
  assert.equal(auth.ready, true);
  const pending = deferred();
  setRead(() => pending.promise);
  const reading = auth.refresh();
  auth.invalidate();
  pending.resolve(snapshot(3));
  await reading;
  assert.equal(auth.ready, false);
  assert.throws(() => auth.assertGeneration(generation));
  setRead(async () => snapshot(4));
  await auth.refresh();
  assert.equal(auth.ready, false, 'fresh revision of pre-logout ready cannot undo invalidation');
  setRead(async () => snapshot(5, 'signed-out'));
  await auth.refresh();
  setRead(async () => snapshot(6));
  await auth.requireReady();
  assert.equal(auth.ready, true);
});

test('all providers require live validation; concurrent sends share one check without readiness churn', async () => {
  const { auth, setRead, setValidate } = loadAuth();
  setRead(async () => snapshot(1));
  await auth.refresh();
  const events = [];
  auth.subscribe(ready => events.push(ready));
  const pending = deferred();
  let validations = 0;
  setValidate(() => { validations += 1; return pending.promise; });
  const first = auth.requireReady();
  const second = auth.requireReady();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(validations, 1);
  pending.resolve({ ok: true, snapshot: snapshot(2) });
  assert.equal(await first, await second);
  assert.deepEqual(events, []);

  setRead(async () => snapshot(3));
  setValidate(async () => ({ ok: false, snapshot: snapshot(4), error: {
    code: 'auth-failed', message: contract.HOME_SHELL_AUTH_ERROR_MESSAGES.unavailable
  } }));
  await assert.rejects(auth.requireReady(), /application auth/);
  assert.equal(auth.ready, true, 'transient failure cannot log out or unmount an established chat');
  setValidate(() => new Promise(() => {}));
  await assert.rejects(auth.requireReady(), /timed out/);
  assert.equal(auth.ready, true);
});

test('live rejection returns to login and stale validation cannot adopt a replacement account', async () => {
  const { auth, setRead, setValidate } = loadAuth();
  setRead(async () => snapshot(1));
  await auth.refresh();
  setValidate(async () => ({ ok: false, snapshot: snapshot(2, 'signed-out'), error: {
    code: 'auth-failed', message: contract.HOME_SHELL_AUTH_ERROR_MESSAGES.credentialsRejected
  } }));
  await assert.rejects(auth.requireReady());
  assert.equal(auth.ready, false);

  setRead(async () => snapshot(3));
  await auth.refresh();
  const pending = deferred();
  setValidate(() => pending.promise);
  const checking = auth.requireReady();
  await new Promise(resolve => setImmediate(resolve));
  setRead(async () => snapshot(4, 'ready', { sessionId: 'session-b' }));
  await auth.refresh();
  const newGeneration = auth.generation;
  pending.resolve({ ok: true, snapshot: snapshot(5, 'ready', { sessionId: 'session-b' }) });
  await assert.rejects(checking, /Session changed/);
  assert.equal(auth.ready, true);
  assert.equal(auth.generation, newGeneration);
});

test('account replacement while resuming cannot send a message through the replacement account', async () => {
  let generation = 1;
  const subject = methods(controller, ['sendAgentMessage'], { applicationAuth: {
    requireReady: async () => generation,
    assertGeneration: value => { if (value !== generation) throw Error('session changed'); }
  } });
  subject.resumeAuthenticatedSession = async () => { generation += 1; };
  subject.agentService = { sendAgentMessage: () => assert.fail('stale send must not reach provider') };
  await assert.rejects(subject.sendAgentMessage({ intent: 'steering' }), /session changed/);
});

test('authority timeout is bounded and retry restores the same current snapshot', async () => {
  const { auth, setRead } = loadAuth();
  setRead(async () => snapshot(1));
  await auth.requireReady();
  let reads = 0;
  setRead(() => {
    reads += 1;
    return new Promise(() => {});
  });
  await auth.refresh();
  assert.equal(reads, 2);
  assert.equal(auth.ready, false);
  setRead(async () => snapshot(1));
  await auth.requireReady();
  assert.equal(auth.ready, true);
});

test('anonymous browser navigation commands do not consult application auth', async () => {
  const calls = [];
  const subject = methods(controller, [
    'navigate',
    'reload',
    'goBack',
    'goForward',
    'newTab',
    'closeActiveTab',
    'openTab'
  ]);
  subject.browserView = Object.fromEntries(
    ['navigate', 'reload', 'goBack', 'goForward', 'newTab', 'closeActiveTab', 'openTab'].map(
      (name) => [name, async () => calls.push(name)]
    )
  );
  subject.workbenchView = { backgroundTab: () => {}, isVisible: () => false };
  for (const name of Object.keys(subject.browserView))
    await subject[name]({ url: 'https://example.invalid' });
  assert.equal(calls.length, 7);
});

test('Main send rejects before provider work and drops a late reply after logout', async () => {
  let ready = false;
  let generation = 1;
  let sends = 0;
  const auth = {
    requireReady: async () => {
      if (!ready) throw Error('login required');
      return generation;
    },
    assertGeneration: (value) => {
      if (!ready || value !== generation) throw Error('session changed');
    }
  };
  const subject = methods(controller, ['sendAgentMessage'], { applicationAuth: auth });
  subject.resumeAuthenticatedSession = async () => {};
  subject.agentService = {
    sendAgentMessage: async () => {
      sends += 1;
      return { ok: true };
    }
  };
  await assert.rejects(subject.sendAgentMessage({ intent: 'steering' }), /login required/);
  assert.equal(sends, 0);
  ready = true;
  const pending = deferred();
  subject.agentService.sendAgentMessage = () => pending.promise;
  const sending = subject.sendAgentMessage({ intent: 'steering' });
  await Promise.resolve();
  await Promise.resolve();
  ready = false;
  generation += 1;
  pending.resolve({ ok: true });
  await assert.rejects(sending, /session changed/);
  assert.match(
    source('src/main/agent/maestroAgent.service.ts'),
    /private assertAgentRuntimeActive\(\): void \{\s*applicationAuth\.assertReady\(\)/
  );
});

test('Main claim rejects an anonymous account even with a ready third-party provider', () => {
  const subject = methods(controller, ['claimAgentTurn'], {
    applicationAuth: {
      assertReady: () => {
        throw new Error('login required');
      }
    }
  });
  subject.llmConfig = { provider: 'anthropic', ready: true };
  subject.agentService = {
    claimAgentTurn: () => assert.fail('must reject before reserving a turn')
  };
  assert.throws(
    () => subject.claimAgentTurn({ sessionId: 'session', turnId: 'turn', rootText: 'hello' }),
    /login required/
  );
});

test('protected mounts use an in-tab guide but anonymous public composite mounts proceed', async () => {
  const subject = methods(browser, ['mountComposite']);
  subject._state = { isApplicationAuthenticated: () => false };
  subject.tabs = [{ id: 'trench' }, { id: 'onlypreview' }];
  subject.compositeTabs = new Map();
  subject.compositeHosts = new Map();
  subject.showAuthenticationGuide = async (tab) => {
    tab.authSuspended = true;
  };
  const protectedTab = subject.tabs[0];
  const publicTab = subject.tabs[1];
  assert.equal(
    await subject.mountComposite(protectedTab, {
      id: 'trench',
      requiresAuthentication: true,
      open: () => assert.fail('protected runtime must stay closed')
    }),
    true
  );
  assert.equal(protectedTab.authSuspended, true);
  let mounts = 0;
  assert.equal(
    await subject.mountComposite(publicTab, {
      id: 'onlypreview',
      open: async () => {
        mounts += 1;
      }
    }),
    true
  );
  assert.equal(mounts, 1);
  assert.equal(subject.compositeHosts.has('onlypreview'), true);
});

test('logout suspends only explicitly protected composites and retains browser/public tabs', async () => {
  const subject = methods(browser, ['suspendProtectedTabs']);
  const events = [];
  subject.tabs = [{ id: 'browser' }, { id: 'onlypreview' }, { id: 'zellij' }, { id: 'trench' }];
  const original = subject.tabs;
  subject.compositeTabs = new Map(
    ['onlypreview', 'zellij', 'trench'].map((id) => [
      id,
      { requiresAuthentication: id === 'trench', close: () => events.push(id) }
    ])
  );
  subject.compositeHosts = new Map(['onlypreview', 'zellij', 'trench'].map((id) => [id, {}]));
  subject.showAuthenticationGuide = async (tab) => {
    tab.authSuspended = true;
  };
  subject.broadcastTabs = () => {};
  await subject.suspendProtectedTabs();
  assert.equal(subject.tabs, original);
  assert.equal(subject.tabs.length, 4);
  assert.deepEqual(events, ['trench']);
  assert.deepEqual([...subject.compositeTabs.keys()], ['onlypreview', 'zellij']);
  assert.equal(subject.tabs[3].authSuspended, true);
  const teardown = source('src/main/xpc/auth.handler.ts');
  assert.doesNotMatch(
    teardown,
    /BrowserWindow\.getAllWindows|zellijWindowService\.destroy|destroyOnlyPreviewForAuth/
  );
});

test('hidden Control login request focuses on next layout without navigating browser', () => {
  const events = [];
  const subject = methods(
    'src/main/maestro/windows/main/maestroControlView.service.ts',
    ['requestLogin'],
    { xpcMain: { broadcast: (name) => events.push(name) } }
  );
  subject.view = {
    getBounds: () => ({ width: 0, height: 0 }),
    webContents: { isDestroyed: () => false, focus: () => events.push('focus') }
  };
  subject.requestLogin();
  subject.requestLogin();
  assert.equal(subject.focusSearchOnLayout, true);
  assert.deepEqual(events, ['coach/login-request', 'coach/login-request']);
  assert.match(
    source('src/renderer/maestro/home/src/store/layout.store.ts'),
    /subscribe\('coach\/login-request'[\s\S]*?if \(!this\.sidebarOpen\) this\.toggleSidebar\(\)/
  );
});

test('standalone login renderer and native overlay are absent; public tools carry no new auth policy', () => {
  for (const path of [
    'src/renderer/loginRenderer/index.html',
    'src/preload/loginRenderer.preload.ts',
    'src/main/maestro/windows/main/maestroLoginView.service.ts'
  ])
    assert.equal(existsSync(resolve(root, path)), false);
  assert.doesNotMatch(source('electron.vite.config.ts'), /loginRenderer/);
  assert.doesNotMatch(source(controller), /loginView|isAuthenticationLocked|raiseLoginView/);
  for (const id of ['onlyPreview', 'zellij'])
    assert.doesNotMatch(source(`src/main/windows/${id}CoworkTab.ts`), /requiresAuthentication/);
  assert.match(source('src/main/windows/trenchCoworkTab.ts'), /requiresAuthentication: true/);
  assert.match(source('src/main/coin/coinWindow.lifecycle.ts'), /if \(!this.authenticated\) throw/);
});
