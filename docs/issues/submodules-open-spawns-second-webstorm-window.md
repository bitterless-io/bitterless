# Submodules Open in WebStorm spawns a second window instead of locating the submodule

Status: fixed; owner verification pending

Feature: [Submodules mini app](../features/submodules.md)

## Report

Clicking the Open action on a submodule row opens the submodule directory in a **separate WebStorm
window**, even though that directory lives inside the watched workspace root (`overmind`) that
WebStorm already has open. The owner does not want a second project: he wants the running window to
**locate** the submodule. Opening should only happen when nothing is open yet, and then the target
must be the **workspace root**, never the submodule.

## Confirmed cause

Not a launcher-resolution defect — the launcher was already resolved correctly. The defect is the
argument shape. `webstorm --help` on the installed 2026.1.2 documents exactly two forms:

```
/project/dir                                     opens a project from the given directory
[/project/dir|--temp-project] ... file           opens the file, either in a context of the given
                                                 project or as a temporary single-file project
```

`submodulesSystem.handler.ts` passed the submodule **directory** as the single argument, which is by
definition "open this as a project" — so a second project window is the launcher doing exactly what
it was told. There is no directory form that means "reveal inside the current project", and no
external route either: the IDE's built-in web server answers `/api/about` (verified 200,
`WebStorm 2026.1.2`) but rejects `/api/file/<path>` with 404, and it only ever addressed files, never
directories.

The file form is the reveal: `webstorm <root> <file inside root>` was verified against a running
instance to open the file as a **tab in the existing window** — `recentProjects.xml` did not change
mtime, so no project-open occurred.

## Fix contract

- The **watched root is the only project argument** ever handed to the IDE. The submodule directory
  is never passed as a launch target, on any platform, in any fallback.
- Locating is performed by opening one file inside the submodule, and which file is **predictable**
  (owner decision 2026-08-20): the submodule's **README** — matched case-insensitively with or without
  a single extension (`README.md`, `readme`, `ReadMe.rst`), `.md` winning a tie, symlinked files
  allowed — otherwise an empty **`.BL_ANCHOR`** created in that directory for this purpose. No other
  file is ever picked: `package.json` and "first file in the directory" are deliberately not anchors,
  so a click never opens a surprising file.
- `.BL_ANCHOR` is a Bitterless artifact, never repository content: on creation it is appended once to
  the submodule's local `<gitdir>/info/exclude` (pointer-file and real-`.git` submodules and linked
  worktrees resolved), so `git status` stays clean and a `git add -A` sync cannot commit it into a
  shared or third-party repository. No tracked `.gitignore` is created or modified. Creation is
  idempotent and the exclusion is never duplicated.
- Root already open in the IDE → the file becomes a tab in that window and the Project view locates
  the submodule. Nothing open → the same command cold-starts on the **root** project and reveals the
  same file. One command covers both, so no unreliable "is this project open?" probe is needed.
- Only a submodule directory that cannot be written at all (the declared path is gone) falls back to
  handing over the root alone, reported as `via: 'root-project'`. An empty `uninitialized` submodule
  now gets an anchor and is located like any other row.
- macOS resolves the running installation's launcher first, then `/Applications/WebStorm.app`, then
  falls back to `open -a WebStorm <root>` (LaunchServices cannot carry the anchor file, so that route
  focuses the root without the reveal). Windows keeps `webstorm64.exe` / `webstorm.exe` on `PATH`
  with the same `<root> <file>` pair.
- Failure stays a typed code, never a silent no-op.

## Known limit — one IDE setting the app cannot control

Whether the **Project tool window jumps to** the revealed file depends on the IDE's own
`Always Select Opened File` (autoscroll from source) option. With it off, the file still opens as a
tab in the right window but the tree does not move. No CLI argument or API overrides it, so this
stays an owner-side one-time IDE setting.

## Acceptance

- With `overmind` open in WebStorm, clicking the action on `projects/bitterless` opens a file from
  that submodule in the **existing** window — no second window appears.
- With WebStorm not running, the same click opens **`overmind`** as the project, not
  `projects/bitterless`.
- An uninitialized submodule row does not open a second window either; it gets a `.BL_ANCHOR` and is
  located like the rest.
- After clicking a submodule without a README, `git status` inside that submodule stays clean.
- `node --test tests/submodules/*.test.mjs` passes, including the reveal-plan coverage.
- `yarn lint` reports no error for the touched files and `yarn build` succeeds.

## Resolution

`src/main/submodules/ideReveal.service.ts` is the new planner: `resolveAnchorFile(directory)` returns
the README or creates `.BL_ANCHOR` (excluding it through the resolved Git directory), and
`planIdeReveal({ rootPath, submodulePath })` returns the launcher argv, which is `[root, anchor]` or
`[root]` and never contains the submodule path alone. It depends on `node:*` only — the Git-directory
resolution is inlined rather than imported from the scanner — so
`tests/submodules/ideReveal.service.test.mjs` runs it directly under `node --test` (8 tests, real
temp-directory fixtures including pointer-file submodules and a pre-existing `info/exclude`).

`SubmodulesSystemApi.openInWebStorm` now takes `{ rootPath, path }`; `submodules.store.ts` passes
`snapshot.rootPath` with the clicked entry. `SubmodulesOpenResult.via` reports
`reveal-in-project` / `root-project` / `launch-services` in place of the old `running-instance` /
`path-launcher` codes. The row action, its i18n keys, and the error strings are unchanged.
