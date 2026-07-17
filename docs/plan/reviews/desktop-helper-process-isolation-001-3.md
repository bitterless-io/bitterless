# Desktop Helper Process Isolation Review — Round 3

Status: accepted

Date: 2026-07-17

## Conclusion

**Pass. No confirmed P0, P1, or P2 findings.** The Round 3 degraded-startup changes satisfy the
review contract: the Home window is no longer permanently gated by the saved-layout read or Core
SQLite readiness; a valid system-language fallback exists before the first `startGui()` await;
persisted language can hydrate later without overwriting a completed concurrent user mutation;
invalid persisted values remain strict contract errors; and shutdown cannot create Home after a
layout timeout. The earlier helper isolation, GUI singleton, packaged-path, shim, and exact
EyesOnAgents artifact guarantees remain covered and intact.

## Contract evidence

- `startGui()` installs the application-language fallback before its first asynchronous boundary
  (`src/main/app.main.ts:236`). The early macOS quit path also installs the fallback before opening
  the localized confirmation dialog (`src/main/app.main.ts:388`). Locale resolution is deliberately
  narrow: Chinese locale prefixes resolve to `zh`; every other system value resolves to `en`
  (`src/shared/i18n/applicationLanguage.ts:55`).
- Main-window layout hydration has a 1-second deadline and falls back to default bounds on failure
  or timeout (`src/main/windows/mainWindow.helper.ts:78`). Home is created immediately after that
  bounded read, before Core SQLite readiness, persisted-language hydration, MCP, shims, or
  EyesOnAgents startup (`src/main/app.main.ts:254`).
- Core readiness runs only after Home and has a 3-second deadline. Failure or timeout returns from
  optional startup before SQLite-dependent language, MCP, or EyesOnAgents work begins
  (`src/main/app.main.ts:280`). The deterministic never-resolving layout/Core fixtures assert the
  exact degraded sequence `language:fallback -> layout:timeout -> home:create -> core:timeout` and
  assert that no language read, MCP start, or Eyes start occurs
  (`scripts/mcp/multi-instance.test.mjs:344`).
- Persisted-language hydration has its own 1-second startup deadline, but the original operation is
  retained. A late valid result can therefore apply and broadcast after Home is visible; a late
  rejection is handled rather than becoming an unhandled rejection (`src/main/app.main.ts:298`).
- The language coordinator versions state around the durable read. A completed user write advances
  that version before changing runtime state, so a stale read returns the current snapshot instead
  of overwriting it (`src/shared/i18n/applicationLanguage.ts:154`,
  `src/shared/i18n/applicationLanguage.ts:178`). User writes remain serialized and durability-first.
  Parsing still occurs before stale-read suppression, so invalid persisted values reject with
  `INVALID_APP_LANGUAGE` rather than being normalized or silently ignored.
- Cleanup sets the shutdown flag synchronously, fences and joins optional startup, then tears down
  owned resources (`src/main/app.main.ts:195`). The newly introduced never-resolving Core wait is
  bounded by its timeout, so it cannot permanently hold that lifecycle join. If shutdown starts
  while layout hydration is pending, `MainWindowHelper.create()` checks the supplied guard after the
  bounded read and before `super.create()`; `startGui()` checks again afterward
  (`src/main/windows/mainWindow.helper.ts:97`, `src/main/app.main.ts:261`). Home is therefore not
  revived after shutdown.
- The focused multi-instance suite rechecks lifecycle overlap and pre-fenced startup, Node-only
  helper behavior, helper/shim quoting and endpoint pinning, `app.asar/out/main` paths, legacy helper
  modes, GUI-only singleton ownership, socket ownership/recovery, and Home ordering. The production
  build still emits dedicated MCP and Codex hook helpers, and the compiled MCP helper exits cleanly
  under `ELECTRON_RUN_AS_NODE=1` without launching the Electron GUI.

## Verification

| Check | Result |
|---|---|
| `yarn check:renderer-i18n` | pass: fallback, delayed valid hydration, strict invalid values, serialized writes, durability-before-runtime, and source ordering |
| deferred stale-read/concurrent-write probe | pass: a completed `setLanguage('zh')` remained authoritative when the earlier persisted `en` read resolved; late invalid hydration rejected and retained fallback state |
| `yarn test:mcp:multi-instance` | pass after sandbox escalation for its local Unix-socket fixtures; degraded deadlines plus prior isolation/lifecycle/singleton guarantees passed |
| `yarn test:eyes-on-agents:bridge` | pass: bridge and durable hook-delivery suites |
| `yarn typecheck:node` | pass |
| `yarn build` | pass; dedicated helper entries and renderer bundles emitted |
| compiled MCP RunAsNode smoke | pass with status 0; the expected macOS codesign diagnostic was non-fatal |
| `git diff --check` | pass |
| `yarn typecheck:web` | not clean because of existing unrelated errors across connector preloads, Coin/Home/Todo renderers, poker tests, and path helpers; no diagnostic referenced a Round 3 changed file |

No additional verification was left running or interrupted. No Electron GUI process was launched
during review.
