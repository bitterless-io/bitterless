/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

// Exercise the production capture class with only WebContents/CDP replaced. No
// Electron process or browser is started, and pending CDP replies are injected.
const root = resolve(import.meta.dirname, '../..');
const bundle = await build({
  entryPoints: [resolve(root, 'src/main/maestro/capture/debuggerCapture.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  write: false,
  tsconfig: resolve(root, 'tsconfig.node.json')
});
const directory = mkdtempSync(join(tmpdir(), 'maestro-capture-navigation-'));
const bundlePath = join(directory, 'capture.cjs');
let DebuggerCapture;
try {
  writeFileSync(bundlePath, bundle.outputFiles[0].text);
  ({ DebuggerCapture } = await import(pathToFileURL(bundlePath).href));
} finally {
  rmSync(directory, { recursive: true, force: true });
}

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};

const requiredCommands = [
  'Network.enable',
  'Fetch.enable',
  'Network.setUserAgentOverride',
  'Page.enable',
  'Page.addScriptToEvaluateOnNewDocument'
];
const interceptionRule = {
  id: 'block-example',
  action: 'block',
  urlContains: 'example.invalid',
  once: false,
  enabled: true,
  createdAt: 1
};

const fixture = (context) => {
  const debuggerApi = new EventEmitter();
  const commands = [];
  const replies = new Map();
  const events = [];
  let nativeAttached = false;
  let attachCount = 0;
  let detachCount = 0;
  let destroyed = false;
  debuggerApi.attach = (protocol) => {
    assert.equal(protocol, '1.3');
    assert.equal(nativeAttached, false, 'one native debugger attachment per preparation');
    attachCount += 1;
    nativeAttached = true;
  };
  debuggerApi.detach = () => {
    detachCount += 1;
    nativeAttached = false;
    debuggerApi.emit('detach', {}, 'canceled_by_user');
  };
  debuggerApi.isAttached = () => nativeAttached;
  debuggerApi.sendCommand = (method, params) => {
    commands.push({ method, params });
    const reply = replies.get(method);
    return reply ? reply(params) : Promise.resolve({});
  };
  const capture = new DebuggerCapture({ debugger: debuggerApi, isDestroyed: () => destroyed },
    (event) => events.push(event));
  context.after(() => capture.detach());
  return {
    capture, debuggerApi, commands, replies, events,
    methods: () => commands.map(({ method }) => method),
    attachCount: () => attachCount,
    detachCount: () => detachCount,
    destroy: () => { destroyed = true; },
    externalDetach: () => {
      nativeAttached = false;
      debuggerApi.emit('detach', {}, 'target_closed');
    }
  };
};

test('navigation readiness resolves while attach is still waiting for Runtime.evaluate', async (context) => {
  const f = fixture(context);
  const evaluate = deferred();
  f.replies.set('Runtime.evaluate', () => evaluate.promise);
  let attached = false;
  const attachment = f.capture.attach().then(() => { attached = true; });
  const preparation = f.capture.prepareNavigation();
  await preparation;
  await setImmediate();
  assert.equal(f.capture.isAttached(), true);
  assert.equal(attached, false);
  assert.equal(f.methods().at(-1), 'Runtime.evaluate');
  assert.ok(f.methods().includes('Page.addScriptToEvaluateOnNewDocument'));
  assert.equal(f.capture.prepareNavigation(), preparation);
  assert.equal(f.attachCount(), 1);
  evaluate.resolve({});
  await attachment;
});

test('all required CDP configuration completes before readiness, including Fetch, UA and new-document script', async (context) => {
  const f = fixture(context);
  await f.capture.setInterceptionRules([interceptionRule]);
  const gates = new Map(requiredCommands.map((method) => [method, deferred()]));
  for (const [method, gate] of gates) f.replies.set(method, () => gate.promise);
  let ready = false;
  const preparation = f.capture.prepareNavigation().then(() => { ready = true; });
  for (const [index, method] of requiredCommands.entries()) {
    await setImmediate();
    assert.deepEqual(f.methods(), requiredCommands.slice(0, index + 1));
    assert.equal(ready, false, `${method} must be acknowledged before navigation`);
    gates.get(method).resolve({});
  }
  await preparation;
  assert.equal(ready, true);
  assert.deepEqual(f.commands.find(({ method }) => method === 'Fetch.enable').params,
    { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
  const identity = f.commands.find(({ method }) => method === 'Network.setUserAgentOverride').params;
  assert.match(identity.userAgent, /Chrome\//);
  assert.ok(identity.userAgentMetadata.brands.length > 0);
  assert.ok(f.commands.at(-1).params.source.length > 0);
  assert.equal(f.methods().includes('Runtime.evaluate'), false);
});

for (const method of requiredCommands) {
  test(`required ${method} failure rejects readiness, detaches and permits explicit retry`, async (context) => {
    const f = fixture(context);
    await f.capture.setInterceptionRules([interceptionRule]);
    const failure = new Error(`required ${method} rejected`);
    f.replies.set(method, () => Promise.reject(failure));
    const failedPreparation = f.capture.prepareNavigation();
    await assert.rejects(failedPreparation, (error) => error === failure);
    assert.deepEqual(f.methods(), requiredCommands.slice(0, requiredCommands.indexOf(method) + 1));
    assert.equal(f.capture.isAttached(), false);
    assert.equal(f.detachCount(), 1);
    assert.ok(f.events.some(({ kind, msg }) => kind === 'error' && msg.startsWith('capture setup failed:')));
    f.replies.delete(method);
    const retry = f.capture.prepareNavigation();
    assert.notEqual(retry, failedPreparation);
    await retry;
    assert.equal(f.capture.isAttached(), true);
    assert.equal(f.attachCount(), 2);
  });
}

test('required preparation times out at five seconds and a late old reply cannot disturb retry', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(context);
  const network = deferred();
  f.replies.set('Network.enable', () => network.promise);
  const preparation = f.capture.prepareNavigation();
  let rejected = false;
  const rejection = assert.rejects(preparation, /navigation preparation timed out/)
    .then(() => { rejected = true; });
  context.mock.timers.tick(4999);
  await setImmediate();
  assert.equal(rejected, false);
  assert.equal(f.capture.isAttached(), true);
  context.mock.timers.tick(1);
  await rejection;
  assert.equal(f.capture.isAttached(), false);
  assert.equal(f.detachCount(), 1);
  f.replies.delete('Network.enable');
  const retry = f.capture.prepareNavigation();
  await retry;
  const methodsAfterRetry = f.methods();
  network.resolve({});
  await setImmediate();
  assert.deepEqual(f.methods(), methodsAfterRetry, 'obsolete setup must stop after its pending command');
  assert.equal(f.capture.isAttached(), true);
  assert.equal(f.capture.prepareNavigation(), retry);
  assert.equal(f.detachCount(), 1);
  context.mock.timers.tick(5000);
  await setImmediate();
  assert.equal(f.capture.isAttached(), true, 'successful setup clears its timeout');
});

test('detach invalidates cached readiness and stale setup cannot configure a newer attachment', async (context) => {
  const f = fixture(context);
  const network = deferred();
  f.replies.set('Network.enable', () => network.promise);
  const oldPreparation = f.capture.prepareNavigation();
  assert.equal(f.capture.prepareNavigation(), oldPreparation);
  const rejection = assert.rejects(oldPreparation, /preparation was cancelled/);
  f.capture.detach();
  f.replies.delete('Network.enable');
  const preparation = f.capture.prepareNavigation();
  assert.notEqual(preparation, oldPreparation);
  await preparation;
  const methods = f.methods();
  network.resolve({});
  await rejection;
  assert.deepEqual(f.methods(), methods);
  assert.equal(f.capture.isAttached(), true);
  assert.equal(f.capture.prepareNavigation(), preparation);
  assert.equal(f.attachCount(), 2);
  assert.equal(f.detachCount(), 1);
});

test('external debugger detach invalidates readiness without duplicating event listeners', async (context) => {
  const f = fixture(context);
  const oldPreparation = f.capture.prepareNavigation();
  await oldPreparation;
  f.externalDetach();
  assert.equal(f.capture.isAttached(), false);
  assert.ok(f.events.some(({ msg }) => msg === 'debugger detached: target_closed'));
  const preparation = f.capture.prepareNavigation();
  assert.notEqual(preparation, oldPreparation);
  await preparation;
  assert.equal(f.attachCount(), 2);
  assert.equal(f.debuggerApi.listenerCount('detach'), 1);
  assert.equal(f.debuggerApi.listenerCount('message'), 1);
});

test('suspend rejects navigation until resume rebuilds readiness and caches it again', async (context) => {
  const f = fixture(context);
  const oldPreparation = f.capture.prepareNavigation();
  await oldPreparation;
  f.capture.suspend();
  assert.equal(f.capture.isSuspended(), true);
  assert.equal(f.capture.isAttached(), false);
  await assert.rejects(f.capture.prepareNavigation(), /capture is unavailable/);
  await f.capture.attach();
  assert.equal(f.attachCount(), 1);
  await f.capture.resume();
  assert.equal(f.capture.isSuspended(), false);
  assert.equal(f.capture.isAttached(), true);
  const preparation = f.capture.prepareNavigation();
  assert.notEqual(preparation, oldPreparation);
  await preparation;
  const methods = f.methods();
  await f.capture.resume();
  assert.deepEqual(f.methods(), methods);
  assert.equal(f.attachCount(), 2);
  assert.equal(f.methods().filter((method) => method === 'Runtime.evaluate').length, 1);
});

test('current-document evaluation is best effort after successful navigation preparation', async (context) => {
  const f = fixture(context);
  f.replies.set('Runtime.evaluate', () => Promise.reject(new Error('no execution context')));
  await f.capture.attach();
  const preparation = f.capture.prepareNavigation();
  await preparation;
  assert.equal(f.capture.isAttached(), true);
  assert.equal(f.detachCount(), 0);
  assert.equal(f.events.length, 0);
});

test('destroyed WebContents cannot start navigation preparation', async (context) => {
  const f = fixture(context);
  f.destroy();
  await assert.rejects(f.capture.prepareNavigation(), /capture is unavailable/);
  await f.capture.attach();
  assert.equal(f.attachCount(), 0);
  assert.deepEqual(f.methods(), []);
});
