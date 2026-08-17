# EyesOnAgents Claude Directory Runtime Review — Round 1

Status: accepted

Date: 2026-08-17

## Findings

No open P1, P2, or P3 finding remains in the reviewed task 039 scope.

## Blocking-fix closure

- **Persisted intent and path trust boundary — closed.** The Core setting stores only the exact
  schema-v1 automatic/custom shape. Missing data selects automatic discovery; malformed,
  oversized, relative, unsafe, or symlink-backed data fails closed. Custom paths originate only
  from Main's native directory picker, are canonicalized before persistence, and never cross a
  renderer request boundary.
- **Crash-consistent capability cutover — closed.** Persistence completes before runtime mutation.
  Every valid startup/resume hydrate and every effective-root replacement marks transcript
  capability cleanup pending before inventory admission. Cleanup revokes only Claude transcript
  path, transcript activity, and ambiguity fields; thread identity, title, Desktop ID, Domain,
  unread, archive, and runtime history remain intact. A crash after persistence but before cleanup
  is therefore repaired by the next hydrate, and Preview always revalidates against the applied
  root.
- **Serialized lifecycle and generation fencing — closed.** Startup withdraws the prior applied
  root before awaiting persisted configuration. Replacement, stop, logout, auth suspension, and
  shutdown invalidate older scans/retries, join in-flight refreshes, and perform a final watcher
  stop. External refresh cannot bypass pending capability cleanup, scan the prior root during
  hydrate, reverse explicit stop intent, or respawn a stale helper. A directory change made while
  stopped remains stopped and is applied on the next explicit start.
- **Watcher admission and failure recovery — closed.** Main admits a helper only after an exact,
  content-free IPC ready frame sent after every `fs.watch` is installed; the full scan therefore
  starts after watcher admission. Any filesystem-watcher error closes the helper's watchers and
  exits non-zero into the single Main retry owner. Deferred ready/exit callbacks, pending socket
  cleanup, old Unix-socket identity, and late child epochs cannot stop, unlink, admit, or downgrade
  a newer healthy watcher.
- **Retry and truthful status — closed.** One unref'ed Main retry owns the bounded
  `1s -> 5s -> 15s -> 30s -> 60s` backoff and resets on replacement, resume, manual retry, and
  recovery. The supervisor has no self-restart loop. Current-generation watcher failure enters
  retrying, while stale-generation or already-recovered failure cannot overwrite the new status.
  Malformed configuration remains visibly recoverable through Change or Use automatic.
- **UI and metadata privacy — closed.** The Connection drawer uses one quiet background-separated
  directory surface, a bordered read-only Arco Input, localized state/actions, and no decorative
  card border. It exposes only the explicitly selected/effective config root, never an individual
  transcript path. Generic setting value logging was removed.

## Contract assessment

- The implementation satisfies automatic/custom persistence, native-picker ownership, applied-root
  Preview validation, startup/auth hydration, watcher-before-scan admission, single-owner recovery,
  and shutdown/no-respawn requirements.
- Capability cleanup is both narrowly scoped and crash-consistent. Persist, clear, scan, watcher,
  and status failures preserve the existing board and remain recoverable under the persisted intent.
- Dynamic race fixtures cover deferred hydrate, capability clear, refresh/start, helper ready,
  watcher failure, termination cleanup, child epoch, and Unix-socket close ordering rather than
  relying only on source-shape assertions.
- Renderer/API contracts remain parameterless for all directory actions. The live native picker and
  visual behavior remain intentionally reserved for Ral's manual Electron acceptance.

## Verification

- `yarn test:eyes-on-agents` — pass, including Claude directory config/runtime/race suites,
  repository preservation, Codex paths, and all 52 UI tests.
- `yarn audit:sqlite-migrations` — pass across 14 Core, 7 Maestro, 10 Todoist sync, and 8 Trench
  baselines.
- `yarn typecheck:eyes-on-agents:core` — pass.
- `yarn typecheck:eyes-on-agents:ui` — pass.
- `yarn check:renderer-i18n` — pass.
- `node scripts/environment/runWithRuntimeProfile.cjs release_prod -- yarn _build:release` — pass;
  the standalone `claudeDirectoryWatcher.js` helper is emitted.
- `git diff --check` — pass before this review file was authored.
- The standard rule review is recorded separately in
  `docs/plan/reviews/eyes-on-agents-claude-directory-runtime-039-code-review.md`; task 039 added no
  new over-800-line file or function-style violation. Its listed over-limit files are pre-existing
  structural debt, not an acceptance regression introduced by this task.
- No Electron process or UI automation was launched.

## Conclusion

**Pass.** Task 039's persisted Claude directory intent, crash-safe Preview capability cutover,
Main-owned watcher lifecycle, bounded recovery, status projection, and source-level Connection UI
are accepted. The implementation is ready for Ral's manual native-picker and live runtime
acceptance.
