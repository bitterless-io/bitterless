# Submodules mini app

One Bitterless Mini App that opens a directory, reads every Git submodule declared by its
`.gitmodules`, and keeps each submodule's current branch visible while the working copies change.

## Contract

1. **One watched root.** The app watches exactly one directory at a time. The root is chosen through
   a native directory dialog owned by Main and persisted in Core SQLite (`setting` table,
   `key = submodules_workspace`, `sub_key = root`), so reopening the window restores the same
   directory without asking again.
2. **Submodule inventory comes from `.gitmodules`.** The mini app never runs `git`. Main reads
   `<root>/.gitmodules`, then for each declared submodule resolves its Git directory
   (`<submodule>/.git` directory, or the `gitdir:` pointer file a registered submodule uses) and
   reads `HEAD` plus the referenced loose or packed ref.
3. **Every entry reports one state:**
   - `ok` — HEAD points at a branch.
   - `detached` — HEAD points at a raw commit.
   - `uninitialized` — the directory exists but carries no Git directory.
   - `missing` — the declared path does not exist on disk.
   - `error` — the Git directory or `HEAD` could not be read; the entry carries an error code.
4. **Configured branch is compared, never enforced.** When `.gitmodules` declares `branch` and the
   submodule is on a different branch, the row is flagged. The mini app never checks out, fetches, or
   changes repository content. The one file it may write into a working copy is the `.BL_ANCHOR`
   reveal anchor of #6, and it is registered in that repository's local `info/exclude` so Git never
   reports or stages it.
5. **Live updates without polling the CPU.** Main watches `<root>` (for `.gitmodules`), each
   submodule Git directory (for `HEAD` and `packed-refs`), and each `refs` tree recursively. Events
   are debounced, the root is rescanned, and a new snapshot is broadcast to every renderer only when
   it differs from the last one. A 10-second interval rescan covers events the OS drops.
6. **The WebStorm action locates a submodule, it does not open a project.** The watched root is the
   only project ever handed to the IDE; the submodule is revealed by opening one file inside it
   (`webstorm <root> <file>`), because a directory argument means "open as a project" and is what
   spawns a second window. Root already open → the file lands as a tab in that window and the Project
   view locates the submodule. IDE not running → the same command cold-starts on the **root**, never
   on the submodule. The revealed file is the submodule's **README** (case-insensitive, any single
   extension, `.md` winning a tie); a submodule without one gets an empty **`.BL_ANCHOR`** created for
   this purpose and excluded from Git per #4, so every row opens one predictable file. Only a
   submodule directory that cannot be written at all hands over the root alone. macOS resolves the
   running installation's launcher first, then `/Applications`, then
   falls back to LaunchServices on the root; Windows uses `webstorm64.exe` / `webstorm.exe` on `PATH`
   with the same pair. Failure is reported to the renderer as a typed code, never as a silent no-op.
   Whether the Project tool window jumps to the revealed file is the IDE's own
   `Always Select Opened File` setting — see
   [issues/submodules-open-spawns-second-webstorm-window.md](../issues/submodules-open-spawns-second-webstorm-window.md).
