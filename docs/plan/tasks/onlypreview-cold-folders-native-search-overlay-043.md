---
id: onlypreview-cold-folders-native-search-overlay-043
scope: Immediate upgraded-cache folders, bounded watcher recovery, and a topmost native Global Search child surface
status: implemented; owner verification pending
depends-on: [onlypreview-warm-search-before-reconcile-042]
verify: focused OnlyPreview Node tests, yarn typecheck:node, directed vue-tsc, yarn build, git diff --check; no Electron/Playwright/E2E
---

# Restore cold folder matches and move Global Search above Preview

## Objective

Make Files directory-name results available during the first schema-8 reconciliation of a reusable
legacy cache, stop recursive-watch failures/excluded-path churn from causing continuous full
rebuilds and orphan databases, and make Global Search a trusted child `WebContentsView` that
deterministically covers the active Vue/Chrome Preview content region, including raw PDF.

## Context

- `docs/features/onlypreview.md`
- `docs/design/onlypreview-global-search.md`
- `docs/design/onlypreview-preview-merge-find.md`
- `docs/issues/onlypreview-first-search-startup-delay.md`
- `docs/issues/onlypreview-cold-folder-search-and-native-search-overlay.md`

## Contract

- If the reusable SQLite snapshot is content-ready but its persisted non-file tree marker is not
  certified, construct provisional directory entries only from ancestors of its committed eligible
  file records. Do not traverse the filesystem, read bodies, query Main, invent empty directories,
  publish symlinks, or mark the provisional tier complete. Deduplicate in bounded linear work and
  stable-sort with the ordinary tree comparator.
- The complete candidate remains private. Promotion replaces provisional rows/tokens with one
  freshly certified tree snapshot under the existing reader/writer and generation fences.
- Partition watch batches before stat/reconcile. Physically excluded paths never invalidate Search
  or trigger a candidate build; they may only refresh an already loaded Browse listing and emit a
  bounded non-full commit. Visible paths in a mixed batch retain ordinary incremental semantics.
- A recursive-watch error must not enter a permanent fixed-interval rebuild loop. Retry watcher
  attachment with capped exponential backoff, and allow at most one completion-aware fallback full
  reconcile between retry attempts. Ticks while a reconcile is running cannot latch another build.
- Initialization reclaims only exact sibling artifacts named from the active database basename plus
  `.candidate-<uuid>` or `.previous-<uuid>` and their `-wal`/`-shm` companions. It must preserve the
  active database and every unrelated workspace database.
- Anchorless full-segment wildcard rules use an exact shared segment-language matcher. On ordinary
  paths it may merge only proven equivalent languages; filenames containing regex-dot line
  terminators retain ordered `*/` and `**/` semantics. Remaining anchorless embedded-wildcard
  rules have a fixed aggregate 64-state compile limit and fail before traversal when exceeded.
  Ordered descendant coverage may subtract the union of later full-segment excludes only within
  one non-refundable 16,384-credit budget per call. Every scale-dependent scan, representative,
  continuation, product state, fixed-width key, queue, and visited entry is reserved before work or
  allocation; budget exhaustion conservatively keeps traversal enabled.
- Add one local Global Search renderer entry and one Main-owned `WebContentsView` service. It is not
  a second top-level window. It uses the same clamped content bounds as Preview, stays detached when
  inactive, remains warm across close/reopen, and is always raised after an active Preview attach.
- Shell always reports real Preview host bounds. Remove the Global-Search-to-zero-bounds workaround
  and the Shell-owned Global Search workspace DOM. Preserve the visible Project tree, toolbar, and
  status rail around the overlaid content rectangle.
- Shell reports a strictly validated, host/generation-scoped snapshot containing workspace,
  readiness, root name, and current directory. Search pulls the current snapshot on mount/show and
  subscribes to nudges so it cannot miss an earlier Shell event.
- File-result open selects the Preview file and then detaches Search. Directory-result open uses a
  bounded Main-mediated action id; Shell expands/selects/centers the target and reports completion.
  Failure or timeout leaves Search open.
- `Shift+Cmd/Ctrl+F` closes file Find, captures the opener only once, raises/focuses Search, and
  focuses its query. Empty-query `Esc` restores the live opener, then Project, then active Preview.
  Search renderer failure detaches only Search and must not stop the shared Search runtime or close
  OnlyPreview.
