/* eslint-disable @typescript-eslint/explicit-function-return-type */

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';

/**
 * Zellij's web client encodes any Cmd-held key as a Kitty sequence built from
 * `ev.key.charCodeAt(0)`. For a named key that is the first letter of the NAME:
 *
 *     "Backspace".charCodeAt(0) === 66  // 'B'
 *
 * so Cmd+Delete reaches Zellij as Super+B and no keybind can recover it. These tests pin the
 * translation that runs before the page sees the event.
 */
const directory = mkdtempSync(join(tmpdir(), 'zellij-key-bridge-'));
test.after(() => rmSync(directory, { recursive: true, force: true }));

const outfile = join(directory, 'bridge.cjs');
// `electron` is stubbed, not externalized: the bridge writes to the real clipboard now, and a test
// that reached the OS clipboard would clobber whatever the developer had copied.
const ELECTRON_STUB = `
export const clipboard = {
  texts: [],
  writeText(text) { this.texts.push(text); }
};
`;
await build({
  stdin: {
    contents: `export {translateZellijCommandKey,zellijClipboardAction,copyZellijSelection,bindZellijKeyBridge} from '${process.cwd()}/src/main/zellij/zellijKeyBridge.ts';export {clipboard} from 'electron';`,
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
          contents: ELECTRON_STUB,
          loader: 'js'
        }));
      }
    }
  ]
});
const {
  translateZellijCommandKey,
  zellijClipboardAction,
  copyZellijSelection,
  bindZellijKeyBridge,
  clipboard
} = createRequire(import.meta.url)(outfile);

const keyDown = (overrides) => ({
  type: 'keyDown',
  key: 'a',
  meta: false,
  control: false,
  alt: false,
  shift: false,
  ...overrides
});

test('Cmd+Delete becomes the readline binding every shell already implements', () => {
  const translation = translateZellijCommandKey(keyDown({ key: 'Backspace', meta: true }));
  assert.equal(translation?.toKey, 'u', 'Cmd+Delete must arrive as Ctrl+U');
});

test('only plain Cmd translates — combinations are left alone rather than guessed at', () => {
  for (const extra of [{ shift: true }, { alt: true }, { control: true }]) {
    assert.equal(
      translateZellijCommandKey(keyDown({ key: 'Backspace', meta: true, ...extra })),
      undefined
    );
  }
  assert.equal(translateZellijCommandKey(keyDown({ key: 'Backspace' })), undefined, 'no Cmd, no translation');
  assert.equal(translateZellijCommandKey(keyDown({ key: 'w', meta: true })), undefined, 'Cmd+W is a real Zellij bind');
  assert.equal(
    translateZellijCommandKey({ ...keyDown({ key: 'Backspace', meta: true }), type: 'keyUp' }),
    undefined,
    'keyUp must not fire a second translation'
  );
});

test('the re-dispatched event carries ONE modifier, or Zellij would intercept it again', () => {
  // `hasModifiersToHandle` in Zellij's handler fires on `modifiers_count > 1 || metaKey`. Sending
  // Ctrl+Shift+U, or anything still holding Cmd, would loop straight back into the broken encoder.
  const sent = [];
  const webContents = {
    on: (event, handler) => {
      if (event === 'before-input-event') webContents.fire = handler;
    },
    sendInputEvent: (input) => sent.push(input)
  };
  bindZellijKeyBridge(webContents, 'darwin');
  let prevented = false;
  webContents.fire({ preventDefault: () => { prevented = true; } }, keyDown({ key: 'Backspace', meta: true }));

  assert.equal(prevented, true, 'the mis-encoded original must not reach the page');
  assert.deepEqual(sent.map((event) => event.type), ['keyDown', 'keyUp']);
  for (const event of sent) {
    assert.deepEqual(event.modifiers, ['control']);
    assert.equal(event.keyCode, 'u');
  }
});

test('non-macOS is untouched: there `meta` is the Windows key, not Cmd', () => {
  const sent = [];
  const webContents = { on: () => sent.push('bound'), sendInputEvent: () => sent.push('sent') };
  bindZellijKeyBridge(webContents, 'win32');
  bindZellijKeyBridge(webContents, 'linux');
  assert.deepEqual(sent, [], 'no handler should even be installed');
});