7. **Order is Main's, filtering is the view's.** Two persisted list controls live beside the root in
   Core SQLite (`key = submodules_workspace`, `sub_key = view`) and travel inside the snapshot, so a
   control flipped in one surface reorders every other one through the existing broadcast:
   - **Show differ on top** — default **on**. Every submodule whose branch differs from `.gitmodules`
     is listed before every other row.
   - **Sort** — `name` (default) orders by the submodule's own directory name in **ASCII** (so `Zed`
     precedes `alpha`, unlike locale collation); `updated` orders by newest change first, with rows
     that have no timestamp last. Either mode breaks ties by name, and both apply *within* the
     differ group when the switch above is on. The selector carries neither a `Sort` label nor an
     icon — the option text (`Name`, `Update time`) is the whole control, the word survives only as
     its accessible name, and the dropdown sizes itself to the option text instead of being clipped
     to the 132px trigger.

   Main sorts once and publishes the ordered list. The **search box is renderer-only** and never
   persisted: it is a lookup, not a setting. It matches like the EyesOnAgents title filter — NFKC
   normalized, case-folded, split on whitespace/`-`/`_`/`.`/`/`/`\`/`:`/`|`, and every query token
   must appear in the row's directory name or declared path. While a search is active the root
   summary counts `visible/total`. The placeholder states the platform shortcut — `Search (⌘F)` on
   macOS, `Search (Alt+F)` on Windows, mirroring the Chat header tooltip — and **`Cmd+F`, `Alt+F` and
   `Ctrl+F` all focus the box** on either platform (the renderer has no find-in-page of its own).
   The handler matches on `event.code === 'KeyF'` first, because macOS `Option+F` reports
   `event.key === 'ƒ'`. `Esc` clears the box and keeps focus.
8. **"Recently changed" is Git state, not a working-tree walk.** `changedAt` is the newest mtime among
   five paths per submodule: the directory entry, `HEAD`, `index`, `packed-refs`, and the `refs` tree.
   Commit, checkout, branch switch, fetch, `add`, and any `status` that refreshes the index all move
   one of them, so the rank answers "which repository did I last work in" for the cost of five `stat`
   calls inside a scan that already reads those files. Recursively watching or walking working trees
   is deliberately **not** done: `node_modules` and build output across 30-odd submodules would cost
   thousands of watches and event storms for a rank these five paths already give. The consequence is
   documented, not hidden — editing a deep file without touching Git does not move a row until Git
   touches the index.
9. **Two hosts, one renderer.** The same `submodules` renderer and `submodules.js` preload run in the
   standalone Mini App window and in an Omni cell. Host identity is the only difference and it
   arrives as static preload context, never as a runtime probe.
10. **The standalone window is a narrow side panel.** `minWidth: 480` (documented exception to the
    800px house minimum, owner decision 2026-08-20), `minHeight: 600`. The same minimum is passed to
    `windowStateService.resolve` and `register`, or a restored narrow width would be clamped back to
    the service's 800px default on the next launch.
11. **Debug DevTools opens last.** In debug mode (`import.meta.env.VITE_MODE === 'debug'`, never
    `is.dev`, and never while `BITTERLESS_E2E=1`) the standalone window opens detached DevTools
    *after* it is shown and focused, and only when DevTools is not already open. Opening it during
    window creation put the DevTools window behind the window that `focus()` then raised.

## Hosts

| Host | Surface | Window actions | Chrome |
| --- | --- | --- | --- |
| `standalone` | `BrowserWindow`, `window_state` key `submodules` | minimize / maximize / close (Windows), menu-bar double-click maximize, macOS traffic lights | drag region, macOS traffic-light padding |
| `omni` | Omni cell operation `WebContentsView`, `miniAppId: 'submodules'` | none | no drag region, no traffic-light padding |

- Host is `--mode=omni` in the operation view's `additionalArguments`, exposed as
  `window.submodulesEnv.host`. Absent argument means `standalone`.
- Both hosts keep the full product capability: choose a root, live watch state, refresh, the settings
  gear, the search and sort controls, and locate a submodule in WebStorm. Only standalone-window
  controls (minimize / maximize / close, the drag region, the traffic-light gap) are host-conditional.
- The Omni preload also loads the shared Omni active-frame SDK, so an embedded cell shows the
  accent-orange active frame like every other mini-app cell.

## One Main-owned runtime, broadcast to every view

There is exactly **one** scanner, **one** watcher set, and **one** `SUBMODULES_POLL_INTERVAL_MS`
rescan for the whole application, and they live in Main. Every renderer — the standalone window and
each Omni cell — is a pure view over that single runtime.

```text
                       ┌──────────────────── Main ────────────────────┐
  .gitmodules ────────►│ SubmoduleWatcher ──debounce──► rescan        │
  submodule .git/HEAD  │                                  │           │
  refs/** (recursive)  │  10s safety interval ────────────┤           │
                       │                                  ▼           │
                       │                     changed? ─no─► drop      │
                       │                          │ yes               │
                       │  SettingDao (Core SQLite) │                  │
                       │  submodules_workspace/root│                  │
                       └──────────────────────────┬───────────────────┘
                                                  │ xpcMain.broadcast
                        submodules/snapshot       │ (SUBMODULES_SNAPSHOT_EVENT)
              ┌───────────────────────────────────┼───────────────────────────┐
              ▼                                   ▼                           ▼
   standalone renderer                   Omni cell renderer          Omni cell renderer
   (applySnapshot)                       (applySnapshot)              (applySnapshot)
```

- **No duplicated work.** Opening the standalone window while two Omni cells show Submodules costs
  the same filesystem watches and the same one rescan interval as a single view.
- **One authoritative root, live everywhere.** Choosing a root in any view persists it once and
  broadcasts the new snapshot to every other view immediately. There is no last-write-wins window and
  no reload needed — the cross-instance divergence a per-view runtime would have is structurally
  absent.
- **Snapshot identity gates the broadcast.** The scan timestamp is excluded from the fingerprint, so
  a watcher burst or an unchanged safety rescan emits nothing.
- **Watching follows the views.** The runtime arms on the first `initialize()` and disarms — releasing
  every `FSWatcher` and the interval — as soon as a debounced change or safety tick finds no live
  Submodules surface (no standalone window and no `submodules` mini-app cell). The persisted root
  survives; the next view re-arms it. A closed UI therefore leaves no recursive watcher running.

## Boundaries

- Main owns all filesystem reading, watching, SQLite persistence, the directory dialog, and the IDE
  launch. The preload exposes only typed XPC plus static host context; it reads no files.
- Renderers never scan and never watch. They call the four `SubmodulesApi` methods and subscribe to
  `SUBMODULES_SNAPSHOT_EVENT`; a broadcast is the only unsolicited state they accept.
- Errors cross the XPC boundary as codes; every user-visible string is resolved by renderer i18n.
- The directory dialog is parented to the focused top-level window resolved as a `BaseWindow`, so it
  attaches to the Omni `BaseWindow` as well as to the standalone `BrowserWindow`.
- `SubmodulesWindowApi` only ever addresses the standalone window. An Omni-hosted renderer must not
  call it, so an open standalone window can never be minimized, maximized, or closed by an embedded
  cell.

## Surfaces

| Surface | Path |
| --- | --- |
| Shared contract | `src/shared/submodules/submodules.type.ts` |
| Scanner | `src/main/submodules/submoduleScanner.service.ts` |
| Watcher | `src/main/submodules/submoduleWatcher.service.ts` |
| Row order | `src/main/submodules/submoduleOrder.service.ts` |
| IDE reveal anchor | `src/main/submodules/ideReveal.service.ts` |
| Runtime | `src/main/submodules/submodulesRuntime.service.ts` |
| XPC handler | `src/main/xpc/submodules.handler.ts` |
| Window handler | `src/main/xpc/submodulesWindow.handler.ts` |
| OS capabilities | `src/main/xpc/submodulesSystem.handler.ts` |
| Preload | `src/preload/submodules/submodules.preload.ts` |
| Renderer | `src/renderer/submodules/` |
| Host context | `src/renderer/submodules/src/contextBridge/submodulesEnv.bridge.ts` |
| Mini App entry | `src/renderer/home/src/views/miniApp/miniApps.constant.ts` |
| Omni runtime | `src/main/windows/omniMiniAppRuntime.service.ts` |
| Omni cell option | `src/renderer/omni/omniControl/src/components/OmniPane.vue` |

## Layout

Menu bar, root summary, **controls row**, then the list. The controls row exists only while a root is
watched: the search box takes the free width and the sort selector keeps a fixed 132px so the 480px
window still fits both. The gear in the menu bar opens the settings popover holding **Show differ on
top**. One row per submodule, ordered as contract #7 describes. Every row is exactly two lines:

- **Line 1** — left: the submodule's own directory name. Right: branch tag, short commit, and the
  Open action as an icon-only [`IconBtn`](../../src/renderer/common/components/IconBtn/IconBtn.vue)
  (no `WebStorm` label, hover fill, 26px in this list).
- **Line 2** — left: the declared relative path. Right: every warning — the
  `differs from .gitmodules` mismatch and the entry error.

Because `.gitmodules` section names are path-shaped (`projects/bitterless`), the relative path belongs
to line 2 alone and is never repeated in the title. A row carries no border in any state and no state
dot, and it does not react to hover (owner decision 2026-08-20) — state is already carried by the
branch tag and the line-2 warnings, so the only row-level state affordance is the `missing`/`error`
background, while hover feedback belongs to the action button alone:

```
┌────────────────────────────────────────────────────────────────────────┐
│ ▣ Submodules   /Users/ral/…/overmind  ● Live  [Open…] [Refresh]  [⚙]   │  menu bar
├────────────────────────────────────────────────────────────────────────┤
│ overmind · 14 submodules                                               │  root summary
├────────────────────────────────────────────────────────────────────────┤
│ [🔍 Search (⌘F)                           ]        [ Name        ▾]   │  controls row
├────────────────────────────────────────────────────────────────────────┤
│ micromeet-mono                              [ main ]  9f8e7d6     [↗]  │  differ first
│ projects/micromeet-mono                       ⚠ differs from .gitmodules│
│                                                                        │
│ bitterless                               [ dev/next ]  a1b2c3d    [↗]  │
│ projects/bitterless                                                    │
│                                                                        │
│ rig                                      [ detached ]  a7c1e4b    [↗]  │
│ projects/rig                                                           │
└────────────────────────────────────────────────────────────────────────┘

        gear popover
        ┌──────────────────────────────────────────┐
        │ (●) Show differ on top                   │
        │ List submodules that differ from         │
        │ .gitmodules before every other row.      │
        └──────────────────────────────────────────┘
```

In an Omni cell the same list keeps its own menu bar, minus every standalone-window affordance and
minus the macOS traffic-light gap, so a narrow split pane spends no width on chrome it cannot use:

```
┌──────────── Omni cell (miniAppId: submodules) ─────────────┐
│ ▣ Submodules            ● Live   [Open…] [Refresh]         │  no drag, no traffic-light padding
├────────────────────────────────────────────────────────────┤
│ overmind · 14 submodules                                   │
├────────────────────────────────────────────────────────────┤
│ bitterless                 [ dev/next ]  a1b2c3d    [↗]    │
│ projects/bitterless                                        │
└────────────────────────────────────────────────────────────┘
```
