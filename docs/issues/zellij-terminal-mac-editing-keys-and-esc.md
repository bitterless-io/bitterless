# Zellij Terminal Swallows Esc, Shift+Enter, and Every macOS Editing Key

Status: all four repairs implemented and unit-tested. Layer 3 shipped broken on 2026-09-14 and was
repaired on 2026-09-20 — see *Layer 3 shipped half-applied*, which also retires this issue's claim
that a template upgrade needs the server killed. The last unknown in the Esc path was deliberately
designed around rather than measured — see *Why Esc did not wait for the measurement*.

## Symptom

Running Claude Code inside the Zellij terminal (owner report, 2026-09-14):

- **Esc does nothing.** It cannot interrupt or steer a running turn.
- **Shift+Enter does not insert a newline.** It submits the message instead.
- **Option+Left/Right moves pane focus** instead of moving the cursor by word.
- **Cmd+Left/Right** does not go to start/end of line.

Owner requirement: Cmd+arrow, Option+arrow and their Shift variants should behave like a native
macOS input field, and the fix must be preset so a fresh install or reinstall gets it — not a
hand-edit of the owner's `config.kdl`.

## Evidence

A raw-mode byte probe (`tmp/zellij-key-probe/probe.mjs`) was run as a floating pane in the owner's
live session and dumps what actually reaches the pty:

| Key pressed | Bytes at the pty | Verdict |
| --- | --- | --- |
| Esc ×3 | *(nothing at all)* | never arrives |
| Shift+Enter ×2 | `0d` | Shift discarded — plain CR |
| Option+Enter ×2 | `1b 0d` | correct; ESC+CR traverses the whole chain |
| Enter ×1 | `0d` | control, correct |

The Option+Enter row matters twice over: it is the sequence Claude Code's own `/terminal-setup`
installs for Shift+Enter, and it proves an ESC **byte** is not the problem — only a *lone* ESC is.

## Root causes — four distinct layers

### 1. `encode_kitty_key` destroys every named key (`assets/keyboard.js`, 0.45.1)

