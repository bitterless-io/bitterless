# Review: cowork-subapp-001 (round 2)

## Findings

- **P2 · blocking — Linux arm64 can be compiled and staged in isolation, but no Bitterless
  packaged-build path selects it.** The CLI package now defines both `bun-linux-arm64` and
  `bun-linux-x64`, and the staging adapter maps both `linux_arm` and `linux_x64`
  (`packages/micromeet-cli/scripts/package.cjs:9-24`;
  `scripts/prepare-cowork-cli.cjs:13-24`). However, the only root Linux distribution command
  unconditionally stages `linux_x64` and invokes Electron Builder with `--x64`
  (`package.json:28`). No root script pairs `linux_arm` with `electron-builder --linux --arm64`.
  `build:unpack` is host-architecture-aware, but it only produces a local `--dir` build and does
  not supply the missing arm64 Linux distribution path. Consequently the arm64 target added in
  this round is unreachable from the project's normal packaged-build scripts. **Minimal fix:** add
  `build:linux_arm64` that runs the existing build preparation, stages `linux_arm`, and invokes
  `electron-builder --linux --arm64`; retain/rename the present command as `build:linux_x64` and
  make `build:linux` an explicit alias if backward compatibility is needed.

## Resolved round-1 findings

- **Scheduler and agent teardown — resolved.** Scheduler shutdown first disables launches, awaits
  the active tick, then awaits every tracked run (`integrationScheduler.service.ts:35-69,72-125`).
  `BaseAgent` now tracks session creation, reset aborts, the managed prompt, one-shot runs, and
  one-shot sessions; `dispose()` aborts and drains each category
  (`BaseAgent.ts:84-101,174-207,236-310,312-387`). Cowork shutdown stops the scheduler and disposes
  the complete deduplicated agent set before capture/views are closed; the handler releases the
  proxy only after shutdown (`coworkWindow.helper.ts:6474-6516`;
  `coworkWindow.handler.ts:191-217`). Reopen clears and reconstructs the root/session agents,
  `piGen`, and `skillGenerator`, and reapplies the saved LLM target
  (`coworkWindow.helper.ts:6406-6471,6518-6550`).

- **Auth invalidation — resolved.** Invalidation is synchronously persisted before cleanup and the
  marker remains present on any cleanup failure (`coworkWindow.handler.ts:19-29,79-88,153-189`).
  Open, boot, and authenticated-session activation all pass through the invalidation gate
  (`coworkWindow.handler.ts:58-77,85-88,106-128`; `auth.handler.ts:16-19`). The auth bridge stops
  accepting events, serializes attach/detach transitions, tracks all accepted payload handlers,
  and drains them before clearing the attachment (`authBridge.ts:39-55,98-170,172-183`). Cleanup
  quiesces both before and after any in-flight boot, then boots the hidden SQLite preload, requires
  its explicit ready result, requires `{ ok: true }` from `CoworkSessionDao.clearSession()`, and
  requires successful CLI credential deletion before removing the marker
  (`coworkWindow.handler.ts:131-150,161-189`).

- **CLI payload hygiene — resolved.** Both generated locations are ignored; the CLI workspace is
  excluded from `app.asar`; only `build/cowork-tools` is copied as `extraResources`
  (`.gitignore:30-31`; `electron-builder.tmp.yml:5-35`).

- **Renderer readiness — resolved.** Cowork disables base-class auto-show, captures the Home,
  Control, Workbench, and operation load promises, and exposes their aggregate through
  `whenReady()` (`coworkWindow.helper.ts:679,797-826,848-907,923-954`). The host awaits that
  aggregate before showing the window (`coworkWindow.handler.ts:118-124`).

## Verification

| Check | Result | Evidence |
|---|---|---|
| Round-1 lifecycle findings | pass | Static control-flow review covered scheduler tick/run drain, every BaseAgent session category, shutdown ordering, proxy release, and close/reopen reconstruction. |
| BaseAgent focused disposal checks | pass | Independently bundled `BaseAgent` and exercised six mock-runtime cases: idle managed session, reset during pending creation, disposal during pending managed creation, active managed prompt, pending one-shot creation, and active one-shot prompt. All six drained and aborted as required. |
| Auth invalidation and bridge drain | pass (static) | Durable marker is written before cleanup and cleared only after strict hidden-session plus CLI clearing. Accepted bridge payloads are tracked and drained between serialized transitions; boot/open/activation gates recheck invalidation. Interactive invalidation remains a Task 002 E2E/manual gate. |
| CLI ignore / ASAR exclusion | pass | `git check-ignore -v` matched both `packages/micromeet-cli/release/...` and `build/cowork-tools/...`; builder `files` excludes the workspace and `extraResources` carries only the staged directory. No release/staging binary remained after verification. |
| Linux CLI target definitions | pass | Static matrix contains matching arm64/x64 Bun output names and staging names; `node scripts/prepare-cowork-cli.cjs --help` lists `linux_arm` and `linux_x64`. |
| Linux packaged build matrix | **fail / blocking** | Root scripts expose only the x64 pair. No command selects `linux_arm` together with Electron `--arm64`. Cross-platform signed/package execution was not run. |
| Renderer readiness | pass (static) | Home, Control, Workbench, and operation promises join the awaited aggregate, while `showOnReady` is false. Runtime window behavior remains Task 002 E2E. |
| Targeted Node typecheck | pass | TypeScript Compiler API checked the same 101 Cowork/host-adapter roots as round 1: 0 diagnostics. The known workspace-wide Node baseline was not used as a Cowork signal. |
| Production build | pass | `yarn build` exited 0; emitted `coworkHome`, `coworkControl`, `coworkWorkbench`, `coworkSqlite`, `coworkCoach.js`, `coworkSqlite.js`, and main. Only the four pre-existing host CSS warnings appeared. |
| CLI help/auth checks | pass | `yarn workspace @micromeet/cli check:help` and `check:auth` both exited 0. |
| Electron / dynamic import | pass | Manifest remains exactly Electron `40.10.6` with `Bitterless_DEV_DEBUG`; built main retains runtime `import("@earendil-works/pi-coding-agent")`. |
| Patch hygiene | pass | `git diff --check` exited 0. |

## Conclusion

**blocked** — round 1's scheduler/agent lifecycle, auth invalidation, payload hygiene, and renderer
readiness defects are fixed and independently verified. One P2 remains: wire the already-implemented
Linux arm64 CLI target into a matching Bitterless arm64 packaged-build command, then rerun the
packaging invariant check and review.
