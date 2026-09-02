---
id: release-preview-channel-007-4
target: working-tree-2026-08-31-dev-next
compared_with: release-preview-channel-007-3
scope: Preview Maestro CLI persistence and child-process isolation
---

# Verdict

**BLOCKED. Three P2 isolation findings remain.**

The normal embedded CRMS path is isolated: Preview resolves its shim, CRMS credential, key, and
legacy session below `userData/cowork/cli`, overwrites the two CRMS/session values after expanding
the child environment, and initializes only after the runtime-profile bootstrap has selected
`Bitterless_PREVIEW`. Stable's default `~/.micromeet` path behavior remains unchanged.

The broader contract is not yet true, however. A parent `MICROMEET_CLI_PATH` can still make Preview
inspect and mutate a Stable-owned executable, the bundled CLI's Sys realm can still read/write its
default global credential, and an initialization failure before environment assignment is swallowed
after the caller has permanently marked the runtime initialized.

# Findings

## P2 — Preview still honors an inherited executable override that can target Stable storage

- `src/main/maestro/cli/micromeetCli.service.ts:32-36` accepts `MICROMEET_CLI_PATH` for every channel.
- `src/main/maestro/cli/micromeetCli.service.ts:128-134` then probes the resolved file, changes its
  mode on non-Windows hosts, writes that path into the Preview shim, and prepends its directory.
- If a launching shell exports `MICROMEET_CLI_PATH=~/.micromeet/bin/micromeet`, Preview therefore
  inspects and may mutate a Stable-owned file. This contradicts the task requirement that inherited
  global overrides remain effective only for Stable and the feature statement that Preview never
  inspects or mutates `~/.micromeet`.

Preview should select only its packaged/development bundled executable, or otherwise reject an
override outside its own channel boundary. Add a focused test with a hostile Stable-path override.

## P2 — Sys credential login/logout still falls back to the Stable global tree

- `src/main/maestro/cli/micromeetCliPath.service.ts:12-25` models only one CRMS credential plus the
  legacy session; its child environment has no Sys credential path.
- `packages/micromeet-cli/src/config.ts:106-117` selects the `sys` realm for `micromeet sys ...` and,
  without a realm-specific override, falls back to `defaultCredentialFile('sys')`.
- `packages/micromeet-cli/src/credentialStore.ts:9-15` resolves that default to
  `~/.micromeet/credentials/sys.json` and places its encryption key in the same directory.
- `packages/micromeet-cli/src/commands.ts:257-281` writes that file on Sys login and removes it on
  logout.

The current internal integration runner happens to issue CRMS commands, but the bundled CLI and its
Preview shim expose both realms. Consequently, the documented claims that every Preview CLI
credential/key remains local and that login/logout never touches Stable storage are not proven.
Resolve the Sys credential into Preview's local credential directory as well and cover both realm
login/logout path selection in the channel-isolation test.

## P2 — A filesystem initialization failure can leave inherited global values active permanently

- `src/main/xpc/maestroWindow.handler.ts:134-140` sets `runtimeInitialized = true` before invoking
  `ensureMicromeetCliIntegration()`.
- `src/main/maestro/cli/micromeetCli.service.ts:123-148` performs directory, executable, and shim
  filesystem work before forcing the Preview environment at lines 135-137, but catches and only logs
  every error.
- If any earlier operation fails, the inherited credential/session environment remains in the Main
  process. The caller still considers initialization complete and will never retry it.

Force the channel-owned environment before fallible filesystem work and let the caller distinguish
success from failure so a later attempt can retry. Add a failure-injection test proving hostile
parent values cannot survive partial initialization.

# Acceptance evidence

| Requirement | Evidence | Result |
|---|---|---|
| Stable default path remains `~/.micromeet` | `resolveMicromeetCliPaths()` retains `homeDirectory/.micromeet`; the former fixed shim, CRMS credential, key, and session paths map exactly to the new resolved fields. | pass |
| Preview CRMS state uses `userData/cowork/cli` | The Preview resolver places shim, CRMS credential, key, and legacy session below the local root; the focused path test checks non-overlap. | pass |
| Preview ignores inherited CRMS/session overrides in children | `integrationRunner.service.ts:105-111` spreads `process.env` first and `micromeetCliChildEnvironment()` last; the helper forces both local paths for Preview. | pass |
| Preview ignores every parent override capable of reaching Stable | `MICROMEET_CLI_PATH` remains channel-agnostic and can target the Stable tree. | **fail** |
| Login/logout cannot read, write, or remove global CLI state | Embedded CRMS sync is local, but bundled Sys login/logout still defaults to global storage. | **fail** |
| Main-process isolation survives initialization failure | Environment assignment follows fallible work, errors are swallowed, and the caller does not retry. | **fail** |
| Runtime profile is applied before CLI path lookup | `app.main.ts` imports the bootstrap first; the bootstrap sets `userData`; all CLI path resolution is lazy at function-call time. | pass |
| No circular dependency | The path resolver imports only `node:path`; CLI service has no reverse import to its handler, auth bridge, LLM service, or integration runner. | pass |

# Verification

| Check | Result |
|---|---|
| `yarn test:maestro-cli-channel` | PASS, 6/6; does not cover Sys, `MICROMEET_CLI_PATH`, or initialization failure |
| `node scripts/maestro/check-cli-integration.mjs` | PASS; structural happy-path assertions only |
| `yarn test:runtime-profile` | PASS, 9/9 |
| `yarn typecheck:node` | PASS |
| scoped `git diff --check` | PASS before this report |
| Electron E2E | Not run — excluded by repository policy and unnecessary for this source review |
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
| 9 | `src/main/maestro/auth/authBridge.ts` | 0 |
| 10 | `src/main/maestro/llm/maestroLlm.service.ts` | 0 |
| 11 | `src/main/environment/runtimeProfile.bootstrap.ts` | 0 |
| 12 | `src/main/environment/runtimeProfile.runtime.ts` | 0 |
| 13 | `scripts/maestro/check-cli-integration.mjs` | 0 |
| 14 | `scripts/maestro/micromeetCliChannelIsolation.test.ts` | 0 |
| 15 | `packages/micromeet-cli/src/config.ts` | 0 |
| 16 | `packages/micromeet-cli/src/credentialStore.ts` | 0 |
| 17 | `packages/micromeet-cli/src/commands.ts` | 0 |
| 18 | `package.json` | 0 |

No `TS-1` or `TS-2` finding was found in the reviewed TypeScript/JavaScript files; every reviewed
file is below 800 lines and no newly added eligible `function` declaration is present. The three
blocking findings above are acceptance-contract defects, not code-style findings.

# Conclusion

**Do not approve the Preview CLI persistence claim yet.** The current CRMS happy path is correct, but
the release must remain blocked until executable overrides, both credential realms, and partial
initialization failures cannot reach or preserve Stable-owned state.
