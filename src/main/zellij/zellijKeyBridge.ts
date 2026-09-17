import { clipboard, type Input, type WebContents } from 'electron';

/**
 * macOS line-editing keys that Zellij's web client cannot receive, translated before they reach it.
 *
 * Zellij's own key handler (`assets/key-handler.js`) intercepts anything with Cmd held and encodes
 * it as a Kitty sequence using `ev.key.charCodeAt(0)`. That is correct for a single character and
 * WRONG for every named key, because it takes the first letter of the NAME:
 *
 *     "Backspace".charCodeAt(0) === 66   // 'B'
 *     "Delete".charCodeAt(0)    === 68   // 'D'
 *     "ArrowLeft".charCodeAt(0) === 65   // 'A'  — and so do Right, Up and Down
 *
 * So Cmd+Delete arrives at Zellij as Super+B, and all four Cmd+Arrow combinations arrive as the
 * SAME sequence, `\x1b[65;9u`, indistinguishable from each other. No keybind can fix that — the
 * sequence never carried the key. Translating here is the only layer that still has the real event.
 *
 * The translation targets are the readline bindings every shell already implements, so nothing has
 * to be configured for them to work.
 */
interface KeyTranslation {
  /** The literal Electron `Input.key` this fires on. */
  readonly from: string;
  /** What the page receives instead. One modifier only — Zellij passes single-Ctrl through. */
  readonly toKey: string;
  readonly why: string;
}

const MAC_COMMAND_TRANSLATIONS: readonly KeyTranslation[] = [
  { from: 'Backspace', toKey: 'u', why: 'Cmd+Delete = delete to start of line (readline Ctrl+U)' },
  { from: 'ArrowLeft', toKey: 'a', why: 'Cmd+Left = start of line (readline Ctrl+A)' },
  { from: 'ArrowRight', toKey: 'e', why: 'Cmd+Right = end of line (readline Ctrl+E)' }
];

export const translateZellijCommandKey = (input: Input): KeyTranslation | undefined => {
  if (input.type !== 'keyDown' || !input.meta) return undefined;
  // Only plain Cmd. Cmd+Shift+Delete and friends are left alone rather than guessed at.
  if (input.control || input.alt || input.shift) return undefined;
  return MAC_COMMAND_TRANSLATIONS.find((entry) => entry.from === input.key);
};

/**
 * Cmd+C and Cmd+V in the terminal. Both are performed from Main, because neither works on its own.
 *
 * Cmd+C never reaches the browser: `hasModifiersToHandle` in Zellij's `assets/key-handler.js`
 * returns true for `ev.metaKey` ALONE, so the handler calls `preventDefault()` and encodes a Kitty
 * sequence instead. It exempts exactly two combinations — Ctrl+Shift+V and, on macOS, Cmd+V — and
 * copy is not one of them.
 *
 * Cmd+V *is* exempted there and still does nothing, for an unrelated reason: the terminal view runs
 * with `setIgnoreMenuShortcuts(true)` so menu accelerators cannot fire while the terminal owns the
 * keyboard, and on macOS the native paste action is delivered by the Edit menu's `paste` role. With
 * the menu silenced, nothing is left to perform it.
 */
export type ZellijClipboardAction = 'copy' | 'paste';

export const zellijClipboardAction = (input: Input): ZellijClipboardAction | undefined => {
  if (input.type !== 'keyDown' || !input.meta) return undefined;
  // Plain Cmd only, for the same reason the key translations are: Cmd+Shift+C and friends may be
  // real Zellij binds, and guessing at them is how someone's config quietly breaks.
  if (input.control || input.alt || input.shift) return undefined;
  if (input.key === 'c') return 'copy';
  if (input.key === 'v') return 'paste';
  return undefined;
};

/**
 * Reads the selection from xterm itself, not from the document.
 *
 * `webContents.copy()` is the obvious call and it copies nothing here: Zellij loads the WebGL
 * renderer, which DRAWS the selection rather than putting it in the DOM, so Blink's copy command is
 * disabled and the `copy` listener xterm attaches to its container never fires. `window.term` is
 * Zellij's own global (`assets/app.js`), and `term.getSelection()` returns the selected text
 * whichever renderer is loaded.
 */
