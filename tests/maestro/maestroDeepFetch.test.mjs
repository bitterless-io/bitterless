import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { test } from 'node:test';
import ts from 'typescript';

const root = resolve(import.meta.dirname, '../..');
const require = createRequire(import.meta.url);
const load = (path, dependencies, globals = {}) => {
  const result = ts.transpileModule(readFileSync(resolve(root, path), 'utf8'), {
    fileName: path, reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  });
  assert.equal(result.diagnostics?.filter(item => item.category === ts.DiagnosticCategory.Error).length, 0);
  const module = { exports: {} };
  new Function('require', 'module', 'exports', ...Object.keys(globals), result.outputText)(name => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected import: ${name}`);
    return dependencies[name];
  }, module, module.exports, ...Object.values(globals));
  return module.exports;
};
const policy = load('src/main/net/fetchPolicy.ts', {});
const extraction = load('src/main/net/articleExtract.ts', {
  '@mozilla/readability': require('@mozilla/readability'), linkedom: require('linkedom')
});
const format = load('src/main/agent/tools/webFetchFormat.ts', {});
const body = 'Shanghai forecast fixture for the requested weekend. This deterministic source is only offline test data. '.repeat(12);
const html = `<html><head><title>Forecast fixture</title></head><body><article><h1>Forecast fixture</h1><p>${body}</p></article></body></html>`;

const fixture = ({ failure, pending = false, snapshotFailure = false } = {}) => {
  const state = { opened: 0, done: 0, windows: 0, loads: [], reads: 0, captured: 0, destroyed: false };
  const timers = new Map();
  const sess = new EventEmitter();
  sess.setPermissionRequestHandler = callback => { state.requestPermission = callback; };
  sess.setPermissionCheckHandler = callback => { state.checkPermission = callback; };
  class FakeContents extends EventEmitter {
    setWindowOpenHandler(callback) { state.openWindow = callback; }
    async loadURL(url) {
      assert.equal(sess.listenerCount('will-download'), 1, 'Download guard precedes navigation');
      assert.equal(this.listenerCount('will-redirect'), 1, 'Redirect guard precedes navigation');
      assert.deepEqual(state.openWindow(), { action: 'deny' });
      state.loads.push(url);
      if (failure === 'load') throw new Error('fixture navigation failed');
      if (pending) return new Promise(() => {});
      this.emit('did-finish-load');
    }
    getURL() { return 'https://weather.example/forecast'; }
    async executeJavaScriptInIsolatedWorld(world, scripts) {
      state.reads++;
      assert.equal(world, 1);
      assert.equal(scripts.length, 1);
      if (failure === 'read') throw new Error('fixture extraction read failed');
      return { html, htmlLength: html.length, title: 'Forecast fixture', textFallback: body };
    }
  }
  const wc = new FakeContents();
  const surface = {
    async open(url) {
      state.opened++;
      assert.equal(url, 'https://weather.example/forecast');
      return { wc, done: async () => { state.done++; state.destroyed = true; } };
    }
  };
  const module = load('src/main/net/deepFetch.ts', {
    electron: {
      session: { defaultSession: sess },
      BrowserWindow: class { constructor() { state.windows++; assert.fail('Injected tab must not construct BrowserWindow'); } }
    },
    '@main/logging/moduleLog': { moduleLog: () => ({ info() {}, warn() {} }) },
    '@main/net/fetchPolicy': policy,
    '@main/net/articleExtract': extraction,
    '@main/maestro/capture/debuggerCapture': { DebuggerCapture: class {
      constructor(target) { assert.equal(target, wc); }
      async attach() { state.captured++; }
      async snapshot() {
        if (snapshotFailure) throw new Error('fixture snapshot failed');
        return { ok: true, yaml: '- heading Forecast fixture [ref=e1]', nodeCount: 1 };
      }
    } }
  }, {
    setTimeout: (callback, ms) => {
      const id = Symbol(ms);
      timers.set(id, { callback, ms });
      if (ms === 1400) queueMicrotask(() => { if (timers.delete(id)) callback(); });
      return id;
    },
    clearTimeout: id => timers.delete(id)
  });
  return { ...module, state, sess, wc, surface, timers };
};

test('the real injected-tab path navigates WebContents and extracts content without constructing a window', async () => {
  const f = fixture();
  const result = await f.deepFetchPage('https://weather.example/forecast', 6000, 30000, f.surface);
  assert.deepEqual(f.state.loads, ['https://weather.example/forecast']);
  assert.equal(f.state.windows, 0);
  assert.equal(f.state.reads, 1);
  assert.equal(f.state.captured, 1);
  assert.match(result.article.text, /Shanghai forecast fixture/);
  assert.equal(result.finalUrl, 'https://weather.example/forecast');
  assert.equal(result.snapshotNodes, 1);
  assert.equal(f.state.done, 1);
  assert.equal(f.isDeepFetchContents(f.wc), false);
  assert.equal(f.sess.listenerCount('will-download'), 0);
  assert.equal(f.timers.size, 0);
  const output = format.formatFetchResult({ ...result, via: 'deep_fetch' });
  assert.doesNotMatch(output, /hidden window/);
  assert.match(output, /fresh page_snapshot/);
  assert.match(output, /third-party, untrusted/);
});

for (const failure of ['load', 'read']) {
  test(`${failure} failure disposes the tab, removes guards and releases the single-flight lock`, async () => {
    const f = fixture({ failure });
    await assert.rejects(f.deepFetchPage('https://weather.example/forecast', 6000, 30000, f.surface), error => {
      assert.match(error.message, /fixture/);
      if (failure === 'load') assert.equal(error.kind, 'load-failed');
      return true;
    });
    assert.equal(f.state.done, 1);
    assert.equal(f.isDeepFetchContents(f.wc), false);
    assert.equal(f.sess.listenerCount('will-download'), 0);
    assert.equal(f.timers.size, 0);
    await assert.rejects(f.deepFetchPage('https://weather.example/forecast', 6000, 30000, f.surface), error => error.kind !== 'busy');
    assert.equal(f.state.opened, 2);
  });
}

test('URL policy rejects before allocating a surface; redirects, downloads and permissions stay guarded', async () => {
  const f = fixture({ pending: true });
  await assert.rejects(f.deepFetchPage('http://127.0.0.1/private', 6000, 42, f.surface), policy.FetchPolicyError);
  assert.equal(f.state.opened, 0);
  const running = f.deepFetchPage('https://weather.example/forecast', 6000, 42, f.surface);
  const rejection = assert.rejects(running, error => error.kind === 'timeout');
  await setImmediate();
  assert.equal(f.isDeepFetchContents(f.wc), true);
  assert.equal(f.state.checkPermission(f.wc, 'clipboard-read'), false);
  let permission;
  f.state.requestPermission(f.wc, 'media', allowed => { permission = allowed; });
  assert.equal(permission, false);
  let redirectsBlocked = 0, downloadsBlocked = 0;
  f.wc.emit('will-redirect', { preventDefault() { redirectsBlocked++; } }, 'http://127.0.0.1/private');
  f.sess.emit('will-download', { preventDefault() { downloadsBlocked++; } }, {}, f.wc);
  assert.equal(redirectsBlocked, 1);
  assert.equal(downloadsBlocked, 1);
  await assert.rejects(f.deepFetchPage('https://weather.example/forecast', 6000, 42, f.surface), error => error.kind === 'busy');
  assert.equal(f.state.opened, 1);
  const timer = [...f.timers.values()].find(item => item.ms === 42);
  assert.ok(timer);
  timer.callback();
  await rejection;
  assert.equal(f.state.destroyed, true);
  assert.equal(f.isDeepFetchContents(f.wc), false);
  assert.equal(f.sess.listenerCount('will-download'), 0);
  assert.equal(f.timers.size, 0);
  await assert.rejects(f.deepFetchPage('http://localhost/private', 6000, 42, f.surface), policy.FetchPolicyError);
});

test('snapshot failure preserves extracted article success and still disposes the temporary tab', async () => {
  const f = fixture({ snapshotFailure: true });
  const result = await f.deepFetchPage('https://weather.example/forecast', 6000, 30000, f.surface);
  assert.match(result.article.text, /Shanghai forecast fixture/);
  assert.equal(result.snapshotYaml, null);
  assert.equal(f.state.done, 1);
});

test('native helper errors keep policy refusals separate from browser recovery without automatically opening a tab', async () => {
  const f = fixture();
  const skill = load('src/main/agent/deepFetch.skill.ts', {});
  let failure, calls = 0;
  const { buildWebFetchTools } = load('src/main/agent/tools/webFetchTools.ts', {
    '@main/agent/deepFetch.skill': skill,
    '@main/logging/moduleLog': { moduleLog: () => ({ warn() {} }) },
    '@main/net/fetchPolicy': policy,
    '@main/net/articleExtract': extraction,
    '@main/net/webFetch': { WebFetchError: class extends Error {}, fetchWebPage: () => assert.fail('No fallback is executed by the host') },
    '@main/net/deepFetch': { DeepFetchError: f.DeepFetchError, deepFetchPage: async (_url, maxChars, _timeout, surface) => {
      calls++;
      assert.equal(maxChars, 6000);
      assert.equal(surface, f.surface);
      throw failure;
    } },
    '@main/agent/tools/webFetchFormat': format
  });
  const tool = buildWebFetchTools(f.surface).find(item => item.name === 'deep_fetch');
  const errors = [
    new policy.FetchPolicyError('private-host', 'private destination rejected'),
    ...['policy', 'timeout', 'load-failed', 'extract', 'crashed', 'busy'].map(kind => new f.DeepFetchError(kind, `fixture ${kind}`)),
    new extraction.ExtractError('empty', 'fixture empty extraction'),
    new Error('fixture unexpected failure')
  ];
  for (const error of errors) {
    failure = error;
    const output = await tool.execute({ url: 'https://weather.example/forecast' });
    assert.match(output, /^ERROR: deep_fetch failed:/);
    assert.ok(output.includes(error.message));
    const blocked = error instanceof policy.FetchPolicyError || error.kind === 'policy';
    assert.equal(output.includes(skill.BROWSER_FETCH_RECOVERY), !blocked, 'Policy refusals never receive a browser bypass route');
  }
  assert.equal(calls, errors.length, 'Exactly one helper invocation per request');
  assert.equal(f.state.opened, 0, 'Error guidance is text; the host never runs a browser fallback');
});
