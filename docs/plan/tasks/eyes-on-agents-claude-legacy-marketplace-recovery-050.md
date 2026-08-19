---
id: eyes-on-agents-claude-legacy-marketplace-recovery-050
scope: recover the released Claude marketplace from a proven legacy production-debug registration and preserve actionable XPC errors
status: in-progress
depends-on: [eyes-on-agents-claude-profile-isolation-048, eyes-on-agents-claude-hook-last-user-prompt-049]
---

# EyesOnAgents Claude Legacy Marketplace Recovery

## Objective

Make packaged production Repair complete the one-time migration from the old unqualified
`Bitterless_DEBUG_PROD` Claude marketplace, and prevent a failed Main action from becoming a
renderer null-dereference that hides the real recovery error.

## Required behavior

- Production may reclaim `bitterless-local` only when the registered source is exactly the
  deterministic sibling `Bitterless_DEBUG_PROD/eyes-on-agents/claude-marketplace` directory and
  bounded, non-symlink ownership/catalog inspection proves the single user-scope
  `bitterless-observer@bitterless-local` installation is Bitterless-owned.
- A proven legacy migration uninstalls that exact old user plugin, re-inspects the namespace, removes
  only that exact marketplace registration, then continues the normal production install/enable and
  final exact inspection. If an earlier attempt already uninstalled the exact plugin but stopped
  before marketplace removal, the same deterministic owner/catalog proof permits the zero-plugin
  namespace to resume at re-inspection/removal. It does not delete the legacy profile directory.
- Any unknown source, malformed marker/catalog, extra plugin, or non-user scope remains fail-closed
  with no mutating Claude command.
- Non-production profiles never reclaim the production marketplace. Their qualified identities keep
  coexisting without cross-profile mutation.
- Renderer snapshot actions treat an XPC `null` response as an action failure, preserve the last good
  snapshot, reload a fresh snapshot, and surface the bounded bridge/provider error. They never
  dereference the null response or replace newer provider revisions.
- Finder-launched macOS builds must not blindly choose the first fixed Claude executable. Before any
  setup mutation, candidate selection proves both plugin marketplace support and user-scoped
  marketplace removal support. An older candidate without `marketplace remove --scope` is skipped in
  favor of a later compatible candidate; if none exists, Setup/Repair stops before mutation with an
  actionable Claude Code update error.
- A successfully capability-proven executable is cached for the Main service lifetime. Normal
  inspection and Setup/Repair refreshes reuse it instead of spawning two help probes repeatedly;
  incompatible candidates are never cached.
- Every failed mutating Claude command identifies its bounded operation stage, such as marketplace
  removal, instead of collapsing to `Claude plugin command failed (1)`. Every install-path failure,
  including executable capability resolution and post-migration normal setup, is retained in bridge
  status so the renderer's null-XPC recovery can display that actionable error.
- Restarting Claude is not presented as a fix until Repair has completed. After a successful install,
  the existing Reload/Open-new-session action remains the boundary for loading the new plugin.
- The Repair panel uses one direct action sentence: it tells the user that Repair reinstalls and
  enables the Bitterless Claude plugin, then restores local observation. It does not repeat that a
  problem was found or use internal phrases such as "verified repair".
- Codex runtime-state behavior is unchanged; the owner-observed transient working delay is not treated
  as a confirmed regression.

## Verification

- Focused bridge tests cover the proven legacy production-debug migration command order and final
  production installation, including retry after interruption between uninstall and marketplace
  removal and Finder-style candidate selection that skips an incompatible Claude Code 2.1.138 for a
  later compatible CLI.
- Collision fixtures cover unknown source, malformed ownership, extra namespace plugin, and
  non-production callers with zero mutation.
- A renderer/store test covers null XPC action result, fresh status recovery, real error display,
  last-good snapshot preservation, and provider revision ordering.
- Run focused Claude/UI tests, core/UI typechecks, renderer i18n, and `git diff --check`. Do not launch
  or package Electron; Ral owns the packaged production Repair and Claude reload E2E.

