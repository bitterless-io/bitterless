# Cmd+C and Cmd+V Do Nothing in the Zellij Terminal

Status: implemented; owner verification pending (needs a rebuild — this is Main-process code)

## Symptom

Inside the Zellij terminal, selecting output and pressing Cmd+C copies nothing, and Cmd+V pastes
nothing. Both keys work everywhere else in the app. No error is shown; the keys simply have no
effect, and on Cmd+C the shell may receive a stray escape sequence instead.

## Root cause — two different layers, one per key

**Cmd+C is eaten by Zellij's own web client.** `zellij-client/assets/key-handler.js` (0.45.1, the
version this app bundles) installs an xterm custom key handler whose gate is:

```js
return (modifiers_count > 1 || ev.metaKey) && !isModifierKey;
```

`ev.metaKey` *alone* is enough, so every Cmd combination is `preventDefault()`ed and re-encoded as a
Kitty sequence. The handler exempts exactly two combinations — Ctrl+Shift+V, and Cmd+V on macOS —
and copy is not one of them. The browser's copy therefore never runs.

**Cmd+V is let through by Zellij and then dropped by us.** The terminal view sets
`setIgnoreMenuShortcuts(true)` (`zellijTerminalView.ts`) so menu accelerators cannot fire while the
terminal owns the keyboard. That is correct and deliberate — but on macOS the native paste action is
delivered by the Edit menu's `paste` role (`applicationFindMenu.service.ts` registers `copy`/`paste`
roles). With the menu silenced for this view, nothing is left to perform the paste.

So the two keys fail for unrelated reasons and neither can be fixed by a Zellij keybind: for Cmd+C
the key never carries the intent past the page's own handler, and for Cmd+V there is no handler left
to act on it.

## Repair

Both are performed from Main in `zellijKeyBridge.ts`, before the page sees the key — the same layer
that already translates Cmd+Delete, and the only layer that still has the real event.

- `zellijClipboardAction(input)` claims plain Cmd+C and Cmd+V (macOS only, no other modifier held,
  `keyDown` only). Cmd+Shift+C and friends are left alone rather than guessed at, for the same
  reason the existing key translations are.
- **Paste** → `webContents.paste()`. The focused element is xterm's helper textarea, so Blink's
  paste command is enabled and dispatches a real `paste` event, which xterm's `handlePasteEvent`
  turns into a bracketed paste on the PTY. Going through the page rather than writing
  `clipboard.readText()` to the PTY directly keeps xterm's bracketing and sanitizing.
- **Copy** → read `window.term.getSelection()` through `executeJavaScript`, then
  `clipboard.writeText()`. `webContents.copy()` is the obvious call and copies nothing here: Zellij
  loads the WebGL renderer, which draws the selection rather than putting it in the document, so
  Blink's copy command is disabled and the `copy` listener xterm attaches to its container never
  fires. `window.term` is Zellij's own global (`assets/app.js`), so the selection text is reachable
  whichever renderer is loaded.
- An empty selection leaves the clipboard untouched: Cmd+C with nothing selected is a no-op, not a
  way to lose what was copied a moment earlier.

Windows and Linux are untouched — `bindZellijKeyBridge` still returns early off macOS, where `meta`
is the Super key and none of this would be right.

## Verification

- `node --test tests/zellij/zellijKeyBridge.test.mjs` — 8/8 pass (4 new).
- The new cases pin the two failure modes separately, and pin the `window.term` read specifically,
  so a later "simplification" to `webContents.copy()` or `window.getSelection()` fails the suite.
- Electron E2E not run; this needs an owner check in a rebuilt app.

## Related

`micromeet-cowork` had the same two keys broken plus a third problem — it shipped
`zellijKeyBridge.ts` but never called it, so even Cmd+Delete was unfixed there. Same repair, plus
the missing `bindZellijKeyBridge(view.webContents)` in `zellijTab.service.ts`. See that repo's
`docs/issues/zellij-terminal-cmd-copy-paste.md`.
