/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setImmediate as tick } from 'node:timers/promises';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const root = resolve(import.meta.dirname, '../..');
const sourcePath = 'src/main/windows/onlyPreviewWindow.helper.ts';
const source = ts.createSourceFile(sourcePath, readFileSync(resolve(root, sourcePath), 'utf8'), ts.ScriptTarget.Latest, true);
const declaration = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'OnlyPreviewWindowHelper');
const closeView = source.statements.find(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(item => item.name.getText(source) === 'closeView'));
const output = ts.transpileModule(`${closeView.getText(source)}\n${declaration.getText(source).replace(/^export /u, '')}`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 }
}).outputText;
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
class ContractError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const mountFixture = () => {
  const listeners = new Set();
  const window = { destroyed: false, isDestroyed() { return this.destroyed; } };
  const mount = {
    gone: false, window: () => window,
    isAlive: () => !mount.gone && !window.destroyed,
    onHostGone: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    reportGone() { this.gone = true; for (const listener of [...listeners]) listener(); },
    detach: () => undefined,
    destroyHost() { this.reportGone(); },
    dispose: () => listeners.clear()
  };
  return { mount, window, listeners };
};
const fixture = () => {
  let hostSequence = 0;
  let stops = 0;
  let shows = 0;
  const live = new Map();
  const creates = [];
  const starts = [];
  const destroyService = { destroy: () => undefined };
  const registry = {
    issue: () => { const host = { hostToken: `token-${++hostSequence}`, hostId: `host-${hostSequence}` }; live.set(host.hostToken, host); return host; },
    isLive: token => live.has(token),
    revoke: token => live.delete(token)
  };
  const diagnostics = { nextTag: () => 'v', now: () => 0, elapsed: () => 0, emit: () => undefined };
  const Helper = runInNewContext(`${output}\nOnlyPreviewWindowHelper;`, {
    console: { warn: () => undefined },
    shuttingDown: false,
    OnlyPreviewContractError: ContractError,
    onlyPreviewHostRegistry: registry,
    onlyPreviewOpenDiagnostics: {},
    createOnlyPreviewWindowOpenCoordinator: () => ({
      begin: () => ({ tag: 'open', mark: () => undefined }),
      finish: () => undefined, supersede: () => undefined
    }),
    fileSearchWindowService: {
      stop: () => { stops += 1; },
      releaseWorkspace: () => { stops += 1; },
      rebindHost: () => false,
      start: params => { const gate = deferred(); starts.push({ params, gate }); return gate.promise; }
    },
    onlyPreviewAlertWindowService: destroyService,
    onlyPreviewGlobalSearchWindowService: destroyService,
    onlyPreviewPreviewRegionService: destroyService,
    onlyPreviewViewLayerService: { stop: () => undefined },
    onlyPreviewGlobalSearchFocusService: { clear: () => undefined },
    onlyPreviewSearchBootstrapRegistry: { issue: () => ({ searchToken: 'bootstrap' }), revoke: () => undefined }
  });
  const helper = new Helper(diagnostics);
  helper.show = () => { shows += 1; };
  helper.finishShellOpenTrace = () => undefined;
  const create = async (host, mount = mountFixture().mount) => {
    const gate = deferred();
    creates.push({ host, mount, gate });
    helper.baseWindow = mount.window();
    helper.standaloneMount = mount;
    await gate.promise;
  };
  helper.createStandaloneWindow = host => create(host);
  helper.attachSurface = create;
  return { helper, Helper, registry, creates, starts, create, get stops() { return stops; }, get shows() { return shows; } };
};
const watch = promise => {
  let settled = false;
  void promise.then(() => { settled = true; }, () => { settled = true; });
  return () => settled;
};

test('cold standalone calls share readiness before returning a host or inspecting a target', async () => {
  const f = fixture();
  const first = f.helper.ensureStandalone('api');
  const second = f.helper.ensureStandalone('explicit');
  let inspections = 0;
  void second.then(() => { inspections += 1; });
  const third = f.helper.openOnMount(mountFixture().mount);
  const settled = [first, second, third].map(watch);
  await tick();
  assert.equal(f.creates.length, 1);
  assert.equal(inspections, 0);
  assert.deepEqual(settled.map(read => read()), [false, false, false]);
  f.creates[0].gate.resolve();
  const hosts = await Promise.all([first, second, third]);
  assert.ok(hosts.every(host => host === hosts[0]));
  assert.equal(inspections, 1);
  assert.equal(f.creates.length, 1);
});

test('cold tab calls and explicit standalone entry join the same mount opening', async () => {
  const f = fixture();
  const mount = mountFixture().mount;
  const first = f.helper.openOnMount(mount);
  const second = f.helper.ensureStandalone('explicit');
  const third = f.helper.openOnMount(mountFixture().mount);
  const settled = [first, second, third].map(watch);
  await tick();
  assert.equal(f.creates.length, 1);
  assert.equal(f.creates[0].mount, mount);
  assert.deepEqual(settled.map(read => read()), [false, false, false]);
  f.creates[0].gate.resolve();
  const hosts = await Promise.all([first, second, third]);
  assert.ok(hosts.every(host => host === hosts[0]));
});

