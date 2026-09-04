# Open in iTerm2 does nothing

Status: Closed by removal in
[task 097](../plan/tasks/eyes-on-agents-remove-iterm2-claude-097.md); the action, transport, and
Automation entitlement no longer ship

Reported: 2026-09-04, by the owner, from the packaged Preview build

## Symptom

Claude CLI sessions now appear in Focus (the visibility path works), but the row's **Open in iTerm2**
action has **no effect at all** — no focus change, no window raise, no error surfaced in the UI.

## Root cause: two defects stacked

### 1. `iterm2:///reveal?sessionid=…` does not work. The whole approach is wrong.

Measured on the owner's machine (iTerm2, macOS), by revealing a *different* pane and then asking
iTerm2 which session is focused:

| URL opened | focused session afterwards |
|---|---|
| `iterm2:///reveal?sessionid=w0t1p1%3A<uuid>` (what ships today) | unchanged |
| `iterm2:///reveal?sessionid=<uuid>` (bare id) | unchanged |

The `iterm2:` scheme *is* registered to iTerm2 (`lsregister -dump` shows
`bindings: iterm2:`), so the URL is delivered and then ignored. There is no working `/reveal`
route: the iTerm2 documentation page this was designed from
([Command Selection and Command URLs](https://iterm2.com/documentation-command-selection.html))
describes a *different* feature — URLs iTerm2 generates for clickable commands in its own UI — and
the earlier research generalized it into an external "reveal this session" capability that iTerm2
does not expose. **That was my error, not a regression:** it was never verified against a running
iTerm2, only read out of a docs page.

### 2. Even a working scheme would receive the wrong identifier.

`ITERM_SESSION_ID` is `w{window}t{tab}p{pane}:{UUID}` — measured: `w0t1p1:C1A9D6DE-…`. iTerm2's own
session id is the **bare UUID**: `osascript -e 'tell application "iTerm2" to get id of current
session of current tab of current window'` returns `0B48EB12-…`, with no prefix. Enumerating every
session id confirms `C1A9D6DE-…` — the UUID half of `ITERM_SESSION_ID` — is a real session id.

Task 081 captures the full `w0t1p1:UUID` (correctly — that is what the hook sees) and
`buildEyesOnAgentsIterm2DeepLink` passes it through verbatim
(`src/shared/eyesOnAgents/eyesOnAgents.contract.ts:453-459`), so the prefix would have to be
stripped regardless of transport.

## What does work

AppleScript, measured on the same machine — matched the target session, moved focus, and restored:

```applescript
tell application "iTerm2"
  repeat with w in windows
    repeat with t in tabs of w
      repeat with s in sessions of t
        if (id of s) is "<uuid>" then
          select w
          select t
          select s
        end if
      end repeat
    end repeat
  end repeat
end tell
```

This is also what the original research recorded as the fallback ("iTerm2 Python API / AppleScript
can precisely control window → tab → session"); the URL scheme was chosen over it specifically to
avoid the macOS Automation permission prompt. That trade-off was based on a capability that does not
exist, so it has to be reversed.

## Why no test caught it

`this.dependencies.openExternal(url)` resolves whether or not the receiving app does anything, and
nothing in the delivery observed iTerm2 afterwards. Every test asserted the *URL string*, which was
built exactly as designed — the design was wrong. Nothing logged the attempt either, so the failure
was invisible from `main.log`: the service marked the thread opened and returned a snapshot as if it
had succeeded.

## Repair

- Replace the `openExternal` transport for this action with an AppleScript-driven session select,
  keyed on the UUID extracted from the stored `ITERM_SESSION_ID`. Keep storing the full captured
  value (faithful capture); derive the UUID at open time.
- Never string-interpolate the id into the script. Pass it as an `osascript` argument (`on run argv`)
  and re-validate it against the strict UUID shape first.
- **Log the attempt and its outcome** — matched / no-match / permission-denied / osascript failure —
  identified by session id only, never a path. This is the gap that made the bug invisible.
- Surface a real failure to the renderer instead of reporting success: a no-match (the pane is gone)
  and a denied Automation permission are different, actionable states.

### Packaging prerequisites — this cannot work in a packaged build without them

`electron-builder.yml` sets `hardenedRuntime: true`, and `build/entitlements.mac.plist` does **not**
contain `com.apple.security.automation.apple-events`; `extendInfo` does **not** contain
`NSAppleEventsUsageDescription`. Under the hardened runtime, a signed app without that entitlement is
refused Apple Events by the OS (`errAEEventNotPermitted`, -1743) and without the usage description
macOS will not even show the consent prompt. Both must be added.

**Correction (task 094).** This section also claimed that, with only `entitlementsInherit`
configured, "electron-builder signs the app bundle with its own defaults". That is not true for the
pinned toolchain. In `app-builder-lib` 26.7.0, `MacPackager.getOptionsForFile` resolves the root
bundle's entitlements as `mac.entitlements` → `<buildResources>/entitlements.mac.plist` (present here
via `directories.buildResources: build`) → the bundled template, so the project's own plist was
already being applied to the app bundle by build-resources convention. `mac.entitlements` is now set
explicitly anyway — it is the difference between relying on a directory listing and stating the
intent — but the missing entitlement *key*, not a missing config key, is what would have blocked a
packaged build.

Consequence for the owner: after this ships, the **first** use of Open in iTerm2 raises a one-time
macOS prompt ("Bitterless wants to control iTerm2"), which must be allowed — and it only appears in
a freshly packaged build carrying the new entitlement.

## Related

- Introduced by `eyes-on-agents-iterm2-backend-082` / `...-renderer-083`, on research recorded in
  [EyesOnAgents iTerm2 Open](../features/eyes-on-agents-iterm2-open.md), whose "Open" section needs
  correcting alongside the repair.
- WezTerm was researched as feasible via `wezterm cli activate-pane`; that is a CLI, not a URL
  scheme, and is unaffected by this finding.
