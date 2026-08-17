# EyesOnAgents Claude Provider Toggle Review — Round 1

Status: accepted

Date: 2026-08-17

## Findings

No open P1, P2, or P3 finding remains in the reviewed task 040 scope.

## Blocking-fix closure

- **Persisted intent and auth lifecycle — closed.** The preference accepts exactly
  `{ schemaVersion: 1, enabled, hookAdmissionAfter }`; missing data defaults on and malformed data
  fails closed with a bounded visible error. Hydration and writes share one intent tail, while App
  generation checks before and after persistence prevent an obsolete toggle from reviving Claude
  across shutdown, logout, or authenticated resume. Claude hydration remains non-blocking for Codex.
- **Crash-consistent enable boundary — closed.** Explicit enable first persists the pending
  `Number.MAX_SAFE_INTEGER` sentinel, clears every Bitterless-owned Claude outbox generation,
  captures and serially persists one finite cutoff, and only then starts observation and Hook
  admission. Pending restart repeats cleanup/finalization; ordinary enabled restart preserves its
  cutoff and legitimate enabled-period backlog.
- **Cutoff and durable admission — closed.** A delivery whose `occurredAt <= hookAdmissionAfter`
  returns duplicate-style committed success before inventory, runtime, receipt, proof, unread,
  broadcast, sound, or notification effects. The Hook server starts unarmed, directly persists and
  does not acknowledge boundary frames, drains coverage/backlog before admission, requires an empty
  durable backlog, and performs a stabilization drain after arming. Failed consume/removal or a
  current coverage gap keeps admission closed; pre-cutoff coverage evidence may be ignored safely.
- **Disable and in-flight fencing — closed.** Persisted Off withdraws intake/projection, stops and
  joins the listener, watcher/scan/retry lifecycle, and background poll, force-expires only Claude
  runtime authority, then clears only the owned Claude outbox. Hook commits and polling recheck their
  runtime generation after asynchronous writes, suppressing late notification/broadcast effects.
  Inventory rows, Domains, unread/archive/Open annotations, receipts, plugin installation, and saved
  directory intent remain intact.
- **Projection and renderer ordering — closed.** Main omits every Claude thread while unavailable
  and returns stopped placeholders instead of consulting disabled runtime sources. Snapshot reads
  retry across provider revisions, and the renderer rejects an older revision. Removing Claude-only
  data also clears a stale Project filter and search selection, while a project still represented by
  Codex remains selected.
- **Action, Read all, and notification gates — closed.** Claude data/runtime actions require the
  published provider runtime; plugin and directory recovery actions require persisted enabled intent
  plus a finalized cutoff, so an enabled-but-degraded provider remains repairable. Main selects a
  strict `codex` or `codex + claude` Read all allowlist and the DAO validates it. Final notification
  dispatch rechecks Claude availability without gating Codex notifications.
- **Codex isolation — closed.** Stored Off and malformed Claude state do not start Claude sources,
  yet Codex startup, App Server connection/sync, Hook inspection, hot/cold polling, Open, Focus,
  unread, archive, prompt capture, and notifications retain their existing paths. Provider teardown
  and late Claude work cannot overwrite Codex rows or status.
- **UI contract — closed.** The existing Claude card header contains one small accessible Arco
  Switch. Off folds the body to one localized explanation; invalid state remains visibly recoverable.
  The plugin action is labelled **Remove plugin**, with no new card row, decorative border, shadow,
  or brand surface.

## Contract assessment

- The persisted three-field preference, two-phase activation boundary, and minimum correct
  `occurredAt <= cutoff` ACK-drop contract are implemented at Main authority boundaries rather than
  trusted to renderer state or filesystem deletion alone.
- Outbox cleanup, late helper persistence, replay ordering, listener shutdown, provider transitions,
  and auth generations have explicit failure-closed behavior and dynamic race coverage.
- Hidden Claude rows cannot leak through Focus, All, Domain, Project, or global-search projections,
  and global actions do not acknowledge hidden Claude unread state.
- Recovery management remains possible after directory/plugin activation failure without rolling
  back the saved switch, advancing the cutoff, or clearing legitimate enabled-period backlog.

## Verification

- `yarn test:eyes-on-agents` — pass, including 22 provider lifecycle/isolation tests, six real
  Unix-socket admission fixtures, complete repository/App Server/Codex bridge coverage, and all 55
  EyesOnAgents UI tests.
- `yarn audit:sqlite-migrations` — pass across 14 Core, 7 Maestro, 10 Todoist sync, and 8 Trench
  baselines.
- `yarn typecheck:eyes-on-agents:core` — pass.
- `yarn typecheck:eyes-on-agents:ui` — pass.
- `yarn check:renderer-i18n` — pass.
- `node scripts/environment/runWithRuntimeProfile.cjs release_prod -- yarn _build:release` — pass;
  both standalone Claude helper entries are emitted.
- `git diff --check` — pass before this review file was authored.
- The standard rule review is recorded separately in
  `docs/plan/reviews/eyes-on-agents-claude-provider-toggle-040-code-review.md`; task 040 adds no new
  over-800-line file or function-style violation.
- No Electron process or UI automation was launched.

## Conclusion

**Pass.** Task 040's persisted Claude provider switch, crash-consistent admission cutoff, durable
Hook boundary, lifecycle teardown, filtered/revisioned projection, scoped global actions, and Codex
isolation are accepted. The implementation is ready for Ral's manual switch and folded-card UI
acceptance.
