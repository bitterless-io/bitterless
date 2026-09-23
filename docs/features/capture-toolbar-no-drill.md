# Capture toolbar without Drill

- Requested: 2026-09-23
- Status: code complete; human testing pending
- Paired products: Bitterless and CoWork

Ral requested removing the Drill button from Workbench → Capture in both products.
The current Bitterless Capture component already has no Drill button. CoWork still
renders a Drill/Drilling button and owns a confirmation handler and task subscription
solely for that entry point.

## Contract

- Capture no longer displays a Drill/Drilling action. Preserve recording, Action/Network
  toggles, filtering, export, ingest and other existing controls.
- Remove CoWork's button-specific handler, state and task subscription with unused imports.
- Replace API Doc/Sitemap empty-state directions that send users to the removed button.
  Keep those translations aligned across existing locales.
- Preserve underlying drill tools, service APIs, chat behavior and saved artifacts.
- Keep Bitterless's already-compliant Capture source unchanged.

```text
Capture toolbar: [Action] [Network] [existing recording/filter/export controls]
                (no Drill entry)
```

## Verification and handoff

Compile affected Vue components and styles, run the relevant localization check if
available, and check the scoped diff. No new tests for this small removal; no Electron/E2E.
Human check: open Workbench → Capture in both apps, confirm Drill is absent and recording
controls remain usable; CoWork API Doc/Sitemap empty states must not point to a missing button.

Completed: CoWork's button, exclusive confirmation/state/task subscription and unused
imports were removed. API Doc/Sitemap empty-state copy and four locales were updated.
Bitterless Capture already meets the requested behavior and its source remains unchanged.

Verification: all three changed CoWork Vue scripts/templates compiled with the installed
Vue SFC compiler (no component style blocks); `yarn check:i18n-keys` passed for all four
locales; scoped `git diff --check` passed. No new test suite or Electron/E2E was run.
