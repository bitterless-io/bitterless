# Workflows come from a local directory, not a remote library

Date: 2026-09-20. Status: specified; implementation in progress. Owner request (Ral 2026-09-20):
「cowork bl 的 workflow 取消从远程拉取 workflow 改为读取 ~/.micromeet-cowork 或 ~/.bitterless /workflows 的资源」,
then 「开始调整 bl workbench 的 workflows 实现，要能预览 workflow 列表, detail graph 和 source」,
「workbench workflow 需要有入口可以打开当前环境 bl cowork 的 workflow 目录」,
「~/.bitterless 带 env 的目录都是在 app 启动时需要 ensure 创建的」.

Scheme of record (both apps, with the Cowork half and the rejected alternatives):
`/Users/ral/Documents/projects/overmind/areas/agent-runtime/workflow/workflow.html`.
Paired with micromeet-cowork — this is common functionality, not product-specific; Cowork's half
follows in its own repo.

## Contract

- **The workflow library is a directory on this machine.** No HTTP, no session, no institution. List,
  graph, source and run must all work signed out and offline.
- **Root is per environment and exists from boot.** `~/.<appName lowercased>/workflows`, where
  `appName` is the runtime profile's — the same one axis `userData` and the default workspace already
  use, so a new edition gets its directory for free and the two lists cannot disagree.

  | profile | userData (`appName`) | workflows root |
  | --- | --- | --- |
  | `production` | `Bitterless` | `~/.bitterless/workflows` |
  | `production-preview` | `Bitterless_PREVIEW` | `~/.bitterless_preview/workflows` |
  | `production-debug` | `Bitterless_DEBUG_PROD` | `~/.bitterless_debug_prod/workflows` |
  | `test-debug` | `Bitterless_DEBUG_DEV` | `~/.bitterless_debug_dev/workflows` |
  | `test-release` | `Bitterless_DEV` | `~/.bitterless_dev/workflows` |

  `mkdir -p` runs at boot, not on first write: the user has to be able to open the directory before
  anything has put a package in it. `app.getPath('home')`, never `os.homedir()` — E2E redirects home
  and a test run must not touch a real `~/.bitterless*`.
- **One package = one directory.** `workflow.json` (the existing manifest, `parseWorkflowManifest`
  unchanged) plus the entry `.ts`/`.mts` it names. Identity is the directory name; reference is
  `local:<dirName>`. No `catalog.json`, no revision, no hash, no immutable installed copy — the user
  edits this directory directly, so a second copy would mean running something other than what they
  just wrote.
- **A malformed package is listed with its reason, never skipped.** Missing/oversized/unparseable
  manifest, missing entry, or an unusable directory name all produce a row carrying `error`. Anything
  still readable stays readable (an entry that exists can still be opened in the source tab). A
  package that is on disk but absent from the list is the one failure mode this feature must not have.
- **Reads:** full scan on view open, on refresh, and on a debounced `fs.watch(root, {recursive:true})`
  change; the selected entry file is read on demand, bounded by `MAX_SOURCE_BYTES`; a run re-reads
  that package's manifest and entry path first. No polling timer.
- **Run gate:** `realpath` inside the root may only be executed when it is the entry of a currently
  scanned, valid package. Paths outside the root keep today's rule (explicit user-supplied path).
  A script sitting in a package's `reference/` does not become runnable by being inside the root.
- **Workbench exposes list · flow graph · details · source, plus Open workflows folder.** The empty
  state shows the absolute root path and the same open action. Borderless icon buttons; no new
  outlined controls.
- **Limits** reuse `WORKFLOW_LIMITS` (manifest 256 KiB, 500 files, 100 MiB expanded, 200 nodes,
  500 edges) and add a 200-package scan cap whose overflow is reported, not silently dropped.

## Removed

`/workflow/list`, `/workflow/detail`, `/workflow/check-updates`, `/workflow/download-url`, the signed
`*.aliyuncs.com` archive download, the 60s poll, the customer-session/institution scoping
(`assetScope` writes from this feature), the `catalog.json` + `<revision>-<uuid>` immutable store, and
the institution authorization gate (`authorizeInstitution` / `authorizeInstalledWorkflow`). The gate
itself stays — only its criterion changes.

ZIP import stays, retargeted: it validates and expands into `<root>/<name>` so "someone sent me a
package" still has an entry point now that the remote path is gone.

Existing installed copies under `<userData>/cowork/institution-workflows/` are left in place,
unread. Deleting user data is not part of this change.

## Verification

Scoped Node tests for the root expression per profile, the scanner (valid, malformed manifest,
missing entry, bad directory name, overflow), the run gate (root-relative, symlink escape,
non-entry file inside the root), and the store's tab/selection behaviour; `yarn typecheck`,
`yarn typecheck:web`, i18n check, `yarn build`. No Electron E2E — see the workspace rule.