```js
let key_code = ev.key.charCodeAt(0);
send_ansi_key(`\x1b[${key_code};${modifier_string}u`);
```

`ev.key` is a *name* for every non-printable key, so the encoder ships its first letter. All four
arrows begin with `A`, so they collapse onto one indistinguishable sequence:

| Key | Emitted | Decoded as |
| --- | --- | --- |
| Cmd+Left | `\x1b[65;9u` | Super+**A** |
| Cmd+Right | `\x1b[65;9u` | Super+**A** |
| Cmd+Up / Cmd+Down | `\x1b[65;9u` | Super+**A** |
| Shift+Cmd+Left | `\x1b[65;10u` | Shift+Super+**A** |
| Shift+Option+Left | `\x1b[65;4u` | Shift+Alt+**A** |

This is the same defect already documented for Cmd+Delete → Super+B in
[`zellij-terminal-cmd-copy-paste.md`](./zellij-terminal-cmd-copy-paste.md) and worked around in
`zellijKeyBridge.ts`. No Zellij keybind can repair it: the sequence never carried the key.

### 2. The gate drops single-modifier combos (`assets/key-handler.js`)

```js
return (modifiers_count > 1 || ev.metaKey) && !isModifierKey;
```

Shift+Enter holds one modifier and no Cmd, so it never reaches the encoder and falls back to
xterm.js, which ignores Shift on Enter and sends a bare `\r`. **Shift+Enter cannot express a newline
in this terminal at all.** (Had it reached the encoder it would have been wrong anyway —
`"Enter".charCodeAt(0)` is 69, i.e. Shift+**E**.)

Note the ordering trap: the gate runs *before* the explicit Alt+Arrow branch, so Shift+Option+Left
is captured by the broken encoder and never reaches the correct SGR path below it.

### 3. Zellij binds Option+Arrow for pane navigation (default keybinds)

```kdl
shared_except "locked" {
    bind "Alt left"  { MoveFocusOrTab "left"; }
    bind "Alt right" { MoveFocusOrTab "right"; }
    bind "Alt up"    { MoveFocus "up"; }
    bind "Alt down"  { MoveFocus "down"; }
}
```

Here the web client is *correct* — `key-handler.js` explicitly sends `\x1b[1;3D` / `\x1b[1;3C` — and
the Zellij server consumes it before the pane sees it. This is the one layer fixable by config.

`web_client { mac_option_is_meta }` is also unset, so xterm.js defaults it to `false` and
Option+letter produces an accent (`Option+h` → `˙`). That is why Zellij's own `Alt h/j/k/l` focus
bindings are dead in this client, and why Option+Backspace does not delete a word.

### 4. Esc — one hop still unproven

Ruled out by source inspection, each verified against the running build:

- **Electron Main.** The only two `before-input-event` binds on the terminal view are
  `bindZellijKeyBridge` (guards on `input.meta`) and `bindZellijDevTools` (F12 / Cmd+Alt+I). No
  `globalShortcut` anywhere in `src/`. The Escape handler at `omniWindow.helper.ts:1195` is bound to
  the Omni **control** view, not the terminal.
- **Page JS.** `app.js`, `key-handler.js`, `keyboard.js` and `modals.js` contain no handler for an
  unmodified Escape. The one `case "Escape"` in `app.js` sends `\x1b` correctly and lives in the
  soft-keyboard capture path, gated behind `window.__zjSoftKbdEnabled` (mobile only).
- **Zellij keybinds.** Every `esc` binding in the effective config carries
  `shared_except "normal"`; normal mode does not bind it.

Remaining: xterm.js → websocket, or the server's parse of a **lone** ESC. The latter is the standing
suspicion — a parser cannot distinguish a bare `\x1b` from the start of an escape sequence, and the
probe shows three consecutive Esc presses producing nothing while `\x1b\r` (Option+Enter) passes
cleanly, which is what an "incomplete sequence, wait for more" parser looks like.

## Repair

Layer 1 is Main-process work in `zellijKeyBridge.ts` — the layer that still holds the real event.
Layers 2 and 4 are a script injected into the page (`zellijPageKeyPatch.ts`), which writes the bytes
directly: no re-dispatched key can survive a hop that drops the key itself, and the Alt+Enter
re-dispatch that first carried Shift+Enter depended on how xterm.js treats Alt — exactly what
`mac_option_is_meta` changes. All three ship with the app, so a reinstall gets
them for free. Layer 3 is config, and must be written into the **generated template**
(`zellijDefaultConfig.constant.ts`) rather than the owner's file, so a fresh install is born with it.

| Key | Deliver to the pane | Where |
| --- | --- | --- |
| Esc | `CSI 27;1 u` (complete Kitty sequence — unambiguous, unlike a bare ESC byte) | page patch |
| Shift+Enter, Option+Enter | `ESC CR` — measured working via Option+Enter | page patch |
| Cmd+Left / Cmd+Right | `\x01` / `\x05` (Ctrl+A / Ctrl+E), matching the existing Cmd+Delete → Ctrl+U translation | key bridge |
| Option+Left / Option+Right | `\x1b[1;3D` / `\x1b[1;3C` — already correct; stop Zellij eating it | config |
| Option+Backspace | `\x1b\x7f` (delete word back) | `mac_option_is_meta true` |

Config template changes:

- Unbind `Alt left` and `Alt right` **on one node** so word movement reaches the pane — see
  *Layer 3 shipped half-applied* for why the node count is load-bearing.
- Set `web_client { mac_option_is_meta true }`. This also revives `Alt h` / `Alt l`, which is where
  left/right pane focus lands once the arrows are freed. Cost: Option+letter no longer types an
  accent — acceptable for this owner, and it is what every terminal-as-editor setup does.
- The template carries a version stamp and backs up on upgrade, so existing installs migrate.

**Superseded 2026-09-20 — a template upgrade DOES apply to a running server.** This section used to
claim that Zellij reads `--config` once at server start, so an upgrade could not take effect until
the server was killed, and it read the owner's 2026-09-14 retest as a false negative caused by that
staleness. Both halves were wrong, and the real cause is in *Layer 3 shipped half-applied*.

Zellij watches the config file for the life of the session: with `cli_assets.config_file_path` set —
which `zellijNativeSession.service.ts` always sets — the server spawns `watch_config_file_changes`,
and each change becomes `ServerInstruction::ConfigWrittenToDisk` → `change_saved_config` →
`propagate_configuration_changes` (`zellij-server/src/lib.rs:2295`, `:1753`, v0.45.1). Keybinds are
part of what propagates. It is a poll watcher, so the atomic `renameSync` this app replaces the file
with is picked up like any other write.

Measured, not inferred: against one live session daemon, swapping `config.kdl` under it moved
Option+Left from consumed to passed through within seconds, with no restart and no reattach — the
same run reproduced in *Layer 3 shipped half-applied*. So the owner's requirement that the setting
take effect after an app update is met by bumping `ZELLIJ_CONFIG_VERSION_CODE`: the app rewrites the
file on the next start, and every already-running session follows. No pane is killed for it.

## Layer 3 shipped half-applied — Zellij reads only the FIRST global `unbind`

Owner report 2026-09-20: Option+arrow still switches panes, and it should be off by default and stay
off across app updates. The template had carried the unbind since 2026-09-14, on his machine, in a
file Zellij validated without complaint:

```kdl
keybinds {
  unbind "Alt left"
  unbind "Alt right"   // ← never read
}
```

Zellij takes the global unbind with `kdl_keybinds.children().and_then(|c| c.get("unbind"))`
(`zellij-utils/src/kdl/mod.rs:5179`, v0.45.1). `KdlDocument::get` returns the **first** node of that
name; every later one is dropped without a warning. `keys_from_kdl!` (`:341`), by contrast, takes
*all* arguments of the node it is handed. So one node with two keys unbinds two keys, and two nodes
with one key each unbind exactly one.

Confirmed against the bundled 0.45.1 binary before the fix, using an invalid key name as a probe for
whether a node is parsed at all:

| Config | `setup --check` | Meaning |
| --- | --- | --- |
| `unbind "Alt left" "Alt bogus"` | exit 1, *Invalid key* | both arguments parsed |
| `unbind "Alt left"` + `unbind "Alt bogus"` | exit 0 | the second node is never looked at |
| `unbind "Alt bogus"` + `unbind "Alt left"` | exit 1, *Invalid key* | only the first node is |

And end to end, driving a real `KeyMsg` into a live session daemon over native IPC (the message the
web client sends; note `KeyMsg.key` carries the *parsed* key, which is what the server matches —
`raw_bytes` alone does nothing, and an earlier probe that sent only bytes produced a false pass):

| Config | Option+Left | Option+Right |
| --- | --- | --- |
| no unbind (control) | consumed | consumed |
| two `unbind` nodes (what shipped) | passed through | **consumed** |
| one node, both keys | passed through | passed through |

That is the whole 2026-09-14 retest: the owner reported Option+**Right**, the one key this bug left
bound. Nothing was stale.

**Repair.** One node, `unbind "Alt left" "Alt right"`, and `ZELLIJ_CONFIG_VERSION_CODE` bumped to
`260920134020` so existing installs are handed the corrected template. Two guards in
`tests/zellij/zellijDefaultConfig.test.mjs`: the template must carry exactly one global `unbind`
node listing both keys, and the binary must still drop a second node — if a future Zellij starts
reading them all, that test says so instead of the constraint quietly outliving its reason.

## Out of scope — native-input selection

**Shift+arrow cannot give native-input selection.** A terminal delivers key events; it has no
selection model to hand the application, and Claude Code's prompt does not implement selection.
Owner ruling 2026-09-14: dropped — deliver what Zellij can actually do instead.

What still ships from this area, because it is a free consequence of fixing the encoder: Shift+Cmd+
Arrow and Shift+Option+Arrow stop emitting garbage (Shift+Super+A) and carry the real key, so a TUI
that *does* implement selection receives it. No selection behaviour is promised in Claude Code.

## Why Esc did not wait for the measurement

The open question was whether a bare `\x1b` ever leaves xterm.js. It is deliberately left
unanswered, because a repair exists that is correct under either answer — `zellijPageKeyPatch.ts`:

- It listens on `document` in the **capture** phase, so it runs *before* xterm's own keydown
  handler. If xterm was the layer dropping the key, the patch already holds it.
- It sends a **complete** `CSI 27;1 u` rather than a bare ESC byte. A finished sequence cannot be
  read as "an escape sequence still arriving", so the waiting-parser failure cannot occur either.

The only scenario neither arm covers is Escape never reaching the page, which the Electron-layer
inspection above rules out. If the patch's own send function is missing after a Zellij upgrade it
declines the key rather than swallowing it, so Esc degrades to today's behaviour instead of becoming
a silent no-op this app owns.

Owner note 2026-09-14: the measurement was to be taken in dev, where DevTools opens on its own. That
does not work as expected — `zellijSurface.ts` auto-opens DevTools for the surface **controls**
webContents, while `window.term` lives in the separate terminal `WebContentsView` loaded from the
Zellij origin, so a Console opened that way reports `window.term` as undefined.
`zellijTerminalView.ts` now calls `autoOpenZellijDevTools` for the terminal view as well, so a debug
build gets a Console where terminal-side investigation is actually possible.
