---
id: release-preview-channel-007-5
target: working-tree-2026-08-31-dev-next
compared_with: release-preview-channel-007-4
scope: Preview Maestro CLI isolation remediation
---

# Verdict

**PASS. No remaining blocking Preview CLI isolation finding.**

All three Review 4 findings are resolved. Preview now ignores a hostile inherited CLI executable,
pins CRMS, Sys, generic credential, session, and executable variables to its local CLI root before
filesystem work begins, propagates initialization failure, and leaves the runtime eligible for a
later retry. An independent real-CLI check also proved that CRMS and Sys login/logout create and
remove only Preview-local credential files while a hostile Stable home and generic credential path
remain untouched.

# Findings

None.

# Review 4 resolution

| Prior finding | Resolution | Result |
|---|---|---|
| P2: inherited `MICROMEET_CLI_PATH` could target Stable | `resolveMicromeetCliExecutablePath()` accepts the inherited executable only for non-Preview paths. Preview deterministically selects its packaged/development bundled binary, publishes that safe path to Main/children, and fails closed if it is absent. | resolved |
| P2: Sys login/logout could use global credential storage | Preview paths now include local `crms.json`, `sys.json`, their shared sibling key, and `session.json`. Preview forces realm-specific variables plus the generic fallback; the CLI's actual realm-specific → generic → default precedence therefore cannot reach `~/.micromeet`. | resolved |
| P2: partial initialization could preserve hostile environment and never retry | `runWithMicromeetCliEnvironment()` writes every forced Preview value before invoking the first fallible operation and does not catch callback errors. `ensureMicromeetCliIntegration()` also does not swallow errors. The handler calls it first and sets `runtimeInitialized = true` only after all initialization steps succeed; the existing `bootPromise.finally` clears the failed attempt. | resolved |

# Requirements evidence

| Requirement | Evidence | Result |
|---|---|---|
| Stable default persistence remains external | Non-Preview paths still resolve to `homeDirectory/.micromeet`, with the established shim, CRMS/Sys credential, sibling key, and session layout. | pass |
| Stable executable and credential overrides remain available | Non-Preview executable resolution retains inherited `MICROMEET_CLI_PATH`; environment resolution retains realm-specific, generic credential, and session overrides with the CLI's native precedence. | pass |
| Preview executable cannot be redirected to Stable | The executable resolver ignores inherited paths whenever `previewIsolated` is true; the hostile-path test proves Stable accepts the fixture while Preview returns its bundled Resources path. | pass |
| Every Preview CLI persistence path is local | Shim, CRMS credential, Sys credential, shared key, and legacy session are all descendants of `userData/cowork/cli`; the path test enumerates every field and proves Stable/Preview non-overlap. | pass |
| Main and children cannot fall back to global credentials | Preview forces `MICROMEET_CRMS_CREDENTIAL_FILE`, `MICROMEET_SYS_CREDENTIAL_FILE`, `MICROMEET_CREDENTIAL_FILE`, `MICROMEET_SESSION_FILE`, and `MICROMEET_CLI_PATH`; child construction spreads inherited values first and this resolved environment last. | pass |
| CRMS/Sys login and logout do not touch Stable | The CLI resolves realm-specific variables before generic/default paths and mutates only `ctx.config.credentialFile`; an independent temporary-server run created and removed both local realm files while never creating the hostile home `.micromeet` directory. | pass |
| Environment isolation precedes I/O and survives failure | Environment assignment completes before the initialization callback; injected callback failure propagates while every hostile target value remains replaced with its Preview-local value. | pass |
| Failed initialization is retryable | `ensureMicromeetCliIntegration()` is the first initialization call, errors propagate, `runtimeInitialized` remains false until the method's last statement, and failed `bootPromise` state is cleared by its existing `finally`. | pass |
| No new initialization cycle | The pure path/environment module imports only `node:path`; the CLI service has no reverse dependency on the handler, auth bridge, LLM service, or integration runner. | pass |

# Compatibility note

Stable's filesystem layout and explicit executable/realm/session overrides are unchanged. A
generic-only `MICROMEET_CREDENTIAL_FILE` now reaches CRMS and Sys through the CLI's documented
realm-specific-before-generic precedence; the former Main setup unintentionally injected a default
CRMS-specific value that shadowed that generic override. Treating the generic variable as effective
is an additive compatibility correction and matches the updated Stable contract rather than a
Preview-induced persistence change.

The PATH setup now leaves the Stable/Preview shim ahead of the bundled tools directory. That shim
executes the same resolved binary, including Stable's explicit executable override, so this does not
change the selected CLI or its storage owner.

# Verification

| Check | Result |
|---|---|
| `yarn test:maestro-cli-channel` | PASS, 10/10 |
| `node scripts/maestro/check-cli-integration.mjs` | PASS |
| `yarn workspace @micromeet/cli check:auth` | PASS; real compiled CLI credential/auth checks |
| Independent CRMS/Sys login/logout isolation harness | PASS; temporary local HTTP server, hostile HOME/generic paths untouched, local realm files created then removed, shared local key retained |
| `yarn test:runtime-profile` | PASS, 9/9 |
| `yarn typecheck:node` | PASS |
| scoped `git diff --check` | PASS before this report |
| Electron E2E | Not run — excluded by repository policy and unnecessary for this Main/CLI source review |
| Real publish | Not run — explicitly excluded from this independent review |

# Code Review file list

| # | File | Problem count |
|---|---|---:|
| 1 | `docs/features/desktop-release-channels.md` | 0 |
| 2 | `docs/plan/analysis/desktop-preview-release-channel.md` | 0 |
| 3 | `docs/features/maestro.md` | 0 |
| 4 | `docs/plan/tasks/release-preview-channel-007.md` | 0 |
| 5 | `src/main/maestro/cli/micromeetCliPath.service.ts` | 0 |
| 6 | `src/main/maestro/cli/micromeetCli.service.ts` | 0 |
| 7 | `src/main/maestro/integration/integrationRunner.service.ts` | 0 |
| 8 | `src/main/xpc/maestroWindow.handler.ts` | 0 |
| 9 | `scripts/maestro/check-cli-integration.mjs` | 0 |
| 10 | `scripts/maestro/micromeetCliChannelIsolation.test.ts` | 0 |
| 11 | `package.json` | 0 |

No `TS-1` or `TS-2` issue exists in the task-owned JavaScript/TypeScript diff. The unchanged bundled
CLI config, credential-store, and command files were inspected as behavioral dependencies rather
than modified files in this review.

# Conclusion

**Approved.** Preview's bundled Maestro CLI now has a fail-closed, retryable boundary that prevents
both normal and failed initialization paths from reaching Stable CLI state.
