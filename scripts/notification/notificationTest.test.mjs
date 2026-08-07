/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const root = resolve(import.meta.dirname, '../..');
const projectRequire = createRequire(import.meta.url);
const read = (path) => readFileSync(join(root, path), 'utf8');

const loadTypeScriptModule = (path, requireOverrides = {}) => {
  const filename = join(root, path);
  const compiled = ts.transpileModule(read(path), {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022
    },
    fileName: filename
  }).outputText;
  const loadedModule = { exports: {} };
  const scopedRequire = (specifier) => {
    if (Object.hasOwn(requireOverrides, specifier)) return requireOverrides[specifier];
    return projectRequire(specifier);
  };
  const execute = vm.runInThisContext(`(function(require, module, exports) { ${compiled}\n})`, {
    filename
  });
  execute(scopedRequire, loadedModule, loadedModule.exports);
  return loadedModule.exports;
};

class FakeNotification {
  constructor(options) {
    this.options = options;
    this.listeners = new Map();
    this.showCalls = 0;
  }

  static isSupported() {
    return true;
  }

  once(event, listener) {
    const wrapped = (...args) => {
      this.removeListener(event, wrapped);
      listener(...args);
    };
    wrapped.originalListener = listener;
    const listeners = this.listeners.get(event) ?? [];
    listeners.push(wrapped);
    this.listeners.set(event, listeners);
    return this;
  }

  removeListener(event, listener) {
    const listeners = this.listeners.get(event) ?? [];
    this.listeners.set(
      event,
      listeners.filter(
        (candidate) => candidate !== listener && candidate.originalListener !== listener
      )
    );
    return this;
  }

  emit(event, ...args) {
    for (const listener of [...(this.listeners.get(event) ?? [])]) listener(...args);
  }

  show() {
    this.showCalls += 1;
  }
}

const spawnCalls = [];
const fakeSpawn = (...args) => {
  spawnCalls.push(args);
  const child = {
    once: () => child,
    unref: () => undefined
  };
  return child;
};
const notifyModule = loadTypeScriptModule('src/main/notificationcenter/notify.helper.ts', {
  child_process: { spawn: fakeSpawn },
  electron: {
    app: {
      getAppPath: () => root,
      isPackaged: false
    },
    Notification: FakeNotification
  },
  '../i18n/i18n.helper': {
    i18nHelper: {
      getMessages: () => ({
        eyesOnAgents: {
          completionNotification: {
            body: '《{title}》',
            title: 'Thread finished'
          },
          thread: { untitled: 'Untitled' }
        }
      })
    }
  }
});

const createHarness = ({ createNotification, isSupported } = {}) => {
  const notifications = [];
  const timers = [];
  const helper = new notifyModule.NotifyHelper({
    createNotification:
      createNotification ??
      ((options) => {
        const notification = new FakeNotification(options);
        notifications.push(notification);
        return notification;
      }),
    isSupported: isSupported ?? (() => true),
    scheduleTimeout: (callback, delayMs) => {
      const timer = { callback, cancelled: false, delayMs };
      timers.push(timer);
      return timer;
    },
    cancelTimeout: (timer) => {
      timer.cancelled = true;
    },
    retentionTimeoutMs: 1_000,
    testTimeoutMs: 25
  });
  const fireTimer = (delayMs) => {
    const timer = timers.find((candidate) => candidate.delayMs === delayMs && !candidate.cancelled);
    assert.ok(timer, `Missing active ${delayMs}ms timer`);
    timer.cancelled = true;
    timer.callback();
  };
  return {
    fireTimer,
    helper,
    notifications,
    retainedCount: () => helper.retainedNotifications.size
  };
};

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
  for (const source of [english, chinese]) {
    assert.match(source, /testSuccess:/);
    assert.match(source, /testUnsupported:/);
    assert.match(source, /testShowFailed:/);
    assert.match(source, /testShowTimeout:/);
    assert.match(source, /testRequestFailed:/);
  }
});

test('notification result contract accepts only exact known discriminants', () => {
  const contract = loadTypeScriptModule('src/shared/setting/settingNavigation.contract.ts');

  assert.deepEqual(contract.parseNotificationTestResult({ ok: true }), { ok: true });
  for (const error of ['unsupported', 'show-failed', 'show-timeout']) {
    assert.deepEqual(contract.parseNotificationTestResult({ error, ok: false }), {
      error,
      ok: false
    });
  }

  for (const value of [
    null,
    {},
    { ok: 'true' },
    { error: 'unknown', ok: false },
    { extra: true, ok: true },
    { error: 'show-failed', extra: true, ok: false }
  ]) {
    assert.throws(
      () => contract.parseNotificationTestResult(value),
      (err) => err?.code === 'INVALID_NOTIFICATION_TEST_RESULT'
    );
  }
});

test('notification test retains the native object and resolves only after show', async () => {
  const harness = createHarness();
  const resultPromise = harness.helper.notifyTest();

  assert.equal(harness.notifications.length, 1);
  assert.equal(harness.notifications[0].showCalls, 1);
  assert.equal(harness.retainedCount(), 1);

  harness.notifications[0].emit('show', {});
  assert.deepEqual(await resultPromise, { ok: true });
  assert.equal(harness.retainedCount(), 1, 'show receipt must not immediately release the object');

  harness.notifications[0].emit('close', {});
  assert.equal(harness.retainedCount(), 0);
});

