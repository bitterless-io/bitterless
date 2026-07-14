# Review: cowork-subapp-001

## Findings

- **P2 · blocking — Cowork shutdown does not drain all scheduled or agent work before the proxy
  lease and windows are released.** The feature contract requires close/auth/quit to stop Cowork
  schedulers and agents before teardown (`docs/features/cowork-subapp.md`, “User entry and
  lifecycle” and “Security and errors”). `IntegrationSchedulerService.tick()` launches
  `runTarget()` without retaining its promise, while `stop()` only clears the timer
  (`src/cowork/main/integration/integrationScheduler.service.ts:50-61,91-92,100-143`). The window
  shutdown calls that non-draining `stop()` and then proceeds (`src/cowork/main/windows/coworkWindow.helper.ts:6458-6477`).
  Agent cleanup has a second hole: `BaseAgent.abort()` returns immediately for idle managed
  sessions, one-shot sessions are not tracked, and the per-session agent maps are cleared before
  `resetLlmAgentSessions()` can reset those entries (`src/cowork/main/agent/BaseAgent.ts:273-325`;
  `src/cowork/main/windows/coworkWindow.helper.ts:6468-6477,6524-6528`). The host handler then
  restores the prior Undici dispatcher immediately after `shutdown()` returns
  (`src/main/xpc/coworkWindow.handler.ts:109-123`). A scheduled integration, idle runtime session,
  or one-shot generation can therefore survive window close/reopen and continue after Cowork has
  relinquished its proxy. **Fix:** make scheduler stop asynchronous and await every active run;
  provide an awaited agent disposal path that covers idle managed and one-shot sessions; dispose
  every agent before clearing its map; release the proxy only after those drains complete.

- **P2 · blocking — Host auth invalidation is race-prone and fails open when the Cowork session
  cannot be cleared.** `_destroyForAuth()` clears the SQLite session while the document-start auth
  bridge is still attached, swallows any clear failure, and only detaches the bridge later during
  general shutdown (`src/main/xpc/coworkWindow.handler.ts:57-65`;
  `src/cowork/main/windows/coworkWindow.helper.ts:6458-6499`). In parallel, the bridge dispatches
  untracked `handle()` calls and may persist a fresh login payload back into `CoworkSessionDao`
  (`src/cowork/main/auth/authBridge.ts:118-120,123-149`). `openCoworkWindow()` has no invalidated or
  clear-pending gate (`src/main/xpc/coworkWindow.handler.ts:40-55`). A late bridge event or DAO
  error can therefore leave a stale authenticated session that reappears on the next Cowork open,
  contrary to the auth-cleanup contract. **Fix:** quiesce the auth bridge first, await/drain pending
  bridge writes, then clear the Cowork session and CLI credential; if clearing fails, retain a
  fail-closed invalidated state that prevents reopening until cleanup succeeds.

- **P2 · blocking — The CLI packaging flow leaves generated binaries exposed to commits and packs
  the vendored CLI workspace into `app.asar`.** `prepare-cowork-cli.cjs` generates its platform
  binary under `packages/micromeet-cli/release/` and separately copies it to the intended staged
  resource (`scripts/prepare-cowork-cli.cjs:49-64,75-79`). `.gitignore` excludes only
  `build/cowork-tools/`, not the workspace `release/` directory (`.gitignore:29-30`). The builder
  file list also has no `!packages/micromeet-cli/**` exclusion, so CLI source and any generated
  release artifacts match the normal app payload in addition to the `extraResources` binary
  (`electron-builder.tmp.yml:5-33`). This violates the task's generated-binary hygiene and produces
  an unnecessary duplicate payload. **Fix:** ignore `packages/micromeet-cli/release/` and exclude
  `packages/micromeet-cli/**` from builder `files`, retaining only
  `build/cowork-tools -> cowork-tools` as `extraResources`.

- **P2 · blocking — The advertised Linux/unpacked build path cannot provide a runnable Micromeet
  CLI.** `build:linux` invokes Electron Builder without staging a CLI (`package.json:28`), while the
  staging script supports only macOS arm64/x64 and Windows (`scripts/prepare-cowork-cli.cjs:13-23`).
  On Linux, the default `prepare:cowork-cli` path used by `build:unpack` even selects the macOS arm64
  artifact. The resulting Linux app either has no CLI or a Mach-O CLI, so Cowork integration/report
  functions are not parity-complete. **Fix:** add a Linux CLI package target and stage it for both
  Linux package paths, or explicitly remove/disable Linux packaging until that target exists.

- **P3 · non-blocking — First-show readiness covers the pinned operation page but does not
  explicitly cover all first-party renderer loads.** The wrapper paths and build outputs are
  correct, but `whenReady()` waits only for `initialReady`; Home's `loadFile/loadURL` and the
  Control/Workbench load promises are not included (`src/cowork/main/windows/window.helper.ts:108-124`;
  `src/cowork/main/windows/coworkWindow.helper.ts:803-829,896-897,913-947`). A slow or failed
  first-party renderer can therefore be shown partially. Task 002's Electron baseline should
  assert all four surfaces, and the runtime should ideally aggregate their load/fail signals before
  first show.