## Implementation evidence

- Main injects the legacy source only when the production profile's userData is exactly
  `<appData>/Bitterless`; it derives the exact sibling `Bitterless_DEBUG_PROD` root from appData, so
  a custom E2E userData path cannot enable recovery. The bridge additionally requires the exact
  unqualified identity, bounded regular marker/catalog files, non-symlink directories, a single
  exact user plugin, and an exclusive marketplace namespace.
- Setup, Finish, and Repair already converge on `installClaudeBridge()` and the bridge `install()`
  path. A proven collision is migrated in the frozen uninstall/re-inspect/remove order before the
  normal production add/install/final-inspection flow. A proven zero-plugin namespace resumes after
  an interrupted uninstall without repeating it. The legacy directory is never removed.
- Executable selection probes allowlisted candidates and accepts only a CLI whose
  marketplace-removal help declares `--scope`. Incompatible candidates are skipped and never cached;
  the first compatible candidate is cached across internal and later refreshes. A cached command
  launch failure invalidates it without replaying the operation on another executable.
- If no candidate qualifies, Setup/Repair retains and returns a bounded update-Claude-Code error
  before mutation. Every install-path failure, including local preparation, migration, CLI mutation,
  and final inspection, is retained in bridge status with conservative configured/enabled facts so
  XPC-null recovery can display the exact safe action or operation-stage error.
- Failed mutations map to bounded marketplace registration/update/removal, plugin install/uninstall,
  or enablement stages without exposing executable paths or CLI output.
- Install failures are retained as bounded bridge inspection errors. Renderer snapshot actions
  recognize a runtime XPC `null`, keep the last valid snapshot, fetch current status, apply only a
  non-stale provider revision, and present the refreshed Claude bridge/provider error.
- The Repair panel now states its exact action in one sentence: reinstall and enable the Bitterless
  Claude plugin, then restore local observation.

## Verification evidence

- `node --test scripts/eyes-on-agents/claude-legacy-marketplace-recovery.test.mjs` — pass; covers the
  live `<appData>/Bitterless` path derivation and custom-E2E rejection, absent-state Setup,
  restart-required Repair, mutation order and intermediate inspections, retained legacy artifacts,
  retry after an interrupted marketplace removal, fail-closed collisions/non-user
  scope/non-production, incompatible-old-to-compatible-current CLI selection, update-required
  zero-mutation/status/XPC-null propagation, compatible-probe caching, later-stage error retention,
  named marketplace-removal failure, and provider-revision-safe null-XPC recovery.
- `node scripts/eyes-on-agents/claude-setup-recovery.test.mjs` — pass.
- `yarn test:eyes-on-agents:claude` — pass, including the new recovery test in the maintained
  Claude aggregate.
- `yarn typecheck:eyes-on-agents:core` — pass.
- `yarn typecheck:eyes-on-agents:ui` — pass.
- `yarn check:renderer-i18n` — pass.
- `node scripts/eyes-on-agents/claude-setup-render.test.mjs` — pass; the Repair panel renders the
  direct replacement sentence and omits the previous vague phrase.
- `git diff --check` — pass.
- Packaged production Setup/Repair and Claude reload/new-session E2E remain for Ral.

## Owner E2E evidence — 2026-08-18

- Packaged production reached the proven zero-plugin migration checkpoint: the exact old user plugin
  was removed, the exact legacy marketplace remained registered, and production artifacts/state had
  not yet been created.
- Main reported only `Claude plugin command failed (1)`. Read-only inspection showed Finder launched
  Bitterless with the system-only PATH, causing fixed-candidate resolution to select
  `~/.local/bin/claude` 2.1.138 before `/usr/local/bin/claude` 2.1.220.
- Isolated CLI reproduction proved 2.1.138 rejects `plugin marketplace remove ... --scope user` as an
  unknown option while 2.1.220 accepts the same command. No real Claude configuration was mutated
  during diagnosis; the zero-plugin checkpoint remains available for the next packaged E2E.
