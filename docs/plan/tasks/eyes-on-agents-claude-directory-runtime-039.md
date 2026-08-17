---
id: eyes-on-agents-claude-directory-runtime-039
scope: Persistent Claude directory configuration and Main-owned watcher lifecycle
status: implemented; owner verification pending
depends-on: [eyes-on-agents-claude-observation-ui-038]
---

# EyesOnAgents Claude Directory Runtime

## Objective

Let Ral select or restore automatic Claude config-directory discovery, persist that intent across
App/auth restarts, apply changes immediately without stale Preview capability, and make one
Main-owned watcher recover while the EyesOnAgents window is closed.

## Context

- `docs/features/eyes-on-agents-claude-observation.md`
- `docs/integrations/eyes-on-agents.md`
- `docs/integrations/eyes-on-agents-layout.md`
- `docs/plan/analysis/eyes-on-agents-claude.md`

## Path

- `docs/features/eyes-on-agents-claude-observation.md`
- `docs/integrations/eyes-on-agents-layout.md`
- `docs/plan/analysis/eyes-on-agents-claude.md`
- `docs/plan/README.md`
- `docs/plan/tasks/eyes-on-agents-claude-directory-runtime-039.md`
- `src/main/eyesOnAgents/claudeDirectoryConfig.service.ts`
- `src/main/eyesOnAgents/claudePath.resolver.ts`
- `src/main/eyesOnAgents/claudeObservation.service.ts`
- `src/main/eyesOnAgents/claudeWatcher.supervisor.ts`
- `src/main/xpc/eyesOnAgents.handler.ts`
- `src/main/eyesOnAgents/eyesOnAgents.service.ts`
- `src/preload/sqlite/dao/eyesOnAgents.dao.ts`
- `src/shared/eyesOnAgents/**`
- `src/renderer/eyesOnAgents/**`
- `src/renderer/common/i18n/{en,zh}.ts`
- `scripts/eyes-on-agents/**`

## Required behavior

- Persist exact schema-v1 `automatic/custom` intent in the existing Core setting table; malformed
  data is visible and fail-closed rather than silently selecting a directory.
- Keep paths Main-owned: Change uses a native directory picker and the renderer sends no path.
- Validate and canonicalize an existing config root while allowing its future `projects` child.
- Serialize apply operations. Persistence failure leaves the old watcher untouched; persistence
  success fences old scans/retries, clears only old transcript capabilities, and starts a full scan
  plus exactly one watcher for the new root.
- Preview validates against the currently applied root.
- Hydrate before automatic startup on every App launch and authenticated resume.
- Run one unref'ed bounded Main retry only while directory/watcher health is incomplete; healthy
  operation adds no second steady-state inventory poll.
- Cancel retry and prevent respawn on logout, auth suspension, replacement, and quit.
- Project a truthful directory status with mode, effective path, watcher state, last scan, next
  retry, and bounded error. Broadcast only actual status changes.
- Render a compact background-separated directory block with one read-only Arco Input, Change,
  Use automatic, and Retry; preserve the existing Claude Hook guide and card density.
- Remove generic setting value logs before storing local directory metadata.

## Verification

- Config tests: missing, valid custom, malformed, unsafe/symlink/oversized, cancel, identical apply,
  persistence failure, custom apply, and automatic reset.
- Runtime tests: hydrate-before-start, old-scan generation fence, one watcher, one retry timer,
  bounded delays, directory-created recovery while no renderer exists, child failure, stop/resume,
  and no delayed respawn.
- Repository tests prove root change clears Claude transcript path/activity/ambiguity only while
  preserving thread, Domain, unread, archive, Desktop ID, title, and runtime state.
- XPC/UI tests prove the renderer cannot provide a path, the native picker is the only custom-path
  source, Arco Input is read-only, status/actions are localized, and no new border/card row appears.
- Run full EyesOnAgents, migration audit, Core/UI typechecks, renderer i18n, production build, and
  `git diff --check` without launching Electron.
- Independent review must report no open P1, P2, or P3 finding before this task is done.

## Implementation evidence

- `ClaudeDirectoryConfigService` reads exact schema-v1 intent through `SettingDao.getStored`, treats
  missing data as automatic, rejects malformed/oversized/relative/symlink-backed values, and
  persists native-picker selections before changing the runtime.
- Main resolves a config root separately from its optional `projects` child. The renderer exposes
  only parameterless Change, Use automatic, and Retry actions; `dialog.showOpenDialog` is the only
  custom-path source.
- `ClaudeObservationService` hydrates before watcher work, serializes configuration replacement,
  fences older refreshes and retry callbacks by generation, and clears only Claude transcript
  path/activity/ambiguity capability after every valid hydrate or persisted root change before
  inventory admission. Preview validates against the applied root.
