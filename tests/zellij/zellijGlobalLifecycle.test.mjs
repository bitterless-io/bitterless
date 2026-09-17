/* eslint-disable @typescript-eslint/explicit-function-return-type -- Production-method lifecycle harness. */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = ts.createSourceFile(
  'runtime.ts',
  readFileSync('src/main/zellij/zellijRuntime.service.ts', 'utf8'),
  ts.ScriptTarget.Latest,
  true
);
const names = [
  'TRANSIENT_IPC_CODES',
  'surfacePreparations',
  'prepareZellijTerminal',
  'prepareZellijSurface',
  'stopZellijRuntime',
  'closeZellijTerminal'
];
const statements = source.statements.filter(
  (statement) =>
    ts.isVariableStatement(statement) &&
    statement.declarationList.declarations.some((declaration) =>
      names.includes(declaration.name.getText(source))
    )
);
assert.equal(statements.length, names.length);
const code = ts.transpileModule(
  statements.map((statement) => statement.getText(source).replace(/^export /u, '')).join('\n') +
    '\nglobalThis.prepare=prepareZellijTerminal;globalThis.stop=stopZellijRuntime;globalThis.close=closeZellijTerminal;',
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } }
).outputText;
const deferred = () => {
  let resolve;
  const promise = new Promise((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
};
const flush = () => new Promise((resolve) => setImmediate(resolve));
// The lifecycle statements now emit diagnostics. Stubbed rather than captured: these tests are
// about ordering, and a real writer would put [zellij] lines in the test output.
const diagnostics = () => ({
  zellijLog: { info: () => {}, warn: () => {}, error: () => {} },
  zellijDetail: () => 'detail=none',
  zellijSurfaceTag: (value) => value,
  zellijSessionTag: (value) => value,
  getRuntimeProfile: () => ({ id: 'production-debug' }),
  ZellijNativeIpcError: class ZellijNativeIpcError extends Error {},
  sessionMappings: () => new Map(),
  rememberPreparedSession: () => {},
  zellijErrorCode: (error) => error?.message ?? 'operation-failed',
  setTimeout,
  Date
});

test('reopen waits for directory, owned web process and bridge teardown before capturing its new generation', async () => {
  const directoryGate = deferred(),
    processGate = deferred(),
    bridgeGate = deferred();
  const calls = [];
  let exited = false;
  const runtime = {
    initialize: async () => {
      calls.push('initialize');
      return { status: 'ready' };
    },
    stop: async () => {
      calls.push('runtime-stop');
      await processGate.promise;
      exited = true;
    }
  };
  const directory = {
    waitForClosures: async () => {},
    stop: async () => {
      calls.push('directory-stop');
      await directoryGate.promise;
    },
    prepare: async () => {
      calls.push('prepare');
    }
  };
  const context = vm.createContext({
    ...diagnostics(),
    runtimeGeneration: 0,
    runtimeStopping: null,
    bridgeCleanup: null,
    surfaceGenerations: new Map(),
    preparedSurfaces: new Map(),
    healthTimer: null,
    clearInterval,
    runtime,
    directoryService: directory,
    webProcess: { exited: () => exited },
    webBridge: {
      stop: async () => {
        calls.push('bridge-stop');
        await bridgeGate.promise;
      }
    },
    process: { platform: 'win32' },
    runtimeConfig: {
      file: 'config.kdl',
      initialize: async () => {
        calls.push('ensure');
      }
    },
    readFileSync: () => '',
    parse: () => ({ nodes: [{ getName: () => 'web_sharing', getArguments: () => ['on'] }] }),
    getZellijRuntime: () => runtime,
    getZellijDirectories: () => directory,
    sessionName: (id) => id,
    zellijTerminalUrl: (id) => `http://127.0.0.1/${id}`
  });
  vm.runInContext(code, context);
  const stopping = context.stop();
  assert.equal(context.stop(), stopping);
  const preparing = context.prepare('reopen');
  await flush();
  assert.deepEqual(calls, ['directory-stop']);
  directoryGate.resolve();
  await flush();
  assert.deepEqual(calls, ['directory-stop', 'runtime-stop']);
  processGate.resolve();
  await flush();
  assert.deepEqual(calls, ['directory-stop', 'runtime-stop', 'bridge-stop']);
  bridgeGate.resolve();
  await stopping;
  assert.equal(await preparing, 'http://127.0.0.1/reopen');
  assert.deepEqual(calls, [
    'directory-stop',
    'runtime-stop',
    'bridge-stop',
    'initialize',
    'ensure',
    'prepare'
  ]);
});

test('an explicit close invalidates an opening queued behind global shutdown', async () => {
  const gate = deferred();
  const calls = [];
  const directory = {
    waitForClosures: async () => {},
    stop: () => gate.promise,
    close: async (id) => calls.push(`close:${id}`),
    prepare: async () => calls.push('prepare')
  };
  const runtime = {
    initialize: async () => {
      calls.push('initialize');
      return { status: 'ready' };
    },
    stop: async () => calls.push('runtime-stop')
  };
  const context = vm.createContext({
    ...diagnostics(),
    runtimeGeneration: 0,
    runtimeStopping: null,
    bridgeCleanup: null,
    surfaceGenerations: new Map(),
    preparedSurfaces: new Map(),
    healthTimer: null,
    clearInterval,
    runtime,
    directoryService: directory,
    webProcess: null,
    webBridge: null,
    getZellijDirectories: () => directory,
    getZellijRuntime: () => runtime,
    sessionName: (id) => id
  });
  vm.runInContext(code, context);
  const stopping = context.stop();
  const rejected = assert.rejects(context.prepare('closed'), /operation-failed/);
  await context.close('closed');
  gate.resolve();
  await stopping;
  await rejected;
  assert.deepEqual(calls, ['close:closed', 'runtime-stop']);
});

test('global shutdown joins explicit closes admitted during web teardown, including stop failure', async () => {
  for (const fails of [false, true]) {
    const webGate = deferred();
    const closeGate = deferred();
    const closings = new Set();
    let completed = false;
    const directory = {
      stop: async () => {},
      close: () => {
        const closing = closeGate.promise.finally(() => closings.delete(closing));
        closings.add(closing);
        return closing;
      },
      waitForClosures: async () => {
        while (closings.size) await Promise.allSettled([...closings]);
      }
    };
    const context = vm.createContext({
      ...diagnostics(),
      runtimeGeneration: 0,
      runtimeStopping: null,
      bridgeCleanup: null,
      surfaceGenerations: new Map(),
      preparedSurfaces: new Map(),
      healthTimer: null,
      clearInterval,
      runtime: {
        stop: async () => {
          await webGate.promise;
          if (fails) throw new Error('operation-failed');
        }
      },
      directoryService: directory,
      webProcess: null,
      webBridge: null,
      getZellijDirectories: () => directory,
      sessionName: (id) => id
    });
    vm.runInContext(code, context);
    const stopping = context.stop();
    const settled = (fails ? assert.rejects(stopping, /operation-failed/) : stopping).then(
      () => (completed = true)
    );
    await flush();
    const closing = context.close('late-close');
    webGate.resolve();
    await flush();
    assert.equal(completed, false);
    closeGate.resolve();
    await closing;
    await settled;
    assert.equal(completed, true);
  }
});

test('only Darwin requires an owned web namespace; Windows retains matching-server reuse', async () => {
  let probe;
  const visit = (node) => {
    if (ts.isPropertyAssignment(node) && node.name.getText(source) === 'probe')
      probe = node.initializer;
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(probe);
  const probeCode = ts.transpileModule(`globalThis.probe=${probe.getText(source)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const context = vm.createContext({
    ...diagnostics(),
    process: { platform: 'darwin' },
    webProcess: null,
    AbortSignal,
    zellijOrigin: () => 'http://127.0.0.1:1',
    fetch: async () => ({ ok: true, text: async () => '0.45.1' })
  });
  vm.runInContext(probeCode, context);
  assert.equal(await context.probe(), 'occupied');
  context.process.platform = 'win32';
  assert.equal(await context.probe(), 'matching');
  context.process.platform = 'darwin';
  context.webProcess = { exited: () => false };
  assert.equal(await context.probe(), 'matching');
  context.webProcess = { exited: () => true };
  assert.equal(await context.probe(), 'occupied');
});

/** Which of `names` this file actually calls, in source order. */
const callsIn = (file, names) => {
  const parsed = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const calls = [];
  const visit = (node) => {
    if (ts.isCallExpression(node) && names.includes(node.expression.getText(parsed)))
      calls.push(node.expression.getText(parsed));
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return calls;
};

test('app quit disposes every terminal host before the final Zellij runtime drain', () => {
  // The ORDER is the protection, and only quit drains: `zellijWindowService.destroy()` calls
  // `stopZellijRuntime()`, which stops the shared web server. A host still alive after that could
  // admit a close against a drained runtime.
  const file = 'src/main/app.main.ts';
  const expected = [
    'maestroWindowHandler.destroyForHostQuit',
    'omniWindowHelper.destroy',
    'zellijWindowService.destroy'
  ];
  assert.deepEqual(
    callsIn(file, expected),
    expected,
    `${file}: no live terminal host can admit a close after the drain`
  );
});

test('logout revokes only account-bound owners and never makes Zellij or Omni unusable', () => {
  // Ral 2026-09-17:「omni 和 zellij 都不依赖账号登录,所以首先登出不应该导致 zellij 和 omni 不可用,
  // 可能之前某个过时需求导致这么做了」。This replaces the older contract, which required logout to
  // tear these down too — the assertion below is deliberately INVERTED so re-adding them fails.
  //
  // Why it matters more than "one extra window closes": logout is not only the manual button. A 401
  // broadcasts `auth/invalidated`, and the renderer answers it by calling `deactivateSession()`
  // (src/renderer/home/src/xpc/auth.subscriber.ts). Draining here would therefore cut every open
  // terminal's surface loose each time a token expires — and `stopZellijRuntime()` would take the
  // shared web server with it.
  const file = 'src/main/xpc/auth.handler.ts';
  const accountBound = [
    'coinWindowHandler._destroyForAuth',
    'todoWindowHandler._destroyForAuth',
    'eyesOnAgentsWindowHandler._destroyForAuth',
    'maestroWindowHandler._destroyForAuth'
  ];
  assert.deepEqual(
    callsIn(file, accountBound),
    accountBound,
    `${file}: every account-bound owner must still be revoked on logout`
  );
  // Ral 2026-09-17 扩展到同一类能力:「登出不应影响 onlypreview 及 browser 的功能」。
  const accountFree = [
    'omniWindowHelper.destroy',
    'zellijWindowService.destroy',
    'stopZellijRuntime',
    'destroyOnlyPreviewForAuth'
  ];
  assert.deepEqual(
    callsIn(file, accountFree),
    [],
    `${file}: logout must not tear down capabilities that do not depend on the account`
  );
});

test('only account-bound composite tabs are suspended on logout', () => {
  // The browser / Zellij / OnlyPreview tabs survive logout for exactly one reason:
  // `maestroBrowserView.service.ts` `suspendProtectedTabs()` skips every spec that does not set
  // `requiresAuthentication`, and `maestroWindowHandler._destroyForAuth()` reaches nothing else that
  // closes a tab (it ends in `suspendAuthenticatedSession()`, whose own comment reads "browser tabs
  // and local tool mounts are retained"). Marking one more spec would silently close that surface on
  // every 401, so the set is pinned here rather than left to review.
  const marked = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.ts') && /requiresAuthentication:\s*true/u.test(readFileSync(full, 'utf8')))
        marked.push(full);
    }
  };
  walk('src/main');
  assert.deepEqual(
    marked,
    ['src/main/windows/trenchCoworkTab.ts'],
    'only account-bound surfaces may be suspended on logout — Zellij/OnlyPreview/browser must not be'
  );
});