test('notification test maps native failed and missing-event timeout to typed failures', async () => {
  const failedHarness = createHarness();
  const failedResult = failedHarness.helper.notifyTest();
  failedHarness.notifications[0].emit('failed', {}, 'native delivery failed');
  assert.deepEqual(await failedResult, { error: 'show-failed', ok: false });
  assert.equal(failedHarness.retainedCount(), 0);

  const timeoutHarness = createHarness();
  const timeoutResult = timeoutHarness.helper.notifyTest();
  timeoutHarness.fireTimer(25);
  assert.deepEqual(await timeoutResult, { error: 'show-timeout', ok: false });
  assert.equal(timeoutHarness.retainedCount(), 0);
});

test('notification test maps unsupported and synchronous runtime errors without rejecting', async () => {
  const unsupportedHarness = createHarness({ isSupported: () => false });
  assert.deepEqual(await unsupportedHarness.helper.notifyTest(), {
    error: 'unsupported',
    ok: false
  });
  assert.equal(unsupportedHarness.notifications.length, 0);

  const supportErrorHarness = createHarness({
    isSupported: () => {
      throw new TypeError('support check failed');
    }
  });
  assert.deepEqual(await supportErrorHarness.helper.notifyTest(), {
    error: 'show-failed',
    ok: false
  });

  const constructionErrorHarness = createHarness({
    createNotification: () => {
      throw new TypeError('constructor failed');
    }
  });
  assert.deepEqual(await constructionErrorHarness.helper.notifyTest(), {
    error: 'show-failed',
    ok: false
  });

  const showErrorHarness = createHarness({
    createNotification: (options) => {
      const notification = new FakeNotification(options);
      notification.show = () => {
        throw new TypeError('show failed');
      };
      return notification;
    }
  });
  assert.deepEqual(await showErrorHarness.helper.notifyTest(), { error: 'show-failed', ok: false });
  assert.equal(showErrorHarness.retainedCount(), 0);
});

test('real Main XPC registry waits for the notification-center show receipt', async () => {
  const harness = createHarness();
  loadTypeScriptModule('src/main/xpc/notification.handler.ts', {
    '@main/notificationcenter/notify.helper': { notifyHelper: harness.helper },
    'electron-xpc/main': projectRequire('electron-xpc/main')
  });
  const { xpcMain } = projectRequire('electron-xpc/main');

  const resultPromise = xpcMain.send('NotificationHandler/sendTestNotification');
  assert.equal(harness.notifications.length, 1);
  harness.notifications[0].emit('show', {});
  assert.deepEqual(await resultPromise, { ok: true });
});

test('EyesOnAgents completion preserves silent delivery while sharing retention', () => {
  const harness = createHarness();
  const spawnCountBefore = spawnCalls.length;

  harness.helper.notifyThreadCompleted({ title: 'Retained task' });

  assert.equal(harness.notifications.length, 1);
  assert.equal(harness.notifications[0].options.silent, true);
  assert.equal(harness.notifications[0].showCalls, 1);
  assert.equal(harness.retainedCount(), 1);
  assert.equal(spawnCalls.length, spawnCountBefore + 1);

  harness.notifications[0].emit('close', {});
  assert.equal(harness.retainedCount(), 0);
});

test('Renderer maps every typed result and transport failure to localized Arco feedback', () => {
  const component = read(
    'src/renderer/home/src/views/setting/components/NotificationSetting/NotificationSetting.vue'
  );
  const store = read(
    'src/renderer/home/src/views/setting/components/NotificationSetting/notificationSetting.store.ts'
  );

  assert.match(store, /createXpcRendererEmitter<NotificationSettingsApi>\('NotificationHandler'\)/);
  assert.match(store, /if \(this\.testing\) return/);
  assert.match(store, /parseNotificationTestResult\([\s\S]*sendTestNotification\(\)/);
  assert.match(store, /Message\.success\(i18nHelper\.setting\.notification\.testSuccess\)/);
  assert.match(store, /case 'unsupported':[\s\S]*testUnsupported/);
  assert.match(store, /case 'show-failed':[\s\S]*testShowFailed/);
  assert.match(store, /case 'show-timeout':[\s\S]*testShowTimeout/);
  assert.match(
    store,
    /catch \(err\)[\s\S]*Message\.error\(i18nHelper\.setting\.notification\.testRequestFailed\)/
  );
  assert.match(component, /:loading="notificationSettingStore\.testing"/);
  assert.match(component, /:disabled="notificationSettingStore\.testing"/);
  assert.doesNotMatch(`${component}\n${store}`, /ipcRenderer|ipcMain/);
});

test('Main handler returns the typed notification-center promise without completion audio', () => {
  const handler = read('src/main/xpc/notification.handler.ts');
  const xpc = read('src/main/xpc/xpc.helper.ts');
  const notifier = read('src/main/notificationcenter/notify.helper.ts');

  assert.match(xpc, /import '\.\/notification\.handler'/);
  assert.match(
    handler,
    /class NotificationHandler extends XpcMainHandler implements NotificationSettingsApi/
  );
  assert.match(handler, /return await notifyHelper\.notifyTest\(\)/);
  assert.match(notifier, /private readonly retainedNotifications = new Set<Notification>\(\)/);
  assert.match(notifier, /notification\.once\('show', onShow\)/);
  assert.match(notifier, /notification\.once\('failed', onFailed\)/);
  assert.match(notifier, /error: 'show-timeout'/);

  const notifyTest = notifier.slice(
    notifier.indexOf('async notifyTest()'),
    notifier.indexOf('private retainNotification')
  );
  assert.doesNotMatch(notifyTest, /playThreadCompletionSound|spawn\(/);
  assert.doesNotMatch(handler, /playThreadCompletionSound|notifyThreadCompleted/);
});

test('package exposes the notification runtime tests', () => {
  const packageJson = JSON.parse(read('package.json'));

  assert.equal(
    packageJson.scripts['test:notification'],
    'node --test scripts/notification/notificationTest.test.mjs'
  );
});