- One unref'ed Main timer owns `1s -> 5s -> 15s -> 30s -> 60s` recovery. It exists only while
  config-root, projects-root, scan, or watcher health is incomplete and is cancelled immediately on
  stop, replacement, logout/auth suspension, and shutdown. The watcher supervisor reports child
  failure upward and owns no independent restart timer.
- Watcher admission happens before the full scan so socket invalidations coalesce into a follow-up
  refresh rather than leaving a scan-to-watch gap. Admission requires an exact content-free IPC
  ready frame sent only after every `fs.watch` is installed. A watcher error closes all helper
  watchers and exits non-zero into the one Main retry path. Child, socket, cleanup, and observation
  generations fence delayed ready/exit/failure/close callbacks so an old generation cannot stop,
  unlink, downgrade, or schedule retry against a newer healthy watcher. A setting-read or
  capability-clear failure remains recoverable under the persisted current intent. Stop and root
  replacement generation-fence old refreshes, join them, then perform a final watcher stop so an
  in-flight stale start cannot survive logout, quit, or replacement. External refreshes cannot
  bypass pending capability cleanup or reverse an explicit stopped/auth-suspended lifecycle intent.
  Every explicit start/resume clears the prior applied root before awaiting persisted configuration,
  so renderer-tail polling cannot scan a stale root during hydration. A native directory action
  arriving after stop persists and projects the new path while remaining stopped; cleanup and
  scanning wait for the next start.
- Snapshot status reports mode, effective/configured paths, watcher state, Desktop root count,
  scan timestamps, next retry, and a bounded error. Root replacement atomically clears the prior
  root's watcher/scan/retry truth; an invalid resume hydrate uses a pathless safe error snapshot.
  The Connection drawer renders one quiet background surface with a read-only bordered Arco Input,
  keeps Use automatic available for invalid settings, and adds no decorative border or card row.
- Generic `SettingDao` get/upsert value logging was removed before local directory metadata was
  persisted.

## Verification evidence

- `node scripts/eyes-on-agents/claude-directory-config.test.mjs` — passed missing, valid, malformed,
  unsafe/symlink/oversized, native-picker cancel, persistence failure, custom apply, and automatic
  reset fixtures.
- `node scripts/eyes-on-agents/claude-directory-runtime.test.mjs` — passed hydrate/start,
  fresh-runtime capability cleanup, malformed-setting automatic recovery, root-status reset,
  retry singleton/backoff reset, clear-first admission, no-renderer recovery, stop/resume, stopped
  refresh/config action, and deferred resume-hydration fixtures.
- `node scripts/eyes-on-agents/claude-directory-runtime-race.test.mjs` — passed stale-start and
  replacement fencing, capability-clear recovery, stale watcher failure suppression, watcher fatal
  error cleanup, strict delayed-ready admission, pending termination cleanup, child epoch isolation,
  and old socket-generation preservation fixtures.
- `yarn test:eyes-on-agents:claude` — passed with the directory runtime suite included.
- `yarn test:eyes-on-agents:repository` — passed transcript-capability-only cleanup preservation.
- `yarn test:eyes-on-agents:ui` — passed 52 tests, including pathless native-picker contract,
  read-only Arco Input, localized actions/status, and background-only hierarchy assertions.
- `yarn test:eyes-on-agents` — passed the full non-Electron EyesOnAgents suite.
- `yarn typecheck:eyes-on-agents:core` — passed.
- `yarn typecheck:eyes-on-agents:ui` — passed.
- `yarn check:renderer-i18n` — passed.
- `yarn audit:sqlite-migrations` — passed 14 Core, 7 Maestro, 10 Todoist sync, and 8 Trench
  baselines.
- `node scripts/environment/runWithRuntimeProfile.cjs release_prod -- yarn _build:release` — passed
  and emitted the standalone `claudeDirectoryWatcher.js` helper.
- `git diff --check` — passed.
- Electron was not launched; live UI and native-picker acceptance remain with Ral.

## Review

- Independent functional review: [eyes-on-agents-claude-directory-runtime-039-1](../reviews/eyes-on-agents-claude-directory-runtime-039-1.md)
  — accepted with no open P1, P2, or P3 finding.
- Standard code review: [eyes-on-agents-claude-directory-runtime-039-code-review](../reviews/eyes-on-agents-claude-directory-runtime-039-code-review.md)
  — no 039-introduced TS-1, TS-2, FE-1, or FE-2 finding; four pre-existing oversized files remain
  recorded as structural debt outside this task.
- Implementation is complete. Live native-picker, directory-status, restart, and auth-resume UI
  acceptance remains with Ral because Electron was intentionally not launched.
