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
   submodule is on a different branch, the row is flagged. The mini app never checks out, fetches,
   or writes anything into a repository.
5. **Live updates without polling the CPU.** Main watches `<root>` (for `.gitmodules`), each
   submodule Git directory (for `HEAD` and `packed-refs`), and each `refs` tree recursively. Events
   are debounced, the root is rescanned, and a new snapshot is broadcast to every renderer only when
   it differs from the last one. A 10-second interval rescan covers events the OS drops.
6. **Open in WebStorm targets the running IDE.** Main resolves the WebStorm installation that is
   already running (from the process list) and launches that installation's own launcher with the
   submodule directory, so the directory is opened by the running IDE instead of a second instance.
   macOS falls back to LaunchServices, Windows falls back to `webstorm64.exe` / `webstorm.exe` on
   `PATH`. Failure is reported to the renderer as a typed code, never as a silent no-op.
7. **Two hosts, one renderer.** The same `submodules` renderer and `submodules.js` preload run in the
   standalone Mini App window and in an Omni cell. Host identity is the only difference and it
   arrives as static preload context, never as a runtime probe.

## Hosts

| Host | Surface | Window actions | Chrome |
| --- | --- | --- | --- |
| `standalone` | `BrowserWindow`, `window_state` key `submodules` | minimize / maximize / close (Windows), menu-bar double-click maximize, macOS traffic lights | drag region, macOS traffic-light padding |
| `omni` | Omni cell operation `WebContentsView`, `miniAppId: 'submodules'` | none | no drag region, no traffic-light padding |

- Host is `--mode=omni` in the operation view's `additionalArguments`, exposed as
  `window.submodulesEnv.host`. Absent argument means `standalone`.
- Both hosts keep the full product capability: choose a root, live watch state, refresh, and Open in
  WebStorm. Only standalone-window controls are host-conditional.
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

Vertical list, one row per submodule, ordered by declared path:

```
┌────────────────────────────────────────────────────────────────────────┐
│ ▣ Submodules      /Users/ral/…/overmind   ● Live   [Open…] [Refresh]   │  menu bar
├────────────────────────────────────────────────────────────────────────┤
│ overmind · 14 submodules                                               │  root summary
├────────────────────────────────────────────────────────────────────────┤
│ ● bitterless                            [ dev/next ]  a1b2c3d  [ WS ]  │
│   projects/bitterless                                                  │
├────────────────────────────────────────────────────────────────────────┤
│ ● micromeet-mono            [ main ] ⚠ differs from .gitmodules [ WS ] │
│   projects/micromeet-mono                                              │
├────────────────────────────────────────────────────────────────────────┤
│ ○ rig                                   [ detached ]  9f8e7d6  [ WS ]  │
│   projects/rig                                                         │
└────────────────────────────────────────────────────────────────────────┘
```

In an Omni cell the same list keeps its own menu bar, minus every standalone-window affordance and
minus the macOS traffic-light gap, so a narrow split pane spends no width on chrome it cannot use:

```
┌──────────── Omni cell (miniAppId: submodules) ─────────────┐
│ ▣ Submodules            ● Live   [Open…] [Refresh]         │  no drag, no traffic-light padding
├────────────────────────────────────────────────────────────┤
│ overmind · 14 submodules                                   │
├────────────────────────────────────────────────────────────┤
│ ● bitterless               [ dev/next ]  a1b2c3d  [ WS ]   │
│   projects/bitterless                                      │
└────────────────────────────────────────────────────────────┘
```
