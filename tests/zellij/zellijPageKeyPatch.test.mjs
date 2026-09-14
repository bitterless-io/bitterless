/* eslint-disable @typescript-eslint/explicit-function-return-type */

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import test from 'node:test';
import { build } from 'esbuild';

/**
 * Esc delivered ZERO bytes to the pty on the owner's session while Option+Enter delivered `1b 0d`
 * intact — so a lone `\x1b` is what fails, not an ESC byte. These tests run the patch's injected
 * source for real, in a fake DOM, rather than asserting on the string: what matters is the bytes a
 * keypress produces, and that nothing else in the page gets a turn at the same key.
 */
const directory = mkdtempSync(join(tmpdir(), 'zellij-page-key-patch-'));
test.after(() => rmSync(directory, { recursive: true, force: true }));

const outfile = join(directory, 'patch.cjs');
await build({
  stdin: {
    contents: `export {bindZellijPageKeyPatch} from '${process.cwd()}/src/main/zellij/zellijPageKeyPatch.ts';`,
    resolveDir: process.cwd(),
    loader: 'ts'
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile,
  plugins: [
    {
      name: 'electron-stub',
      setup(builder) {
        builder.onResolve({ filter: /^electron$/ }, () => ({
          path: 'electron',
          namespace: 'electron-stub'
        }));
        builder.onLoad({ filter: /.*/, namespace: 'electron-stub' }, () => ({
          contents: 'export const clipboard = {};',
          loader: 'js'
        }));
      }
    }
  ]
});
const { bindZellijPageKeyPatch } = createRequire(import.meta.url)(outfile);

const ESC = String.fromCharCode(27);

/** Binds the patch and returns the source it asked the page to run. */
const capturePatchSource = () => {
  const scripts = [];
  const webContents = {
    on: (event, handler) => {
      if (event === 'did-finish-load') webContents.load = handler;
    },
    executeJavaScript: async (script) => {
      scripts.push(script);
      return 'installed';
    }
  };
  bindZellijPageKeyPatch(webContents);
  webContents.load();
  return { scripts, webContents };
};

/** A DOM small enough to read, with only what the patch actually touches. */
const runPatchInFakeDom = (source, { hasSendFn = true } = {}) => {
  const listeners = [];
  const sent = [];
  const window = {
    __zjImeBypass: hasSendFn ? { sendFn: (data) => sent.push(data) } : undefined
  };
  const context = createContext({
    window,
    document: {
      addEventListener: (type, handler, capture) => listeners.push({ type, handler, capture })
    }
  });
  const result = runInContext(source, context);
  const press = (overrides = {}) => {
    const event = {
      key: 'Escape',
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      prevented: false,
      stopped: false,
      preventDefault() { this.prevented = true; },
      stopPropagation() { this.stopped = true; },
      ...overrides
    };
    for (const listener of listeners) listener.handler(event);
    return event;
  };
  return { result, listeners, sent, press };
};

test('a bare Escape becomes a COMPLETE Kitty sequence, never a lone ESC byte', () => {
  const { scripts } = capturePatchSource();
  const { result, sent, press } = runPatchInFakeDom(scripts[0]);

  assert.equal(result, 'installed');
  const event = press();
  // `CSI 27;1 u` — the `;1` is the shape Zellij's own encoder emits, and the whole point is that it
  // cannot be mistaken for an escape sequence still arriving.
  assert.deepEqual(sent, [`${ESC}[27;1u`]);
  assert.equal(sent[0].length, 7, 'a bare ESC would be 1 byte; this must be the full sequence');
  assert.equal(event.prevented, true);
  assert.equal(
    event.stopped,
    true,
    'xterm must not ALSO emit a bare ESC, or Esc doubles the day the server flushes one'
  );
});

test('Shift+Enter and Option+Enter both send ESC+CR — a newline, not a submit', () => {
  for (const held of ['shiftKey', 'altKey']) {
    const { scripts } = capturePatchSource();
    const { sent, press } = runPatchInFakeDom(scripts[0]);

    const event = press({ key: 'Enter', [held]: true });
    assert.deepEqual(sent, [`${ESC}\r`], `${held}+Enter must produce ESC+CR`);
    assert.equal(event.prevented, true);
    assert.equal(event.stopped, true, 'xterm must not also send its own bare CR');
  }
});

test('plain Enter still submits, and Shift+Option+Enter is not guessed at', () => {
  const { scripts } = capturePatchSource();
  const { sent, press } = runPatchInFakeDom(scripts[0]);

  const plain = press({ key: 'Enter' });
  assert.equal(plain.prevented, false, 'plain Enter is a submit and must reach the program as CR');

  // Exactly one of Shift/Option is the contract; both held is a combination this app does not own.
  const both = press({ key: 'Enter', shiftKey: true, altKey: true });
  assert.equal(both.prevented, false);

  for (const held of ['ctrlKey', 'metaKey']) {
    const event = press({ key: 'Enter', shiftKey: true, [held]: true });
    assert.equal(event.prevented, false, `${held} may be a real Zellij bind`);
  }
  assert.deepEqual(sent, [], 'nothing was sent for any of them');
});

test('it listens in the CAPTURE phase, so it runs before xterm own handler', () => {
  const { scripts } = capturePatchSource();
  const { listeners } = runPatchInFakeDom(scripts[0]);

  assert.equal(listeners.length, 1);
  assert.equal(listeners[0].type, 'keydown');
  assert.equal(listeners[0].capture, true, 'bubble phase would be too late if xterm drops the key');
});

test('modified Escape is left alone — it may be a real Zellij bind', () => {
  const { scripts } = capturePatchSource();
  const { sent, press } = runPatchInFakeDom(scripts[0]);

  for (const held of ['altKey', 'ctrlKey', 'metaKey', 'shiftKey']) {
    const event = press({ [held]: true });
    assert.equal(event.prevented, false, `${held}+Escape must not be claimed`);
  }
  assert.deepEqual(sent, [], 'nothing was sent for any modified Escape');
});

test('other keys are untouched', () => {
  const { scripts } = capturePatchSource();
  const { sent, press } = runPatchInFakeDom(scripts[0]);

  const event = press({ key: 'a' });
  assert.equal(event.prevented, false);
  assert.deepEqual(sent, []);
});

test('the send function arriving AFTER injection still works', () => {
  // The real failure this pins: Zellij creates `__zjImeBypass` inside `setupInputHandlers`, well
  // after `did-finish-load`. An up-front guard skipped installing the listener entirely, so the
  // patch never ran once — "[zellij] page key patch not installed reason=no-send-function" on every
  // app start, 2026-09-14.
  const { scripts } = capturePatchSource();
  const listeners = [];
  const sent = [];
  const window = {};
  const context = createContext({
    window,
    document: { addEventListener: (type, handler, capture) => listeners.push({ type, handler, capture }) }
  });

  assert.equal(runInContext(scripts[0], context), 'installed-send-pending');
  assert.equal(listeners.length, 1, 'the listener must be installed before Zellij is ready');

  // Zellij finishes booting and installs its IME bypass.
  window.__zjImeBypass = { sendFn: (data) => sent.push(data) };

  const event = {
    key: 'Escape',
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    prevented: false,
    preventDefault() { this.prevented = true; },
    stopPropagation() {}
  };
  listeners[0].handler(event);
  assert.deepEqual(sent, [`${ESC}[27;1u`], 'the late send function must be picked up');
  assert.equal(event.prevented, true);
});

test('a send function that never arrives declines the keys instead of swallowing them', () => {
  const { scripts } = capturePatchSource();
  // A Zellij upgrade moving `__zjImeBypass` must degrade to today's broken keys, not to keys this
  // app silently eats.
  const { result, sent, press } = runPatchInFakeDom(scripts[0], { hasSendFn: false });

  assert.equal(result, 'installed-send-pending');
  const event = press();
  assert.equal(event.prevented, false, 'declined, so xterm still gets its turn at the key');
  assert.deepEqual(sent, []);
});

test('a reload re-runs the patch, and the guard keeps one listener', () => {
  const { scripts, webContents } = capturePatchSource();
  webContents.load();
  assert.equal(scripts.length, 2, 'every load must re-apply — a reload would lose the repair');

  // Both runs share one page, as a real reload would not, which is exactly what the guard is for.
  const listeners = [];
  const window = { __zjImeBypass: { sendFn: () => {} } };
  const context = createContext({
    window,
    document: { addEventListener: (type, handler, capture) => listeners.push({ type, handler, capture }) }
  });
  assert.equal(runInContext(scripts[0], context), 'installed');
  assert.equal(runInContext(scripts[1], context), 'already-installed');
  assert.equal(listeners.length, 1, 'a second install would send every claimed key twice');
});