## Verification

| Check | Result | Evidence |
|---|---|---|
| Upstream source inventory | pass | Compared Git tree at `689832d39e4b78f2717d5beedbe1c1c3f8db7f71`: all 158 `apps/cowork/src` paths are represented; the sole upstream omission is standalone `main/app.main.ts`, and the sole target-only runtime file is `main/data/coworkDataRoot.ts`. Four namespaced renderer HTML wrappers intentionally point Vite at the vendored sources. |
| CLI inventory | pass | 21 of 22 tracked upstream CLI files are vendored. The omitted `scripts/publish-public.cjs` is standalone CLI publication infrastructure, not runtime functionality. Security/interoperability changes are confined to the credential implementation and its checks. |
| Reachable feature graph | pass | Mini App card → `CoworkWindowHandler` → hidden SQLite → Cowork Home/operation/Control/Workbench is wired. `CoachXpcHandler` reaches browser, capture/replay, agents, skills/files/artifacts, integrations, LLM login, voice, and update adapters. Operation views have the Cowork partition and no privileged preload. |
| Singleton entry | pass (static) | Existing Cowork window is restored/focused and concurrent boots share `bootPromise` (`src/main/xpc/coworkWindow.handler.ts:40-55`). Interactive close/reopen/focus proof remains Task 002 E2E. |
| Namespace/isolation | pass | Aliases are Cowork-specific; writes resolve under `userData/cowork`; Chromium uses `persist:bitterless-cowork`; auth DAO is `CoworkSessionDao`; dormant vendored `PackageMainHelper`/`PathMainHelper` modules are not imported/registered; tab shortcuts are restricted to the Cowork partition; no Cowork app/menu/updater lifecycle takeover was found. |
| Proxy ownership mechanics | partial / blocked | Previous dispatcher capture, identity-checked restore, idempotent release, boot-failure cleanup, and credential-free logging are present (`src/cowork/main/net/proxy.ts`). Release is not safe until Finding 1's work-drain gap is fixed. |
| SQLite and CLI key security | pass | No fixed SQLCipher fallback or fixed/email-derived CLI key remains. SQLite uses random key material protected by Electron `safeStorage` and fails closed for DB-without-key. CLI v2 uses random 32-byte local key files, mode 0600/private directories, AES-256-GCM, and shared AAD/envelope fields. `yarn workspace @micromeet/cli check:auth` passed, including embedded-runtime envelope interoperability and tamper rejection. |
| PII/secrets/private paths | pass | Demo seed patients/doctors are explicitly DEMO and phone/HKID fields are star-masked. Scoped `gitleaks dir` scans of `src/cowork`, `packages/micromeet-cli`, and the host XPC directory found 0 leaks. No overmind/private source paths or generated executables were present in the reviewed tree. |
| Electron/native baseline | pass | `package.json` and `yarn why electron` both resolve exactly `40.10.6`; the pre-existing `Bitterless_DEV_DEBUG` hunk and `docs/plan/reviews/runtime-001-001.md` remain intact. |
| Build outputs / bytecode | pass | Independent `yarn build` exited 0. Output contains `coworkCoach.js`, `coworkSqlite.js`, all four Cowork renderer directories, and main output. Main bytecode is disabled and the Pi SDK remains a runtime `import()` in `out/main/app.main.js`. |
| Targeted Node typecheck | pass | TypeScript compiler API checked 101 Cowork/host-adapter roots from `tsconfig.node.json`: 0 diagnostics. Full `typecheck:node` was not repeated because the documented 4/8 GB baseline attempts OOM without diagnostics. |
| Web typecheck | baseline failure, no Cowork regression | `yarn typecheck:web` reproduced 89 existing diagnostics; 0 diagnostic paths were under `src/cowork` or `src/renderer/cowork*`. |
| CLI build/help/auth | pass | `yarn workspace @micromeet/cli check:help` and `check:auth` both exited 0. |
| Patch hygiene | pass | `git diff --check` exited 0. Generated `packages/micromeet-cli/dist` and `out` remain ignored; no staged CLI binary was left behind. |
| Signed/package runtime | not run | Signing/installers and cross-platform native package execution remain manual/package gates. Static review found the blocking CLI payload issues above. |

## Conclusion

**blocked** — source parity, entry wiring, isolation, security primitives, compilation, and CLI
interoperability are substantially in place, but lifecycle teardown can leave active Cowork work or
stale auth behind, and current package paths do not safely deliver the CLI on every advertised
platform. Resolve all four P2 findings before marking `cowork-subapp-001` deliverable.
