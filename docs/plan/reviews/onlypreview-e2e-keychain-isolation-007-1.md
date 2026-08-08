---
id: onlypreview-e2e-keychain-isolation-007-1
status: pass
reviewed_task: onlypreview-e2e-keychain-isolation-007
target: 69157c7fe5750495e1b522c7975813669253bd91
base: a1c727ca10caa39dcfe173b12ebc5fb32658ca0b
date: 2026-08-08
review_type: independent-static-and-node-no-electron
---

# Verdict

**PASS — the full-application E2E suites are retained and every current launch path has the
required macOS mock-Keychain boundary. No P1, P2, or P3 finding remains.**

The target introduces one pure argument builder, routes both full-app Playwright fixtures through
it, and adds a Main fail-fast guard before readiness/startup work. Production secure-storage
behavior, isolated E2E environment controls, packaged rejection, suite files, and package commands
remain intact.

# Findings

- P1 blocking: none.
- P2 blocking: none.
- P3 non-blocking: none.

# Contract Assessment

## Complete launch-site ownership

A repository-wide source enumeration finds exactly two `_electron` full-application launch sites:

- Maestro: `tests/maestro/fixtures/bitterlessApp.fixture.ts:266-274`;
- OnlyPreview: `tests/onlypreview/fixtures/onlyPreviewApp.fixture.ts:170-179`.

Both import and call `buildBitterlessE2ELaunchArgs`; neither retains an inline `args: [projectRoot,
...]` bypass. The pure builder emits `--use-mock-keychain`, then the application path, then any
application arguments only when `platform === 'darwin'`. Windows retains the application path and
following arguments without the macOS switch
(`tests/e2e/electronLaunchArgs.ts:1-15`). The focused unit test also proves the input arguments are
not mutated and preserves the OnlyPreview explicit-open argument order
(`tests/e2e/electronLaunchArgs.test.mjs:5-30`).

## Pre-ready Main fail-fast

`assertE2EKeychainIsolation()` applies only to a non-helper, unpackaged, macOS process with
`BITTERLESS_E2E=1`; it requires
`app.commandLine.hasSwitch('use-mock-keychain')` and throws otherwise
(`src/main/app.main.ts:66-78`). Its top-level invocation precedes scheme registration, E2E path
configuration, and the first `app.whenReady()` call (`src/main/app.main.ts:79,217-238,561`). Thus an
incomplete full-app E2E process cannot enter GUI/Core SQLite/optional integration startup.

Static inspection of imported secure-storage modules found no top-level encryption/decryption call
before this guard. Their adapters/services call `safeStorage` only from invoked read/write/key
methods. The E2E Maestro path still returns its ephemeral random test key before the production
safe-storage branch.

## Existing safety and coverage preserved

- Both fixtures retain `BITTERLESS_E2E=1`, isolated `HOME`/platform home variables, isolated
  `userData`/`sessionData`, loopback mock origin/server, network guard inputs, deterministic or
  ephemeral SQLite test credentials, and sanitized child environment construction. The change is
  limited to how their existing argument arrays are constructed.
- Packaged E2E remains rejected by `configureE2EUserData()`; the new Main guard deliberately does
  not replace or weaken that rejection (`src/main/app.main.ts:217-238`). Helper modes remain outside
  the full-app boundary.
- Production `safeStorage` refusal/encryption/decryption sources are byte-unchanged by the target:
  `src/main/xpc/sqlitePassword.handler.ts`,
  `src/main/maestro/security/sqliteKey.service.ts`,
  `src/main/coin/resources/coinResource.runtime.ts`, and
  `src/main/coin/resources/resourceSecret.store.ts`. No plaintext/real-credential fallback is
  added.
- `tests/maestro/playwright.config.ts`, `tests/maestro/specs/baseline.spec.ts`,
  `tests/onlypreview/playwright.config.ts`, and `tests/onlypreview/specs/onlyPreview.spec.ts` are
  retained and unchanged. `package.json` still exposes both `test:e2e:maestro` and
  `test:e2e:onlypreview`; no E2E command or coverage was removed.
- The cumulative OnlyPreview source suite continues to cover the standalone window, read-only and
  capability boundaries, recent-directory ordering, settings, native Menu, DevTools, media/PDF,
  Home/Omni isolation, and the new launch/guard source integration.

# Scope Audit

- Target `69157c7fe5750495e1b522c7975813669253bd91` is the direct child of
  `a1c727ca10caa39dcfe173b12ebc5fb32658ca0b`.
- It changes exactly seven files: the task record, `app.main.ts`, two new pure launch-helper/test
  files, the two existing full-app fixtures, and the OnlyPreview source-test suite.
- It changes no package/lockfile, dependency, Playwright config/spec, production secure-storage
  source, renderer/preload, schema, migration, or application feature implementation.

# Verification

- `node --test tests/e2e/electronLaunchArgs.test.mjs` — pass, 2/2.
- `node --test tests/onlypreview/*.test.mjs` — pass, 46/46. The isolated worktree had no local
  dependency directory, so the rerun resolved `esbuild`, `js-yaml`, and TypeScript read-only from
  the existing primary checkout; no dependency was installed or changed.
- `yarn typecheck:node` — pass. A temporary ignored `node_modules` symlink to the existing primary
  checkout was used only for dependency resolution, verified, and removed immediately afterward.
- Repository-wide `_electron.launch` source enumeration — exactly two call sites; both use the
  shared builder.
- Static Main ordering audit — guard invocation precedes E2E path configuration and the first
  `app.whenReady()`.
- Static unchanged-file audit — package commands, both Playwright configs/specs, and all named
  production `safeStorage` sources have no target diff.
- `git diff --check a1c727ca10caa39dcfe173b12ebc5fb32658ca0b..69157c7fe5750495e1b522c7975813669253bd91`
  — pass.

Per the task and review restrictions, no Electron, Playwright, E2E package script, full Bitterless
application, or build command was run. No Keychain was accessed.

# Current Status

This review adds only `docs/plan/reviews/onlypreview-e2e-keychain-isolation-007-1.md`. No source,
task, package, dependency, configuration, existing review, or unrelated file was modified or
reverted.

# Conclusion

**pass**
