# OnlyPreview — Cmd+F and Shift+Cmd+F need a menu accelerator, not `before-input-event`

- Status: repaired, awaiting owner verification
- Reported: 2026-09-03 — 「pdf 打开的时候点击 shift cmd+f 切到 js 然后 global search 并没有显示 说明肯定被拦截了，你这个时候就需要重新评估可行性了」
- Surface: OnlyPreview standalone window (`BaseWindow` + `WebContentsView`)

## Symptom

`Cmd+F` opens no find bar and `Shift+Cmd+F` shows no Global Search overlay. Pressing the chord over
a PDF and then switching to a `.js` file does not make the overlay appear either, so nothing was
queued and then blocked from painting — the command never ran.

## Evidence

Instrumentation added earlier separates "Main never saw the key" from "Main saw it and did nothing":
`event=shortcut-bound origin=…` on every binding, `event=shortcut … resolved=…` on every F chord that
reaches Main. From `~/Library/Application Support/Bitterless_DEBUG_PROD/logs/main.log`, 2026-09-03:

| time (UTC) | record |
| --- | --- |
| 10:28:44 | `event=shortcut origin=chrome pressed=f shift=false resolved=find-in-file` |
| 10:28:47 | `event=shortcut origin=shell pressed=f shift=true resolved=focus-search` |
| 10:29:25 | `event=shortcut origin=vue pressed=f shift=false resolved=find-in-file` |
| 10:43:46 | `event=shortcut-bound origin=shell` / `search` / `vue` / `chrome` — all four bound |
| 10:43:46 | `event=window-focus state=focus` |
| 10:43:59 | `event=window-focus state=blur` |
| 10:46:09 | `event=window-focus state=focus` |
| 10:46:14 | `event=window-focus state=blur` |
| 10:46:15 → 10:53 | **no `event=shortcut` at all** |

Two facts follow. The command path works — five chords resolved correctly at 10:28–10:29, including
`shift=true` and including `origin=chrome`, so a PDF's out-of-process viewer frame is not the
obstacle. And every failure window sits outside `state=focus`: from 10:46:15 onward the window was
never key again, yet the bindings were all in place.

## Root cause

The chord had exactly one carrier: `webContents.on('before-input-event')`. That event fires only on a
`WebContents` that currently owns keyboard focus, inside a window that is currently key. An
OnlyPreview window guarantees neither:

- `BaseWindow` has no web contents of its own. Every pixel is a child `WebContentsView`, and nothing
  makes one of them first responder — a freshly attached preview view can hold no keyboard focus at
  all, and a PDF's content lives in an out-of-process plugin frame.
- On macOS a Command chord is a **key equivalent**. AppKit offers it to the main menu *first* and only
  then to the key window's first responder. With no first responder to receive it and no menu item
  claiming it, the keystroke is discarded — silently, which is why it reads as 被拦截.
- The application installed no menu of its own, so macOS used Electron's default template. That
  template binds neither `Cmd+F` nor `Shift+Cmd+F`, so nothing claimed the chord on the menu path
  either.

So the mechanism could deliver the chord only in the specific case where some view happened to hold
focus. That is what the 10:28 records are, and what the reports are not.

## Feasibility

Both shortcuts are feasible; `before-input-event` is the wrong carrier for them. A **menu accelerator**
is the mechanism AppKit guarantees: it is delivered whenever the application is frontmost, regardless
of which view — or no view — holds focus, and regardless of what the PDF plugin does with keystrokes.

## Repair

`src/main/menu/applicationFindMenu.service.ts` installs an application menu on macOS whose Edit menu
carries `Find…` (`Command+F`) and `Find in Project…` (`Shift+Command+F`). Both route into
`OnlyPreviewWindowHelper.runMenuFindCommand`, which shares one body — `executeNativeCommand` — with the
`before-input-event` path, so the two carriers cannot drift. `before-input-event` stays bound; it now
handles the in-page cases and remains the diagnostic.

**Scoping** (owner constraint: 「不能和其他子进程或其他 app 冲突 比如我激活 eyesonagents 输入 cmd+f 不能触发
onlypreview 的 cmd+f」). The dispatcher acts only when `BaseWindow.getFocusedWindow()` is the
OnlyPreview window, so the chord is per window, not per application. Unlike `globalShortcut`, a menu
accelerator never takes the chord from another application.

**No accelerator theft inside Bitterless.** Two renderers own `Cmd+F` through their own keydown
handlers — chat message search (`messageSearch.store.ts`) and the submodules window (`App.vue`) — and a
menu accelerator preempts a renderer handler. An unclaimed chord is therefore replayed into whichever
web contents holds focus (`sendInputEvent`), so those windows keep the behaviour they had.
`onlyPreviewApplicationFindMenu.test.mjs` guards this, and guards that the template still carries the
default `appMenu`/`fileMenu`/`viewMenu`/`windowMenu` roles and the Edit roles, so installing a menu
does not cost `Cmd+C`, `Cmd+Q` or `Cmd+R`.

Windows and Linux keep the existing path: an application menu there renders an in-window menu bar,
which would put a visible strip inside every frameless Bitterless window, and those platforms deliver
Ctrl chords to the focused web contents without one.

## Second defect found in the same evidence

A detached DevTools window is a separate NSWindow that takes key status from the OnlyPreview window,
and DevTools binds both `Cmd+F` and `Shift+Cmd+F` itself. The manual `Alt+Cmd+I` toggle opened it with
no `activate: false`, so one press of the DevTools shortcut silently disabled both find chords for the
rest of the session. It now opens inactive, matching the auto-open path. The blur record also names
who took key status (`keyOwner=other-app|own-window`), which is the measurement that would have
answered this in one line.

## Verification

- `tests/onlypreview/onlyPreviewApplicationFindMenu.test.mjs` — accelerators present, claimed chord not
  replayed, unclaimed chord replayed with the exact modifiers, default roles preserved.
- Owner check: with OnlyPreview frontmost, `Cmd+F` over a PDF and `Shift+Cmd+F` over any file. The
  terminal running `yarn dev:prod` prints `[onlypreview] event=menu-find command=… handled=true`.
