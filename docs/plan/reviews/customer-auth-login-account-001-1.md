# Customer Auth Login And Account Review — Round 1

Status: accepted for source delivery; Shanghai backend gate and owner runtime verification pending

Date: 2026-07-21

## Findings and resolution

The first independent review found five issues:

- **P1 · production endpoint switched before its backend gate.** Runtime configuration was restored
  to `https://api.bitterless.io`; the focused guard now requires that endpoint until the Shanghai
  FC, exact DSH database, migration, and public-auth gate passes.
- **P1 · post-auth navigation was neither locked nor verified.** Login now owns a transition flag,
  awaits `router.replace`, checks Vue Router navigation failures, and reports success only after the
  route completes.
- **P2 · logout teardown could race with a new activation.** Main tracks one deactivation promise;
  new activations wait for it, and stale activations only stop rather than starting another
  teardown.
- **P2 · focused checks covered source shape but not rejected async work.** A small pure best-effort
  helper is exercised with rejected activation and rejected cleanup operations.
- **P3 · the renderer duplicated its XPC contract.** The emitter now binds directly to the exported
  `AuthHandler` type.

The second review found three additional lifecycle edges:

- **P1 · stale activation could create an untracked second teardown.** The stale check is now a pure
  generation/state gate; teardown remains owned by manual deactivation or invalidation.
- **P1 · unbounded cleanup could keep Login disabled forever.** Local logout commits immediately and
  launches Core revoke/Main teardown in the background. A stalled cleanup no longer blocks the next
  login; Main still serializes optional runtime activation behind its tracked teardown.
- **P2 · route failure after first-password success could resubmit the password.** Mutation success
  is recorded before navigation. On route failure, the modal changes to a navigation-only Continue
  action and never calls `changePassword` again.

The final independent review reported no remaining blocking finding.

## Static contract assessment

- Core login plus `/auth/me` commits the local token/current customer before optional runtime
  activation starts.
- Optional activation rejection is observed separately and cannot clear a valid Core session.
- Restore, form submission, logout, and route transitions have explicit exclusion boundaries.
- General shows the current email and a flat localized Logout action without a new card border.
- Login no longer contains the small Bitterless eyebrow or panel outline.
- Production endpoint configuration remains unchanged until the backend release gate passes.

## Verification

`yarn test:customer-auth` passed 8/8 focused Node checks, including rejected best-effort work,
navigation ownership, background logout, stale-activation teardown ownership, first-password
navigation retry, XPC type linkage, UI surface rules, and the production endpoint guard.

Per owner instruction, no Electron process, full build, migration, seed, or production mutation was
run. Ral retains the runtime login and visual acceptance step.