test('Enter is NOT claimed here — the newline keys live in the page patch', () => {
  // Re-dispatching Alt+Enter for xterm.js to encode depended on how xterm treats Alt, which is
  // exactly what `mac_option_is_meta` changes. `zellijPageKeyPatch.ts` writes the bytes instead.
  const sent = [];
  const webContents = {
    on: (event, handler) => {
      if (event === 'before-input-event') webContents.fire = handler;
    },
    sendInputEvent: (input) => sent.push(input)
  };
  bindZellijKeyBridge(webContents, 'darwin');
  let prevented = false;
  const event = { preventDefault: () => { prevented = true; } };
  webContents.fire(event, keyDown({ key: 'Enter', shift: true }));
  webContents.fire(event, keyDown({ key: 'Enter', alt: true }));

  assert.deepEqual(sent, [], 'the bridge must not also send a newline, or the key doubles');
  assert.equal(prevented, false);
});

test('Cmd+Left and Cmd+Right reach the line ends the arrows could not carry', () => {
  // All four Cmd+Arrows encode to the same `\x1b[65;9u` upstream, so these two must be claimed here
  // or they are not merely wrong but indistinguishable from each other.
  assert.equal(translateZellijCommandKey(keyDown({ key: 'ArrowLeft', meta: true }))?.toKey, 'a');
  assert.equal(translateZellijCommandKey(keyDown({ key: 'ArrowRight', meta: true }))?.toKey, 'e');
});

/**
 * Cmd+C / Cmd+V. Each is broken by a different layer, so each is pinned separately:
 * Zellij's handler swallows Cmd+C (`hasModifiersToHandle` fires on `metaKey` alone), while Cmd+V is
 * let through by Zellij and then dropped because the terminal view sets `setIgnoreMenuShortcuts`,
 * and on macOS paste is the Edit menu's `paste` role.
 */
const clipboardWebContents = () => {
  const calls = { pasted: 0, scripts: [] };
  const webContents = {
    on: (event, handler) => {
      if (event === 'before-input-event') webContents.fire = handler;
    },
    sendInputEvent: () => {},
    paste: () => {
      calls.pasted += 1;
    },
    executeJavaScript: async (script) => {
      calls.scripts.push(script);
      return calls.selection ?? '';
    }
  };
  return { webContents, calls };
};

test('Cmd+C and Cmd+V are claimed; other Cmd keys and keyUp are not', () => {
  assert.equal(zellijClipboardAction(keyDown({ key: 'c', meta: true })), 'copy');
  assert.equal(zellijClipboardAction(keyDown({ key: 'v', meta: true })), 'paste');
  assert.equal(zellijClipboardAction(keyDown({ key: 'c' })), undefined, 'no Cmd, no clipboard');
  assert.equal(zellijClipboardAction(keyDown({ key: 'x', meta: true })), undefined);
  assert.equal(
    zellijClipboardAction({ ...keyDown({ key: 'c', meta: true }), type: 'keyUp' }),
    undefined,
    'keyUp must not copy a second time'
  );
  for (const extra of [{ shift: true }, { alt: true }, { control: true }]) {
    assert.equal(zellijClipboardAction(keyDown({ key: 'c', meta: true, ...extra })), undefined);
    assert.equal(zellijClipboardAction(keyDown({ key: 'v', meta: true, ...extra })), undefined);
  }
});

test('Cmd+V pastes through the page, and the key never reaches Zellij', () => {
  const { webContents, calls } = clipboardWebContents();
  bindZellijKeyBridge(webContents, 'darwin');
  let prevented = false;
  webContents.fire(
    {
      preventDefault: () => {
        prevented = true;
      }
    },
    keyDown({ key: 'v', meta: true })
  );
  assert.equal(prevented, true, 'the menu path is dead, so the key must not be left to it');
  assert.equal(calls.pasted, 1, 'paste is performed by Main through the page, not by the menu');
});

test('Cmd+C copies the xterm selection, read from Zellij own `window.term`', async () => {
  const { webContents, calls } = clipboardWebContents();
  calls.selection = 'selected output';
  clipboard.texts.length = 0;
  await copyZellijSelection(webContents);

  assert.deepEqual(clipboard.texts, ['selected output']);
  // Pinned deliberately: `webContents.copy()` and `window.getSelection()` both return nothing here,
  // because the WebGL renderer draws the selection instead of putting it in the document.
  assert.match(calls.scripts[0], /window\.term\?\.getSelection/);
});

test('Cmd+C with nothing selected leaves the clipboard alone', async () => {
  const { webContents, calls } = clipboardWebContents();
  calls.selection = '';
  clipboard.texts.length = 0;
  await copyZellijSelection(webContents);
  assert.deepEqual(clipboard.texts, [], 'an empty selection must not erase what was copied before');
});