- Raw Chrome HTML/PDF retains no preload. Search uses the trusted OnlyPreview preload with sandbox,
  context isolation, web security, navigation/window-open fences, strict XPC shapes, and no Main
  filesystem I/O.
- Keep the existing cooperative request fan-out: priority, one Files/Folder metadata pass, and
  Contents SQLite all start as sibling branches. Do not duplicate the tree into separate Files and
  Folder processes; isolate only Contents in a future persistent worker if per-section diagnostics
  prove FTS execution, rather than initialization, is the remaining bottleneck.

## Verification

- Hold first schema-8 reconcile after a valid schema-7 upgrade and prove a folder ancestor from the
  committed file tier streams in Files before promotion; prove empty folders/symlinks do not.
- Prove certified schema-8 directory rows remain authoritative and provisional duplicates are not
  introduced. Promotion terminal-replaces warm rows and revokes old result tokens.
- Prove `.git`, dependency, build, and output directory bursts do not request full Search reconcile;
  mixed visible-file changes remain incremental and loaded Browse listings still refresh.
- Prove watch failure uses capped reattachment/backoff, a pending slow reconcile cannot queue a
  successor on every fallback tick, and successful reattachment stops fallback work.
- Prove exact orphan candidate/previous SQLite artifacts are removed while active and unrelated
  databases and companions are untouched.
- Prove maximum anchorless wildcard families use shared dispatch without character-automaton work,
  newline ordering matches the regex oracle, and an unsafe embedded-wildcard aggregate fails fast.
- Fake-BaseWindow tests prove exact shared bounds, `Shell < Preview < Global Search`, re-raise after
  Vue/Chrome attach, inactive detach without Preview reload, warm reuse, crash isolation, and exact
  teardown.
- Contract tests prove initial context pull plus nudge updates, generation fences, live Current
  directory, file-open close, directory success close/focus, directory failure retention, repeated
  shortcut opener preservation, and two-stage Esc.
- Run focused non-Electron tests, Node and directed Renderer type checks, `yarn build`, and
  `git diff --check`. Do not run Electron, Playwright, E2E, packaged smoke, or the real application.

## Owner Verification

- Upgrade/recreate the legacy-cache condition, launch Preview, immediately search a known folder,
  and confirm it appears before the Index Rail completes.
- Open a PDF, invoke Global Search, resize the window, switch files from Project while search stays
  open, and confirm Search remains above Preview with correct bounds and live Current directory.
- Open one file result and one nested directory result, then verify Preview focus and Project
  expansion/selection/centering respectively.

## Delivery

- Legacy reusable indexes now expose provisional directory ancestors from committed eligible file
  paths immediately; the certified schema-8 tree atomically replaces them after reconciliation.
- Global Search is a warm, trusted child `WebContentsView` with the same bounds as Preview and is
  re-raised after every Vue/Chrome/PDF Preview attach.
- Excluded watch paths are rejected before stat/reconcile, recursive-watch fallback is bounded and
  completion-aware, and startup reclaims only exact stale candidate/previous SQLite artifacts.
- Priority, one Files/Folder metadata pass, and Contents start as cooperative sibling branches.
  Files and Folder deliberately share one scan; a separate persistent Contents worker remains a
  measured future option only if section timings identify FTS CPU as the bottleneck.

## Verification Results

- Focused non-Electron suite: **130/130 passed**.
- `yarn typecheck:node`, directed Renderer `vue-tsc`, `yarn build`, and `git diff --check`: passed.
- Independent closure [Review 10](../reviews/onlypreview-cold-folders-native-search-overlay-043-10.md):
  **PASS**, with no P1/P2/P3 finding.
- Maximum directed policy probes remain bounded: strict/union containment are about
  0.0032/0.0035 ms per call, and the 1,024-rule line-sensitive path is about 0.0265 ms per path.
- The whole-app Renderer i18n checker still stops on the unrelated existing Home/Tray creation-order
  assertion (`Tray must follow Home creation`); task-specific source/i18n integration tests pass.
- Electron, Playwright, packaged smoke, E2E, and the real application were not run, per owner
  instruction. During diagnosis, 39 exact stale candidate/previous cache artifacts using about
  29GB were removed without touching the active database or unrelated files; restart Preview before
  owner verification.
