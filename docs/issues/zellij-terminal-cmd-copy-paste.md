# Cmd+C and Cmd+V Do Nothing in the Zellij Terminal

Status: native selection repair verified and published in Preview 0.0.122 (260917010242) on 2026-09-17; owner package acceptance pending.

## Native selection follow-up

The owner confirms that Cmd+C still fails after rebuilding the session; command discovery is
separately fixed. Ordinary mouse drag in the actual Zellij 0.45.1 renderer creates a native
server selection while `window.term.getSelection()` stays empty. The current Main bridge only
reads that browser API, so it silently does nothing. Native mouse-release copy emits OSC 52,
which the browser ClipboardAddon forwards to `navigator.clipboard.writeText`; the terminal
session's deny-all permission policy rejects that independent path.

The earlier browser-only tests never exercised ordinary native mouse selection. Their passing
status did not establish the owner-visible copy flow.

Repair contract:

- Preserve browser/xterm selection copying and the existing Cmd+V bracketed-paste path.
- For an empty browser selection, request the current native selection from the exact attached
  web client of this surface/session. Route Copy on that client's existing native connection;
  a new CLI connection can choose a different client's active pane and is not acceptable.
- Return only a fresh response belonging to this explicit copy request to Main, which writes
  the clipboard. Do not cache old selection text or enable broad clipboard permissions.
- Keep requests bounded and serialized; preserve the clipboard for no selection, missing or
  ambiguous clients, timeout, reload, retire, disposal or failure. Handle native IPC fragmentation
  and Unicode text; never log clipboard contents or mutate sibling sessions.
- Avoid configuration/keybinding migrations. Plain macOS Cmd+C is the existing authorized
  trigger; other modifiers, non-macOS behavior and normal terminal bytes stay unchanged.
- Mirror behavior in Cowork. Verify real native drag -> explicit Copy -> captured text with
  installed/staged Zellij and an isolated web client, with no real OS clipboard writes in tests.
  No Electron E2E or packaged-app launch.

Delivery: [native selection copy task](../plan/tasks/zellij-native-selection-copy-001.md).

Implemented: Main now falls back from an empty xterm selection to the attached client's native
Copy response. Requests are ordered after mouse release, bounded, cancelled on navigation and
drained before another request starts. Missing/empty/ambiguous responses leave the clipboard
unchanged. Same-target registration preserves the connection and selection. Focused tests 28/28,
full Zellij tests 211/211 and six real native/browser acceptance groups passed; see the task and
[independent review](../plan/reviews/zellij-native-selection-copy-001-1.md). Electron E2E was not run.

Protocol choice verified against Zellij 0.45.1: send the existing Cmd+C intent through the page's
terminal WebSocket so it follows mouse release. On the same attached native stream, replace that
key with `QueryTabNames -> Copy -> QueryTabNames`; the screen-thread Log replies delimit a fresh
copy response. `ConnStatus` is unsuitable on attached streams because it disconnects the client;
`CurrentTabInfo` can reply ahead of queued Render output. Native clipboard output has no request
identifier, so accept one well-formed OSC 52 payload within the bounded window and reject mixed or
malformed output. The upstream protocol cannot distinguish a lone program-generated clipboard
output emitted inside that same window. Never consume passive clipboard output outside a request.

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

## Earlier browser-only repair

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
  whichever renderer is loaded, but only for browser-owned selections. Native mouse selections
  require the follow-up above.
- An empty selection leaves the clipboard untouched: Cmd+C with nothing selected is a no-op, not a
  way to lose what was copied a moment earlier.

Windows and Linux are untouched — `bindZellijKeyBridge` still returns early off macOS, where `meta`
is the Super key and none of this would be right.

## Earlier verification

- `node --test tests/zellij/zellijKeyBridge.test.mjs` — 8/8 pass (4 new).
- The new cases pin the two failure modes separately, and pin the `window.term` read specifically,
  so a later "simplification" to `webContents.copy()` or `window.getSelection()` fails the suite.
- Electron E2E not run; this needs an owner check in a rebuilt app.

## Related

`micromeet-cowork` had the same two keys broken plus a third problem — it shipped
`zellijKeyBridge.ts` but never called it, so even Cmd+Delete was unfixed there. Same repair, plus
the missing `bindZellijKeyBridge(view.webContents)` in `zellijTab.service.ts`. See that repo's
`docs/issues/zellij-terminal-cmd-copy-paste.md`.
