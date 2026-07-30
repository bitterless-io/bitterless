---
id: application-diagnostics-010
scope: desktop-diagnostics
status: implemented-owner-verification-pending
depends-on: [model-provider-fresh-login-callback-009]
---

# Objective

Add environment-isolated persistent Electron logging and a Settings Log page that exposes the
live log location, startup state, application directories, and safe environment status, while
recording enough sanitized Codex OAuth lifecycle detail to diagnose the current post-callback
failure.

# Context

- `docs/features/application-diagnostics.md`
- `docs/features/model-provider.md`
- `docs/issues/application-file-logging-missing.md`
- `docs/issues/codex-model-login-browser-success-stuck.md`
- `projects/micromeet-cowork/docs/features/logging.md`
- `projects/micromeet-cowork/apps/cowork/src/renderer/workbench/src/views/WorkbenchLogView.vue`

# Path

- `package.json`
- `yarn.lock`
- `src/main/app.main.ts`
- `src/main/environment/`
- `src/main/logging/`
- `src/main/diagnostics/`
- `src/main/codex/codexCredential.service.ts`
- `src/main/xpc/diagnostics.handler.ts`
- `src/main/xpc/xpc.helper.ts`
- `src/shared/diagnostics/`
- `src/shared/setting/settingNavigation.contract.ts`
- `src/renderer/home/src/views/setting/`
- `src/renderer/common/i18n/en.ts`
- `src/renderer/common/i18n/zh.ts`
- `scripts/diagnostics/`
- `docs/features/application-diagnostics.md`
- `docs/issues/application-file-logging-missing.md`

# Implementation

- Resolve the runtime profile and profile-specific userData before normal Main startup.
- Initialize `electron-log` with one profile-tagged file, console migration, error capture, and a
  first-party-only Renderer console allowlist.
- Keep Main as the single file writer; serialize sanitized UTC NDJSON fields `ts`, `level`,
  `profile`, `proc`, `world`, `scope`, `msg`, and `args`, derive `scope` from the first `[tag]`,
  classify Renderer entries into distinct `proc` values, and rotate at 5 MB.
- Add a strict value-free diagnostics XPC contract with a keyed directory allowlist.
- Reuse the existing startup diagnostics snapshot.
- Add a compact Arco/BEM Settings Log page immediately above About.
- Highlight the active log file with Main-owned `shell.showItemInFolder(logFile)` while retaining
  keyed directory-open behavior for the directory list.
- Log sanitized Codex browser-login lifecycle stages and failures without OAuth query values or
  credential content.

# Verification

- Add and run focused source/contract tests for profile naming, UTC NDJSON, 5 MB rotation,
  Renderer `proc` classification, the XPC allowlist, log-file reveal, Settings placement,
  environment redaction, and Codex log redaction.
- Run `yarn typecheck:node`.
- Run the Renderer i18n check and focused lint for touched Settings files.
- Run `git diff --check`.

# Reviews

- [Initial blocked review](../reviews/application-diagnostics-010-1.md)
- [Hash-router blocked review](../reviews/application-diagnostics-010-2.md)
- [Final passing review](../reviews/application-diagnostics-010-3.md)

# Handoff

Implementation and independent source review are complete. Owner runtime verification remains for
the installed/debug application, Codex browser sign-in failure evidence, and packaged log creation.
