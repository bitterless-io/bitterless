/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, test } from 'node:test';
import { build } from 'esbuild';

/**
 * 关掉独立窗口 → 内容就地回到那一格 tab(Ral 2026-09-17)。
 *
 * 方案:docs/features/onlypreview-deferred-tab-placeholder.md #3、#4。文件名沿用 task 137
 * (`onlypreview-standalone-close-takeover`),那条任务描述的正是这件事,由 task 181 接手。
 *
 * 跑的是**真的** `onlyPreviewHostToggle.service.ts`,只把原生边界(窗口 helper、maestro、那一格 tab
 * 的双态运行时)换成替身 —— 与 `onlyPreviewHostToggle.test.mjs` 同一套加载方式。窗口事件的接线
 * 只能源码守卫,但守的都是「不这么写就静默退化」的地方:漏了不报错,只是「关了窗口东西再也回不来」
 * 或者「退出应用时凭空建一个 composite」。
 */
const root = resolve(dirname(new URL(import.meta.url).pathname), '../..');
const readSource = (path) => readFileSync(resolve(root, path), 'utf8');
const codeOnly = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '');
const buildRoot = mkdtempSync(join(tmpdir(), 'onlypreview-close-takeover-'));
const stubs = {
  'onlyPreviewWindow.helper': 'export const onlyPreviewWindowHelper = globalThis.__takeover.window;',
  onlyPreviewCoworkTab:
    "export const ONLY_PREVIEW_COWORK_TAB_ID = 'onlypreview';" +
    'export const getOnlyPreviewCoworkTabState = () => globalThis.__takeover.tabState();' +
    'export const promoteOnlyPreviewCoworkTab = async () => await globalThis.__takeover.promote();',
  'maestroWindow.controller': 'export const maestroWindowHelper = globalThis.__takeover.maestro;',
  'compositeTab.registry': 'export const getMaestroCompositeTab = () => ({});',
  'onlyPreviewHostMount.service':
    'export const rememberOnlyPreviewHostMount = (kind) => { globalThis.__takeover.hostMount.push(kind); };' +
    'export const peekOnlyPreviewHostMount = () => null;' +
    'export const readOnlyPreviewHostMount = async () => "tab";' +
    'export const hydrateOnlyPreviewHostMount = async () => undefined;',
  'onlyPreviewPreviewRegion.service':
    'export const onlyPreviewPreviewRegionService = globalThis.__takeover.preview;' +
    'export const resolveOnlyPreviewPreviewRegion = () => globalThis.__takeover.preview;',
  'fileSearchWindow.service': 'export const fileSearchWindowService = globalThis.__takeover.files;',
  'onlyPreviewLog.runtime':
    'export const onlyPreviewLogService = { writeOperationFailure: failure => globalThis.__takeover.logs.push(failure) };',
  'onlyPreviewOpenDiagnostics.runtime':
    'export const onlyPreviewOpenDiagnostics = { trace: () => ({mark(){},end(){}}) };'
};
const env = {
  logs: [],
  events: [],
  calls: [],
  hostMount: [],
  transitions: [],
  live: null,
  fileRef: null,
  tabs: [],
  browser: { isDestroyed: () => false, isVisible: () => true }
};
const deferredPromise = () => {
  let resolveIt;
  const promise = new Promise((done) => {
    resolveIt = done;
  });
  return { promise, resolve: resolveIt };
};
const inspect = (path) => {
  const file = path.includes('.');
  const directory = file ? dirname(path) : path;
  return {
    rootRealPath: directory,
    displayPath: directory,
    rootName: basename(directory),
    ...(file ? { selectedRelativePath: basename(path) } : {})
  };
};
let runtime;
const requireLive = (token) => {
  runtime.onlyPreviewHostRegistry.require(token, ['content']);
  if (env.live?.host.hostToken !== token) throw new Error('stale host');
  return env.live;
};
const createHost = async (kind) => {
  env.calls.push(`build:${kind}`);
  assert.equal(env.live, null, 'no second live surface during rebuild');
  const host = runtime.onlyPreviewHostRegistry.issue('standalone', 'content');
  env.live = { host, kind, window: env.browser };
  env.fileRef = null;
  await runtime.onlyPreviewRecentDirectoryService.restoreWorkspace(host.hostToken);
  return host;
};
env.window = {
  beginHostTransition: () => env.transitions.push('begin'),
  endHostTransition: () => env.transitions.push('end'),
  getMountKind: (token) => requireLive(token).kind,
  getStandaloneWindow: (token) => requireLive(token).window,
  getStandaloneHost: () => env.live?.host ?? null,
  ensureStandalone: () => createHost('standalone'),
  destroyStandalone: () => {
    if (!env.live) return;
    env.calls.push(`destroy:${env.live.kind}`);
    runtime.onlyPreviewHostRegistry.revoke(env.live.host.hostToken);
    env.live = null;
    env.fileRef = null;
  },
  show: () => env.calls.push('show'),
  setStandaloneCloseTakeover: (takeover) => {
    env.takeover = takeover;
  }
};
env.tabState = () => {
  if (env.live?.kind === 'cowork') return 'live';
  return env.tabs.some((tab) => tab.kind === 'onlypreview') ? 'deferred' : 'none';
};
env.promote = async () => {
  if (env.tabState() !== 'deferred') return false;
  env.calls.push('promote');
  await createHost('cowork');
  return true;
};
env.maestro = {
  get browserWindow() {
    return env.browser;
  },
  whenReady: async () => undefined,
  getTabs: async () => env.tabs.slice(),
  closeTab: async ({ id }) => env.calls.push(`close:${id}`),
  openCompositeTab: async () => {
    await createHost('cowork');
    env.tabs.push({ id: 'preview-tab', kind: 'onlypreview' });
  }
};
env.preview = {
  snapshot: () => ({ fileRef: env.fileRef }),
  present: async (token, ref) => {
    requireLive(token);
    env.fileRef = ref;
    env.calls.push(`present:${ref.relativePath}`);
  },
  clearWorkspace: () => {
    env.fileRef = null;
  }
};
env.files = {
  inspectTarget: async (path) => inspect(path),
  authorizeProjectItem: async (ref) => ({ ...ref, nodeKind: 'file' })
};
globalThis.__takeover = env;
await build({
  stdin: {
    contents: `
    export { onlyPreviewHostToggleService } from './src/main/windows/onlyPreviewHostToggle.service';
    export { onlyPreviewHostRegistry } from './src/main/miniapps/onlypreview/onlyPreviewHost.registry';
    export { onlyPreviewWorkspaceRegistry } from './src/main/miniapps/onlypreview/onlyPreviewWorkspace.registry';
    export { onlyPreviewRecentDirectoryService } from './src/main/miniapps/onlypreview/onlyPreviewRecentDirectory.service';
    export { onlyPreviewTargetMutations, presentOnlyPreviewExplicitFile } from './src/main/miniapps/onlypreview/onlyPreviewExplicitOpen.service';
  `,
    resolveDir: root,
    loader: 'ts'
  },
  outfile: join(buildRoot, 'runtime.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  tsconfig: join(root, 'tsconfig.node.json'),
  plugins: [
    {
      name: 'native-boundaries',
      setup(context) {
        context.onResolve({ filter: /.*/ }, ({ path }) => {
          const key = Object.keys(stubs).find((name) => path.endsWith(name));
          if (key) return { path: key, namespace: 'takeover-test' };
          if (path === 'electron' || path === 'electron-xpc/main')
            return { path, namespace: 'takeover-test' };
        });
        context.onLoad({ filter: /.*/, namespace: 'takeover-test' }, ({ path }) => ({
          contents:
            stubs[path] ??
            (path === 'electron'
              ? 'export const dialog = { showOpenDialog: async () => ({ canceled: true }) };'
              : 'export const xpcMain = { broadcast: (event, payload) => globalThis.__takeover.events.push({event, payload}) };')
        }));
      }
    }
  ]
});
runtime = await import(pathToFileURL(join(buildRoot, 'runtime.mjs')).href);
after(() => rmSync(buildRoot, { recursive: true, force: true }));
const recent = runtime.onlyPreviewRecentDirectoryService;
const stored = new Map();
recent.configureStorage({
  getStored: async ({ sub_key: subKey }) => {
    const value = stored.get(subKey);
    return {
      exists: value !== undefined,
      valid: value !== undefined,
      value,
      serializedValue: JSON.stringify(value) ?? null
    };
  },
  insertIfAbsent: async ({ sub_key: subKey, value }) => {
    stored.set(subKey, value);
    return true;
  },
  compareAndSet: async ({ sub_key: subKey, value }) => {
    stored.set(subKey, value);
    return true;
  }
});
recent.configureTargetRuntime({
  inspectTarget: async (path) => inspect(path),
  bindWorkspace: async (token, workspace) =>
    runtime.onlyPreviewWorkspaceRegistry.bindProjectAuthority(token, workspace.workspaceId, 1)
});
recent.markStorageReady();

/** 一个装在独立窗口里的 OnlyPreview,外加条上那一格(默认是占位态)。 */
const reset = async ({ tab = 'deferred', project = '/project', file = '/project/a.md' } = {}) => {
  await recent.flushPendingWrites();
  env.window.destroyStandalone();
  recent.clearTransientState();
  Object.assign(env, {
    calls: [],
    logs: [],
    events: [],
    hostMount: [],
    transitions: [],
    tabs: tab === 'deferred' ? [{ id: 'deferred-preview', kind: 'onlypreview' }] : [],
    browser: { isDestroyed: () => false, isVisible: () => true }
  });
  const generation = recent.beginExplicitTarget();
  const host = await createHost('standalone');
  recent.bindExplicitTarget(host.hostToken, generation);
  if (project) await recent.openExplicitTarget(host.hostToken, project, generation);
  if (file) await runtime.presentOnlyPreviewExplicitFile(host, inspect(file));
  recent.finishExplicitTarget(generation);
  await recent.flushPendingWrites();
  env.calls = [];
  env.transitions = [];
  return host;
};

/** FIFO 排空 —— 升格是 `void` 派出去的,没有可 await 的返回值。 */
const drain = async () => {
  await runtime.onlyPreviewTargetMutations.run(async () => undefined);
  await runtime.onlyPreviewTargetMutations.run(async () => undefined);
};

/**
 * 用户关掉那个独立窗口,**按真实次序**驱动注册进来的那一对回调:
 * `'close'` 只抓快照(承载还活着)→ `'closed'` 先吊销承载 → 然后才升格。
 *
 * 这里原来是 `takeOverStandaloneClose()` 紧跟 `destroyStandalone()`,也就是在布防与排空之间**同步**
 * 把承载拆掉 —— 那**假造**了一个生产上不存在的状态。真实路径上 `'closed'` 严格晚于 `'close'`,
 * 而升格体在它那道 `getStandaloneHost()` 判据之前没有 macrotask 边界,所以旧写法正好掩盖了
 * 「升格自己判成 `reason=live-host` 什么都不做」这个破绽(两路独立评审都先判到它)。
 * 用 `env.takeover` 而不是直接调 service:这样连注册的接线本身也被覆盖。
 */
const closeStandaloneWindow = async (host) => {
  const captured = env.takeover.capture(host.hostToken);
  env.window.destroyStandalone();
  if (captured !== undefined) env.takeover.promote(captured);
  await drain();
};

test('closing the window promotes the deferred tab with its Project, its file and a tab preference', async () => {
  const host = await reset();
  await closeStandaloneWindow(host);

  assert.equal(env.live.kind, 'cowork', '内容就地回到那一格 tab');
  assert.deepEqual(
    env.calls.filter((call) => call.startsWith('close:')),
    [],
    '接管不关任何 tab —— 那一格就是要升格的那一格'
  );
  assert.ok(env.calls.includes('promote'), '走的是同一条就地升格,不是新开一格');
  assert.equal(env.calls.filter((call) => call === 'build:cowork').length, 1);
  assert.equal(
    runtime.onlyPreviewWorkspaceRegistry.restore(env.live.host.hostToken).displayPath,
    '/project'
  );
  assert.equal(env.fileRef.relativePath, 'a.md', '转移目标在承载被吊销之前就快照下来了');
  assert.deepEqual(env.hostMount, ['tab'], '写 tab —— 否则下次点芯片又弹窗口,读起来像没回来');
  assert.deepEqual(
    env.transitions,
    ['begin', 'end'],
    '索引要活过这次搬家,并且每一条路都要收尾'
  );
});

test('a second promotion on top of a live cowork host is a no-op, and still ends the transition', async () => {
  const host = await reset();
  await closeStandaloneWindow(host);
  env.calls = [];
  env.hostMount = [];
  env.transitions = [];

  await runtime.onlyPreviewHostToggleService.promoteDeferredTab({
    directoryPath: null,
    filePath: null
  });

  assert.equal(env.calls.filter((call) => call === 'build:cowork').length, 0, '幂等');
  assert.deepEqual(env.hostMount, [], 'no-op 不写偏好');
  assert.deepEqual(env.transitions, ['end'], 'no-op 路径也要 endHostTransition()');
  assert.deepEqual(env.logs, [], 'no-op 不是失败,不许进失败日志');
});

test('no OnlyPreview tab on the strip means no promotion at all (G5)', async () => {
  const host = await reset({ tab: 'none' });
  await closeStandaloneWindow(host);

  assert.equal(env.live, null, '没有那一格就什么都不做 —— 下次点芯片还是开窗口');
  assert.deepEqual(env.calls, ['destroy:standalone']);
  assert.deepEqual(env.hostMount, [], '偏好保持 window');
  assert.deepEqual(
    env.transitions,
    [],
    '连布防都不做:没有目的地,索引就该跟着这个窗口一起拆掉,而不是被留下来'
  );
});

/**
 * 条上的那一格与运行时状态**两半都要**。
 *
 * 用户在窗口开着时把 tab 关掉 → 运行时可能还没来得及反映,而条上确实没有那一格了:只看运行时
 * 状态就会去升格一个不存在的格子。
 */
test('a tab that reports deferred but is no longer on the strip is not promoted', async () => {
  const host = await reset();
  const captured = env.takeover.capture(host.hostToken);
  env.window.destroyStandalone();
  env.tabs = [];
  // 运行时还说 `deferred`,而条上已经没有那一格了 —— 只看运行时状态就会去升格一个不存在的格子。
  env.tabState = () => 'deferred';
  env.takeover.promote(captured);
  await drain();
  env.tabState = () => {
    if (env.live?.kind === 'cowork') return 'live';
    return env.tabs.some((tab) => tab.kind === 'onlypreview') ? 'deferred' : 'none';
  };

  assert.equal(env.live, null);
  assert.deepEqual(env.calls, ['destroy:standalone']);
  assert.deepEqual(env.transitions, ['begin', 'end']);
});

/**
 * 竞态:一个排队的 dock `toggle()` 与一个排队的升格只建出**一个** cowork 承载。
 *
 * 两者跑在同一条 `onlyPreviewTargetMutations` FIFO 上 —— 先跑的那个把承载建起来,后跑的那个在
 * 「已经有承载了」这道判断上变成 no-op。不共用那条队列的话两边会各建一个,而第二个会把第一个
 * 正在装的承载拆掉。
 */
test('a queued dock and a queued promotion build exactly one cowork host', async () => {
  const host = await reset();
  const gate = deferredPromise();
  const blocker = runtime.onlyPreviewTargetMutations.run(() => gate.promise);
  const dock = runtime.onlyPreviewHostToggleService.toggle(host.hostToken);
  // 关窗的两半都在 FIFO 被堵住的时候发生,升格于是排在 dock 后面 —— 这正是「只建出一个承载」要考的。
  const captured = env.takeover.capture(host.hostToken);
  env.takeover.promote(captured);
  gate.resolve();
  await blocker;
  await dock;
  await drain();

  assert.equal(env.calls.filter((call) => call === 'build:cowork').length, 1);
  assert.equal(env.live.kind, 'cowork');
  assert.deepEqual(env.hostMount, ['tab'], '只有真正落定的那一条写偏好,no-op 那一条不写');
  assert.equal(env.transitions.filter((value) => value === 'end').length, 2, '两条路都收尾');
});

test('Go to the window shows the live window and never builds a second host', async () => {
  const host = await reset();

  const result = await runtime.onlyPreviewHostToggleService.focusStandaloneWindow();

  assert.deepEqual(result, { focused: true });
  assert.deepEqual(env.calls, ['show'], 'show()/focus() 走既有的 showSurface(),不新建窗口');
  assert.equal(env.live.host, host);
  assert.deepEqual(env.hostMount, []);
});

test('Go to the window promotes instead when that window is already gone', async () => {
  const host = await reset();
  // 直接摆出前置条件(没有 standalone 承载、那一格还是占位态),不走关窗接管 —— 接管一旦 commit
  // 就已经升格了,那样就考不到 `focusStandaloneWindow` 自己这条兜底分支。
  env.window.destroyStandalone();
  env.transitions = [];
  env.calls = [];
  env.hostMount = [];

  const result = await runtime.onlyPreviewHostToggleService.focusStandaloneWindow();
  await drain();

  assert.deepEqual(result, { focused: false }, 'false 不是失败 —— 是「窗口没了,内容回到了 tab」');
  assert.equal(env.live.kind, 'cowork');
  assert.equal(env.calls.filter((call) => call === 'build:cowork').length, 1);
  assert.deepEqual(env.hostMount, ['tab']);
});

/**
 * #5.3:浏览器窗口已经隐藏时,升格照做,但不把它提到前台。
 *
 * 不带项目/文件跑,因为 `presentOnlyPreviewExplicitFile` 自己末尾也有一次 `show()`(既有行为,
 * `relocate` 共用)—— 不摘掉它就分不清「升格那一步提了前台」和「恢复文件那一步激活了 tab」。
 * 顺带说清代价:窗口隐藏时关掉独立窗口,屏幕上会一瞬间什么都没有;要翻这一条只改一处判断。
 */
test('promotion raises the browser window only when it is already visible', async () => {
  for (const visible of [true, false]) {
    const host = await reset({ project: null, file: null });
    env.browser = { isDestroyed: () => false, isVisible: () => visible };
    await closeStandaloneWindow(host);

    assert.equal(env.live.kind, 'cowork', '内容确实回到了那一格');
    assert.equal(
      env.calls.includes('show'),
      visible,
      visible ? '窗口本来就在,摆到前台' : '用户刚关掉窗口,弹一个他没点的窗口正好相反'
    );
  }
});

test('source guards: the takeover hangs off the cancellable close, and quitting refuses it', () => {
  const helper = codeOnly(readSource('src/main/windows/onlyPreviewWindow.helper.ts'));
  assert.match(
    helper,
    /window\.on\('close' as any, \(\) => \{/,
    "监听可取消的 `'close'`,不是 `'closed'` —— `destroy()` 不发 `'close'`,那三个非用户来源就靠这一条自动绕开"
  );
  const arm = helper.slice(helper.indexOf('private armStandaloneCloseTakeover('));
  const armBody = arm.slice(0, arm.indexOf('\n  }\n'));
  assert.match(armBody, /if \(shuttingDown\) return;/, '退出应用时拒绝 —— app.quit() 对每个窗口发 close');
  assert.match(armBody, /kind !== 'standalone'\) return;/, '只有独立窗口那一种会被接管');
  /**
   * 这一位**不许**挂在 `before-quit` 上。第一发 `before-quit` 必然被 `preventDefault()`,而退出
   * 可以被取消(确认对话框点取消、清理失败)—— 挂那里的话一次「取消退出」就把关窗接管永久关掉,
   * 症状和它要防的那件事一样,且重启前不恢复。改由 app 在设置自己那面 `isQuitting` 的同一处驱动。
   */
  assert.doesNotMatch(
    helper,
    /before-quit/,
    'shuttingDown 不许由 before-quit 驱动 —— 那是个永久闩锁'
  );
  assert.match(helper, /export const setOnlyPreviewShuttingDown = \(value: boolean\): void => \{/);
  const appMain = codeOnly(readSource('src/main/app.main.ts'));
  // 同真同假:isQuitting 置真处置真,置假处置假。
  assert.match(appMain, /isQuitting = true;\n\s*(\/\/[^\n]*\n\s*)*setOnlyPreviewShuttingDown\(true\);/);
  assert.match(appMain, /isQuitting = false;\n\s*(\/\/[^\n]*\n\s*)*setOnlyPreviewShuttingDown\(false\);/);

  // `closeOnRendererFailure` **先**布防再 `destroyStandalone()`:那一支走 `destroy()`,发不出
  // `'close'`,而它是三个非用户来源里唯一应该升格的那一个。
  const failure = helper.slice(helper.indexOf('const closeOnRendererFailure'));
  const armAt = failure.indexOf('this.armStandaloneCloseTakeover(');
  const destroyAt = failure.indexOf('this.destroyStandalone()');
  assert.ok(armAt > -1, '渲染进程死了也要升格 —— 内容该回到那一格,不是连带消失');
  assert.ok(armAt < destroyAt, '布防必须在拆卸之前:注册表在拆卸里就被吊销了');

  // `destroyStandalone()` 自己**不**布防:它就是 dock 方向与登出拆卸走的那条路,再接管一次会建出
  // 第二个 cowork 承载。
  const destroy = helper.slice(helper.indexOf('destroyStandalone(): void {'));
  assert.doesNotMatch(
    destroy.slice(0, destroy.indexOf('\n  }\n')),
    /armStandaloneCloseTakeover|standaloneCloseTakeover/
  );
});

/**
 * 这一条钉的是 G4 曾经**静默失效**的那个破绽:`'close'` 里直接排队升格,升格体在它那道
 * `getStandaloneHost()` 判据之前没有任何 macrotask 边界,于是在窗口真正销毁之前就跑完、读到承载
 * 还活着、判成 `reason=live-host` 什么都不做。修法是把两半拆到两个时刻:`'close'` 只抓快照,
 * `'closed'`(承载已被 `mount.onHostGone` 同步吊销)那一侧才触发升格。
 */
test('source guards: close only captures, closed is what promotes', () => {
  const toggle = codeOnly(readSource('src/main/windows/onlyPreviewHostToggle.service.ts'));
  const takeOver = toggle.slice(toggle.indexOf('takeOverStandaloneClose('));
  const body = takeOver.slice(0, takeOver.indexOf('\n  }\n'));
  assert.doesNotMatch(
    body,
    /promoteDeferredTab/,
    '`close` 一侧不许排队升格 —— 那正是 reason=live-host 自我取消的来源'
  );
  assert.match(body, /return target;/, '它只交出快照');
  // 注册的是一对,而不是一个回调。
  assert.match(
    toggle,
    /setStandaloneCloseTakeover\(\{[\s\S]{0,400}capture:[\s\S]{0,400}promote:/,
    '两半必须分开注册,否则 helper 无法把它们放到两个时刻'
  );

  const helper = codeOnly(readSource('src/main/windows/onlyPreviewWindow.helper.ts'));
  // `'closed'` 里的次序是承重的:先 reportHostGone(它同步吊销承载),然后才 commit。
  assert.match(
    helper,
    /once\('closed' as any, \(\) => \{\s*mount\.reportHostGone\(\);[\s\S]{0,900}commitStandaloneCloseTakeover\(host\.hostToken\)/,
    'commit 必须晚于 reportHostGone —— 承载要先被吊销,升格的幂等判据和 buildHost 才成立'
  );
  const arm = helper.slice(helper.indexOf('private armStandaloneCloseTakeover('));
  const armBody = arm.slice(0, arm.indexOf('\n  }\n'));
  assert.match(armBody, /pendingCloseTakeover = \{ hostToken, captured \}/, '布防只存快照');
  assert.doesNotMatch(armBody, /promote\(/, '布防一侧不许触发升格');
});

test('source guards: promotion reuses the dock steps instead of opening a second path', () => {
  const toggle = codeOnly(readSource('src/main/windows/onlyPreviewHostToggle.service.ts'));
  const promote = toggle.slice(toggle.indexOf('async promoteDeferredTab('));
  const body = promote.slice(0, promote.indexOf('\n  }\n'));
  assert.match(body, /onlyPreviewTargetMutations\.run\(/, '同一条 FIFO —— 竞态就是靠它收敛的');
  for (const step of [
    /await this\.buildHost\('cowork', dockWindow\)/,
    /await this\.restoreTarget\(host, target, generation\)/,
    /rememberOnlyPreviewHostMount\('tab'\)/,
    /dockWindow\?\.isVisible\(\)\) onlyPreviewWindowHelper\.show\(\)/
  ]) {
    assert.match(body, step);
  }
  assert.match(
    body,
    /finally \{\n\s*onlyPreviewWindowHelper\.endHostTransition\(\);/,
    'no-op 与失败两条路都要收尾,否则索引运行时永久逃过之后每一次拆卸'
  );
  assert.match(
    readSource('src/main/windows/onlyPreviewHostToggle.service.ts'),
    /onlyPreviewWindowHelper\.setStandaloneCloseTakeover\(/,
    '注册方向只有一条:toggle → helper。反过来 import 就是一个环'
  );
});
