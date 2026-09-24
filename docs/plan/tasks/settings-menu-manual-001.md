---
id: settings-menu-manual-001
scope: Settings naming, General placement and built-in menu/manual
status: done
depends-on: []
verify: focused navigation/tool tests and proportionate type/build checks
---

# Settings, menu and manual

Implement [the feature contract](../../features/settings-menu-manual.md) on the current dev/next branch. Paired with micromeet-cowork.

No independent review, Electron E2E, app launch, branch operation or release. After code verification, hand the documented UI/Chat checks to Ral.

Implemented on 2026-09-24. Focused settings menu/manual tests: 6/6 passed. Main and Maestro renderer surface typechecks report 59 and 8 unrelated diagnostics respectively, with none in the new modules or edited Settings renderer. Targeted diff whitespace check passed. See the feature document for exact evidence, captured log paths and the pending manual UI/Chat checks. No Electron app was launched.
