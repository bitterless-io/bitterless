# Review: desktop-command-line-debug-mode-010

## Findings

- **P1 · blocking:** None.
- **P2 · blocking:** None.
- **P3 · non-blocking:** None.

One P1 candidate was resolved during Verify. The four Maestro DevTools paths originally allowed
`COACH_*` environment switches to bypass compiled release mode. The final implementation requires
`import.meta.env.VITE_MODE === 'debug'` and rejects `BITTERLESS_E2E=1` before evaluating any
opt-in switch in:

- `src/main/maestro/windows/window.helper.ts:139-144`
- `src/main/maestro/windows/main/maestroControlView.service.ts:12-15`
- `src/main/maestro/windows/main/maestroWorkbenchView.service.ts:13-18`
- `src/main/maestro/windows/main/maestroBrowserView.service.ts:29-32,253-258`

The focused policy check now executes all four gates and proves that hostile `COACH_*` flags
cannot open DevTools in `release_dev` or `release_prod`, debug opt-ins work in `debug_dev` and
`debug_prod`, and debug E2E still opens none.

## Contract evidence

- All supported CLI, dev, start, default-build, E2E, and package aliases select an explicit runtime
  profile. GUI/E2E aliases select debug; package aliases select release without nesting the default
  debug build.
- Rig output is normalized to one authoritative `.env.rig` `VITE_MODE`. A hostile parent shell
  cannot override the selected profile, and the emitted build marker records the exact compiled
  profile.
- `app.main.ts` imports the runtime bootstrap first. Invalid packaged/debug and
  unpackaged/release-or-missing combinations terminate before application name, userData, logging,
  SQLite, Keychain, or BrowserWindow mutation. Node-only MCP and coding-agent helpers retain their
  non-GUI bypass.
- The active safeStorage import path is Main's guarded runtime adapter. Its policy permits only
  packaged release; unpackaged debug, `debug_prod`, and E2E use isolated/file-backed keys without
  reaching safeStorage or an operating-system credential store.
- Runtime paths use the compiled profile, and active MCP identities remain `bitterless`,
  `bitterless-debug-prod`, `bitterless-dev`, and `bitterless-debug-dev` with the corresponding
  `Bitterless*` application names.

## Verification evidence

- PASS: runtime-profile config/unit 7/7; application diagnostics 12/12; desktop package audit
  22/22; E2E launch/display config 10/10.
- PASS: Maestro embedded-host, DevTools mode matrix, debugger-toggle, and capture-gating checks.
- PASS: Todo MCP smoke, onboarding, and multi-instance routing.
- PASS: Node, MCP, strict E2E, Todoist-sync, Todo-web, and Trench focused typechecks; task-scoped
  ESLint and `git diff --check`.
- PASS: hostile-parent `release_dev` fresh build emitted one canonical release marker. Launching
  that release-compiled output unpackaged with child `VITE_MODE=debug` exited 1 in 497 ms, before
  creating an application-owned userData path or visible window.
- PASS: hostile-parent `VITE_MODE=release VITE_ENV=prod yarn build` produced fresh
  `debug_dev/dev/debug` output, a single `.env.rig` `VITE_MODE=debug`, and
  `Bitterless_DEBUG_DEV` package identity.
- PASS: focused Trench Electron E2E 1/1 on the exact `DELL S2721QS` target. The child was
  unpackaged debug with isolated HOME/userData and `--use-mock-keychain`; diagnostics reported only
  the isolated runtime passwords and no safeStorage tripwire. No project Electron or Playwright
  process remained afterward.
- BASELINE ONLY: full `yarn typecheck:web` reports the known connector SDK, Poker globals, renderer
  alias/type, EyesOnAgents, and shared non-Maestro path-helper diagnostics; no task-owned file is
  reported.
- ENVIRONMENT BASELINE ONLY: broad `yarn check:maestro` stops at the missing generated
  `node_modules/@earendil-works/pi-ai/dist/providers/openai-completions.js`; every task-relevant
  Maestro check executes independently and passes.

No Keychain, credential store, or secret-bearing file was read during verification.

## Conclusion

**pass** — no open P1, P2, or P3 finding remains. The deterministic debug CLI/E2E boundary,
release-only packaging boundary, pre-path fail-closed assertion, and mock-Keychain/display
contracts are independently verified.
