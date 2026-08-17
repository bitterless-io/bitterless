# Submodules mini app

One Bitterless Mini App that opens a directory, reads every Git submodule declared by its
`.gitmodules`, and keeps each submodule's current branch visible while the working copies change.

## Contract

1. **One watched root.** The app watches exactly one directory at a time. The root is chosen through
   a native directory dialog owned by Main and persisted in Core SQLite (`setting` table,
   `key = submodules_workspace`, `sub_key = root`), so reopening the window restores the same
   directory without asking again.
2. **Submodule inventory comes from `.gitmodules`.** The mini app never runs `git`. Preload reads
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
5. **Live updates without polling the CPU.** Preload watches `<root>` (for `.gitmodules`), each
   submodule Git directory (for `HEAD` and `packed-refs`), and each `refs` tree recursively. Events
   are debounced, the root is rescanned, and a new snapshot is pushed to the renderer only when it
   differs from the last one. A 10-second interval rescan covers events the OS drops.
6. **Open in WebStorm targets the running IDE.** Main resolves the WebStorm installation that is
   already running (from the process list) and launches that installation's own launcher with the
   submodule directory, so the directory is opened by the running IDE instead of a second instance.
   macOS falls back to LaunchServices, Windows falls back to `webstorm64.exe` / `webstorm.exe` on
   `PATH`. Failure is reported to the renderer as a typed code, never as a silent no-op.

## Boundaries

- Preload owns all filesystem reading, watching, and SQLite persistence. Main owns only the two OS
  capabilities the renderer cannot have: the directory dialog and the IDE launch.
- Errors cross the XPC boundary as codes; every user-visible string is resolved by renderer i18n.
- The window is a standalone Mini App window (`window_state` key `submodules`). It is not an Omni
  cell.

## Surfaces

| Surface | Path |
| --- | --- |
| Shared contract | `src/shared/submodules/submodules.type.ts` |
| Scanner | `src/preload/submodules/submoduleScanner.service.ts` |
| Watcher | `src/preload/submodules/submoduleWatcher.service.ts` |
| Runtime | `src/preload/submodules/submodulesRuntime.service.ts` |
| Preload handler | `src/preload/submodules/submodules.handler.ts` |
| Window handler | `src/main/xpc/submodulesWindow.handler.ts` |
| OS capabilities | `src/main/xpc/submodulesSystem.handler.ts` |
| Renderer | `src/renderer/submodules/` |
| Mini App entry | `src/renderer/home/src/views/miniApp/miniApps.constant.ts` |

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
