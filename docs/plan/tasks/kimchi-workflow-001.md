---
id: kimchi-workflow-001
status: implemented-owner-verification-pending
depends-on: []
verify: focused Node behavior tests, TypeScript/UI/i18n checks, build; human model/UI testing pending
---

# Migrate workflow runtime to Kimchi and add deterministic shortcuts

Contract: [Kimchi workflow](../../features/kimchi-workflow.md).

- [x] Replace legacy runtime and adapt Pi session/IPC cleanup.
- [x] Port builtins and a real-agent demo.
- [x] Add /workflow discovery and deterministic execution.
- [x] Verify code, update testing prompts, hand off for human testing.

No branch changes, independent review, or Electron E2E.

## Verification result

2026-09-16: combined workflow suites 173/173; both strict workflow and focused UI types, i18n, full builds and external-TS built-entry probes passed. Human test: restart updated developer instance with configured Pi provider/model, run `/workflow demo`, verify one-Agent stop and whole-run stop, then external TS and five builtins. Real model / Electron E2E / signed package / Windows were not run. Additional legacy check failures are recorded in the testing guide, not claimed as passes.