export type ZellijNativeSelection = (
  sendMarker: () => Promise<boolean>,
  signal: AbortSignal
) => Promise<string>;

export const copyZellijSelection = async (
  webContents: WebContents,
  {
    nativeSelection,
    signal = new AbortController().signal
  }: { nativeSelection?: ZellijNativeSelection; signal?: AbortSignal } = {}
): Promise<void> => {
  if (signal.aborted || webContents.isDestroyed()) return;
  let selection: unknown = await webContents.executeJavaScript(
    'typeof window.term?.getSelection === "function" ? window.term.getSelection() : ""'
  );
  if (signal.aborted || webContents.isDestroyed()) return;
  if (selection === '' && nativeSelection) {
    selection = await nativeSelection(async () => {
      if (signal.aborted || webContents.isDestroyed()) return false;
      return (
        (await webContents.executeJavaScript(`(() => {
        const send = window.__zjImeBypass?.sendFn;
        if (typeof send !== 'function') return false;
        send('\\x1b[99;9u');
        return true;
      })()`)) === true
      );
    }, signal);
  }
  // An empty selection must leave the clipboard alone: Cmd+C with nothing selected is a no-op, not
  // a way to lose whatever was copied a moment earlier.
  if (
    !signal.aborted &&
    !webContents.isDestroyed() &&
    typeof selection === 'string' &&
    selection.length > 0
  )
    clipboard.writeText(selection);
};

/**
 * Only on macOS: elsewhere Cmd is not a key users press, and `input.meta` is the Windows/Super key
 * where these translations — and the clipboard keys — would be wrong.
 *
 * Shift+Enter and Option+Enter used to be handled here too, by re-dispatching Alt+Enter for xterm.js
 * to encode. They moved to `zellijPageKeyPatch.ts`: that trick depended on how xterm.js treats Alt,
 * which is precisely what `mac_option_is_meta` changes, so one config flag would have silently
 * decided whether the newline still worked.
 */
export const bindZellijKeyBridge = (
  webContents: WebContents,
  {
    platform = process.platform,
    nativeSelection
  }: { platform?: string; nativeSelection?: ZellijNativeSelection } = {}
): void => {
  if (platform !== 'darwin') return;
  let copy: AbortController | null = null;
  const cancelCopy = (): void => {
    copy?.abort();
    copy = null;
  };
  webContents.on('did-start-navigation', (_event, _url, _inPlace, isMainFrame) => {
    if (isMainFrame) cancelCopy();
  });
  webContents.on('destroyed', cancelCopy);
  webContents.on('before-input-event', (event, input) => {
    const clipboardAction = zellijClipboardAction(input);
    if (clipboardAction) {
      event.preventDefault();
      if (clipboardAction === 'paste') {
        // The focused element is xterm's helper textarea, so Blink's paste command is enabled and
        // dispatches a real `paste` event. Going through it — instead of writing
        // `clipboard.readText()` to the PTY — keeps xterm's bracketed paste and its own sanitizing.
        webContents.paste();
        return;
      }
      if (input.isAutoRepeat && copy && !copy.signal.aborted) return;
      cancelCopy();
      const request = new AbortController();
      copy = request;
      void copyZellijSelection(webContents, { nativeSelection, signal: request.signal })
        .catch(() => {
          // Never log a renderer/native error payload: it can contain terminal selection text.
          console.error('[zellij] terminal copy failed');
        })
        .finally(() => {
          if (copy === request) copy = null;
        });
      return;
    }
    const translation = translateZellijCommandKey(input);
    if (!translation) return;
    event.preventDefault();
    // Re-dispatched as Ctrl+<key>: one modifier, so Zellij's handler ignores it and xterm.js emits
    // the ordinary control character the shell is already listening for.
    webContents.sendInputEvent({
      type: 'keyDown',
      keyCode: translation.toKey,
      modifiers: ['control']
    });
    webContents.sendInputEvent({
      type: 'keyUp',
      keyCode: translation.toKey,
      modifiers: ['control']
    });
  });
};
