/* eslint-disable @typescript-eslint/explicit-function-return-type -- Native Node fixtures. */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';

const directory = mkdtempSync(join(tmpdir(), 'zellij-renderer-load-'));
const output = join(directory, 'renderer.cjs');
await build({
  stdin: {
    contents: `export {loadZellijRenderer} from './src/main/zellij/zellijRendererLoad.service';
      export {promptZellijRendererRetry} from './src/main/zellij/zellijRendererDialog.service';
      export {dialogs} from 'electron';`,
    resolveDir: process.cwd(),
    loader: 'ts'
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: output,
  plugins: [
    {
      name: 'native-dialog',
      setup(builder) {
        builder.onResolve({ filter: /^electron$/ }, () => ({
          path: 'electron',
          namespace: 'fixture'
        }));
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
          contents: `export const dialogs=[];export const dialog={showMessageBox:(owner,options)=>new Promise((resolve,reject)=>dialogs.push({owner,options,resolve,reject}))};`
        }));
      }
    }
  ]
});
const { loadZellijRenderer, promptZellijRendererRetry, dialogs } = createRequire(import.meta.url)(
  output
);
const contents = () => Object.assign(new EventEmitter(), { isDestroyed: () => false });
test.after(() => rmSync(directory, { recursive: true, force: true }));

test('deadline is phase-specific and late rejection is observed without reviving the load', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const view = contents();
  let reject;
  const operation = new Promise((_, no) => {
    reject = no;
  });
  const loading = loadZellijRenderer(
    view,
    () => operation,
    'controls',
    new AbortController().signal
  );
  const rejected = assert.rejects(loading, { message: 'controls-load-timeout' });
  t.mock.timers.tick(15_000);
  await rejected;
  assert.equal(view.listenerCount('destroyed'), 0);
  reject(Error('late failure'));
  await Promise.resolve();
});

test('immediate navigation failure reports a typed code, without leaking navigation detail', async () => {
  await assert.rejects(
    loadZellijRenderer(
      contents(),
      () => Promise.reject(Error('private URL')),
      'terminal',
      new AbortController().signal
    ),
    { message: 'terminal-load-failed' }
  );
});

test('dispose settles hung navigation and removes its destroyed listener', async () => {
  const view = contents();
  const controller = new AbortController();
  const loading = loadZellijRenderer(
    view,
    () => new Promise(() => {}),
    'terminal',
    controller.signal
  );
  const rejected = assert.rejects(loading, { message: 'operation-failed' });
  controller.abort();
  await rejected;
  assert.equal(view.listenerCount('destroyed'), 0);
});

test('success removes deadline and an already disposed view never navigates', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const view = contents();
  await loadZellijRenderer(view, () => Promise.resolve(), 'terminal', new AbortController().signal);
  assert.equal(view.listenerCount('destroyed'), 0);
  t.mock.timers.tick(15_000);
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  await assert.rejects(
    loadZellijRenderer(
      view,
      () => {
        calls++;
        return Promise.resolve();
      },
      'controls',
      controller.signal
    )
  );
  assert.equal(calls, 0);
});

test('native Retry is deduplicated per owner, Dismiss is inert, and aborted responses cannot retry', async () => {
  const owner = { isDestroyed: () => false };
  const labels = {
    title: 'Zellij',
    message: 'Controls failed',
    retry: 'Retry',
    dismiss: 'Dismiss'
  };
  const first = new AbortController();
  const pending = promptZellijRendererRetry(owner, labels, first.signal);
  const initial = dialogs.length;
  assert.equal(await promptZellijRendererRetry(owner, labels, new AbortController().signal), false);
  assert.equal(dialogs.length, initial);
  assert.deepEqual(dialogs.at(-1).options.buttons, ['Retry', 'Dismiss']);
  dialogs.at(-1).resolve({ response: 1 });
  assert.equal(await pending, false);
  const second = new AbortController();
  const next = promptZellijRendererRetry(owner, labels, second.signal);
  second.abort();
  dialogs.at(-1).resolve({ response: 0 });
  assert.equal(await next, false);
  const retry = promptZellijRendererRetry(owner, labels, new AbortController().signal);
  dialogs.at(-1).resolve({ response: 0 });
  assert.equal(await retry, true);
});