test('ready surfaces are reused and shown without rebuilding', async () => {
  const f = fixture();
  const first = f.helper.ensureStandalone();
  await tick();
  f.creates[0].gate.resolve();
  const host = await first;
  assert.equal(await f.helper.ensureStandalone('explicit'), host);
  assert.equal(await f.helper.openOnMount(mountFixture().mount), host);
  assert.equal(f.creates.length, 1);
  assert.equal(f.shows, 2);
  assert.equal(f.helper.surfaceOpening, null);
});

test('startup failure rejects every waiter and cleans only the failed host', async () => {
  const f = fixture();
  const error = new Error('runtime unavailable');
  const opens = [f.helper.openOnMount(mountFixture().mount), f.helper.ensureStandalone('explicit')];
  const rejected = opens.map(promise => assert.rejects(promise, received => received === error));
  await tick();
  f.creates[0].gate.reject(error);
  await Promise.all(rejected);
  assert.equal(f.helper.getStandaloneHost(), null);
  assert.equal(f.helper.surfaceOpening, null);
  assert.equal(f.creates[0].mount.isAlive(), false);
});

test('teardown before native creation rejects waiters without starting an orphan runtime', async () => {
  const f = fixture();
  const opens = [f.helper.ensureStandalone(), f.helper.ensureStandalone('explicit')];
  const rejected = opens.map(promise => assert.rejects(promise, { code: 'HOST_NOT_FOUND' }));
  f.helper.destroyStandalone();
  await Promise.all(rejected);
  await tick();
  assert.equal(f.creates.length, 0);
  assert.equal(f.helper.getStandaloneHost(), null);
});

for (const lateOutcome of ['resolve', 'reject']) {
  test(`destroyed opening rejects immediately; its late ${lateOutcome} cannot clear a successor`, async () => {
    const f = fixture();
    const old = f.helper.ensureStandalone();
    const waiting = f.helper.openOnMount(mountFixture().mount);
    const rejected = [old, waiting].map(promise => assert.rejects(promise, { code: 'HOST_NOT_FOUND' }));
    await tick();
    const oldCreate = f.creates[0];
    f.helper.destroyStandalone();
    const next = f.helper.ensureStandalone();
    await Promise.all(rejected);
    await tick();
    const nextOpening = f.helper.surfaceOpening;
    const nextHost = f.helper.getStandaloneHost();
    const stops = f.stops;
    oldCreate.gate[lateOutcome](new Error('old runtime failed'));
    await tick();
    assert.equal(f.helper.surfaceOpening, nextOpening);
    assert.equal(f.helper.getStandaloneHost(), nextHost);
    assert.equal(f.stops, stops);
    f.creates[1].gate.resolve();
    assert.equal(await next, nextHost);
  });
}

test('host revocation before readiness cannot produce a successful open', async () => {
  const f = fixture();
  const opened = f.helper.ensureStandalone();
  const rejected = assert.rejects(opened, { code: 'HOST_NOT_FOUND' });
  await tick();
  f.registry.revoke(f.creates[0].host.hostToken);
  f.creates[0].gate.resolve();
  await rejected;
  assert.equal(f.helper.surfaceOpening, null);
});

test('actual attachSurface observes tab closure while its privileged runtime is still starting', async () => {
  const f = fixture();
  f.helper.attachSurface = f.Helper.prototype.attachSurface;
  const target = mountFixture();
  const opened = f.helper.openOnMount(target.mount);
  const waiter = f.helper.ensureStandalone('explicit');
  const rejected = [opened, waiter].map(promise => assert.rejects(promise, { code: 'HOST_NOT_FOUND' }));
  await tick();
  assert.equal(f.starts.length, 1);
  assert.equal(target.listeners.size, 1);
  target.mount.reportGone();
  await Promise.all(rejected);
  assert.equal(f.helper.getStandaloneHost(), null);
  assert.equal(target.listeners.size, 0);
  f.starts[0].gate.reject(new Error('closed runtime'));
  await tick();
});

test('late runtime failure callback cannot destroy a replacement host', async () => {
  const f = fixture();
  f.helper.attachSurface = f.Helper.prototype.attachSurface;
  const old = f.helper.openOnMount(mountFixture().mount);
  const rejected = assert.rejects(old, { code: 'HOST_NOT_FOUND' });
  await tick();
  f.helper.destroyStandalone();
  f.helper.attachSurface = f.create;
  const replacement = f.helper.openOnMount(mountFixture().mount);
  await rejected;
  await tick();
  const host = f.helper.getStandaloneHost();
  const stops = f.stops;
  f.starts[0].params.onUnexpectedExit('old failure');
  assert.equal(f.helper.getStandaloneHost(), host);
  assert.equal(f.stops, stops);
  f.starts[0].gate.reject(new Error('old load rejected'));
  f.creates[0].gate.resolve();
  assert.equal(await replacement, host);
});

test('readiness teardown preserves an in-flight search runtime during a host transition', async () => {
  const f = fixture();
  f.helper.beginHostTransition();
  const opened = f.helper.ensureStandalone();
  const rejected = assert.rejects(opened, { code: 'HOST_NOT_FOUND' });
  await tick();
  f.helper.destroyStandalone();
  await rejected;
  assert.equal(f.stops, 0);
  f.creates[0].gate.resolve();
  await tick();
  f.helper.endHostTransition();
});
