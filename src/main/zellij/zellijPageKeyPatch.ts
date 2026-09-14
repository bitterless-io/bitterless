import type { WebContents } from 'electron';

/**
 * The keys Zellij's web client cannot deliver, repaired inside its own page.
 *
 * This is the layer of last resort. `zellijKeyBridge.ts` fixes keys by re-dispatching a DIFFERENT
 * key that the page happens to encode correctly — which only works while some other key still maps
 * to the bytes we want. These two do not have that luxury:
 *
 * **Esc.** Measured with a raw-mode byte probe on the owner's session: pressing Esc delivers NOTHING
 * to the pty — not a late byte, not a wrong byte, zero — while Option+Enter delivers `1b 0d` intact.
 * So an ESC *byte* crosses the whole chain happily; a *lone* one does not. Everything that could
 * have eaten it was cleared by inspection (see the issue doc): no Main-process handler claims it, no
 * Zellij keybind binds it in normal mode, and none of `app.js`, `key-handler.js` or `modals.js` has
 * a handler for an unmodified Escape. Two candidates remain — xterm.js never emits it, or the server
 * reads a bare `\x1b` as the opening byte of an escape sequence and waits forever for the rest. This
 * patch is correct under both, which is why it did not wait on telling them apart:
 *
 *   - it listens on `document` in the CAPTURE phase, ahead of xterm's own keydown handler, so if
 *     xterm was the layer dropping the key the patch already holds it;
 *   - it sends a COMPLETE `CSI 27;1 u`, which cannot be read as "a sequence that has not finished
 *     arriving". The `;1` (nothing held) is deliberate rather than the shorter `CSI 27 u`: it is the
 *     exact shape Zellij's own `encode_kitty_key` emits, and those sequences demonstrably reach the
 *     server today — that is how Cmd+Arrow arrives there as Super+A.
 *
 * **Shift+Enter and Option+Enter — a newline, not a submit.** Zellij's `hasModifiersToHandle` wants
 * two modifiers or Cmd, so a single Shift never reaches its encoder and falls through to xterm.js,
 * which ignores Shift on Enter and sends a bare `\r` the program cannot tell from Enter. (Reaching
 * the encoder would not have helped: `"Enter".charCodeAt(0)` is 69, i.e. Shift+E.)
 *
 * Both are sent as `ESC CR` — the sequence Claude Code's own `/terminal-setup` installs for
 * Shift+Enter, and the one measured arriving intact as `1b 0d` on this surface.
 *
 * Writing the bytes here rather than re-dispatching Alt+Enter from Main is deliberate. That
 * re-dispatch worked only because xterm.js turns Alt+Enter into ESC+CR, and `mac_option_is_meta` —
 * which this app now sets — is exactly the option that changes how xterm treats Alt. Depending on
 * that would mean one config flag silently deciding whether Shift+Enter still works. It also makes
 * Option+Enter a newline by intent rather than by xterm's incidental behaviour (owner request
 * 2026-09-14), and the two keys cannot fight: one handler, one sequence, one `preventDefault`.
 *
 * `window.__zjImeBypass.sendFn` is Zellij's own handle on the function that writes to the terminal
 * websocket (`assets/app.js` stores it there for its IME bypass). Reaching for a page global of
 * Zellij's is already how this app reads the terminal selection for Cmd+C (`zellijKeyBridge.ts`).
 * When it is missing — a Zellij upgrade moving it — the patch declines the key rather than
 * swallowing it, so these keys degrade to today's behaviour instead of becoming silent no-ops we own.
 */
const PAGE_KEY_PATCH_SOURCE = `(() => {
  if (window.__blZellijKeysPatched) return 'already-installed';
  // Resolved per keypress, never once up front. Zellij creates \`__zjImeBypass\` inside
  // \`setupInputHandlers\`, which runs after the page has booted and built the terminal — later than
  // \`did-finish-load\`, when this script is injected. An up-front guard therefore declined to install
  // the listener at all and the patch never ran once in practice ("reason=no-send-function",
  // observed on every app start 2026-09-14). Late lookup also keeps the graceful degradation: if a
  // Zellij upgrade moves the global, the handler declines the key instead of swallowing it.
  const resolveSend = () => {
    const bypass = window.__zjImeBypass;
    return bypass && typeof bypass.sendFn === 'function' ? bypass.sendFn : null;
  };
  const sequenceFor = (ev) => {
    if (ev.ctrlKey || ev.metaKey) return null;
    if (ev.key === 'Escape') {
      // Modified Escape may be a real Zellij bind; only the bare key is claimed.
      return ev.altKey || ev.shiftKey ? null : '\\x1b[27;1u';
    }
    if (ev.key !== 'Enter') return null;
    // Exactly one of Shift or Option. Plain Enter must still submit, and both together is not a
    // combination this app has any business guessing at.
    return ev.shiftKey !== ev.altKey ? '\\x1b\\r' : null;
  };
  document.addEventListener(
    'keydown',
    (ev) => {
      const sequence = sequenceFor(ev);
      if (!sequence) return;
      const send = resolveSend();
      if (!send) return;
      send(sequence);
      // Both, and only after the send succeeded: stopPropagation keeps xterm from ALSO emitting its
      // own encoding, which would double the key.
      ev.preventDefault();
      ev.stopPropagation();
    },
    true
  );
  window.__blZellijKeysPatched = true;
  // 'pending' is the ORDINARY case at injection time, not a fault: Zellij has not built its terminal
  // yet. It is reported separately only so a permanent absence stays diagnosable.
  return resolveSend() ? 'installed' : 'installed-send-pending';
})()`;

/**
 * Re-applied on every load, not once per view: the guard inside makes it idempotent, and a reload of
 * the terminal page would otherwise silently lose the repair.
 */
export const bindZellijPageKeyPatch = (webContents: WebContents): void => {
  webContents.on('did-finish-load', () => {
    void webContents
      .executeJavaScript(PAGE_KEY_PATCH_SOURCE)
      .then((result: unknown) => {
        if (
          result === 'installed' ||
          result === 'installed-send-pending' ||
          result === 'already-installed'
        )
          return;
        console.error(`[zellij] page key patch not installed reason=${String(result)}`);
      })
      .catch((error) => {
        console.error('[zellij] page key patch failed', error);
      });
  });
};
