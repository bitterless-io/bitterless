---
id: maestro-startup-chrome-005-1
status: approved
reviewed_task: maestro-startup-chrome-005
target: dev-next-working-tree-2026-08-25
date: 2026-08-25
review_type: independent-source-startup-lifecycle-and-window-chrome
---

# Independent Review — maestro-startup-chrome-005

## Verdict

**APPROVED.** The final source implementation suppresses Home's automatic reveal while preserving
an explicit Home route/failure fallback, serializes concurrent Maestro opens behind complete boot
readiness, adds a generation-scoped post-locale/post-mount fence, and matches the requested
Omni-derived geometry and colors. The three blocking findings from the first pass were fixed and no
P0-P2 source finding remains.

No tests, type checks, lint, builds, Electron, Playwright/E2E, AI-CRMS, or network operations were
run, as required by the task's source-only verification contract.

## Findings

No open P0-P2 findings.

## Resolved during re-review

1. **Resolved — current-generation full activation fallback.** `activateSession()` now encloses
   deactivation settlement, Core SQLite, EyesOnAgents, Maestro preparation, Coin preparation, and
   primary opening in one catch. It shows Home only if the captured generation remains current and
   rethrows the error (`src/main/xpc/auth.handler.ts:72-95`). `showPrimaryWindow()` applies the same
   current-generation fallback to Dock/tray/second-instance retries (`auth.handler.ts:102-115`).
2. **Resolved — Login explicitly selects Home.** The typed `AuthSessionApi` now exposes
   `showHomeWindow()` (`src/shared/auth/auth.type.ts:8-14`); Main implements it as a direct Home show
   independent of `sessionShouldBeActive` (`src/main/xpc/auth.handler.ts:98-100`), and Login invokes
   that method on mount (`src/renderer/home/src/views/login/Login.vue:159-162`). The logout ordering
   can therefore no longer refocus/reopen Maestro through Login's reveal request.
3. **Resolved — load-timeout disposal.** Both Core and Maestro SQLite window waiters own their timer,
   use one idempotent settle/cleanup path, remove all load/destruction listeners on every exit, and
   reject immediately if the webContents is already or becomes destroyed
   (`src/main/xpc/auth.handler.ts:27-65`; `src/main/xpc/maestroWindow.handler.ts:45-81`). The XPC/full
   readiness timeout helper also clears its timer in `finally` (`maestroWindow.handler.ts:20-33`).

## Passing source evidence

| Contract | Result | Evidence |
| --- | --- | --- |
| Valid startup suppresses the legacy Home reveal | **PASS** | Main Home overrides `showOnReady=false` (`src/main/windows/mainWindow.helper.ts:20-24`). A valid persisted-session guard restores the session before navigation and never mounts Login (`src/renderer/home/src/router/index.ts:10-35`), while no-token/invalid/transient-recovery states route to Login and invoke the explicit Home command (`router/index.ts:13-31`; `src/renderer/home/src/views/login/Login.vue:159-162`). |
| Maestro show-before-Home-hide ordering and failure fallback | **PASS** | `_showAuthenticatedPrimaryWindow()` awaits Maestro open, returns on a stale generation, and only then hides Home (`src/main/xpc/auth.handler.ts:168-175`). The complete activation catch exposes Home only for the still-current generation (`auth.handler.ts:72-95`); retry entry points apply the same rule (`auth.handler.ts:102-115`). |
| Concurrent open readiness | **PASS** | A caller encountering `bootPromise` awaits it before `show()`; an existing window is checked only after that boot gate (`src/main/xpc/maestroWindow.handler.ts:92-117`). This closes the prior path that could show a created-but-not-ready window. |
| Bounded Core/Maestro SQLite and full Maestro readiness | **PASS** | Core SQLite window load and Maestro SQLite window load each have self-cleaning 10-second bounds (`src/main/xpc/auth.handler.ts:27-65,160-166`; `src/main/xpc/maestroWindow.handler.ts:45-81,175-188`). Maestro preload readiness has a 10-second bound and complete Maestro readiness a 30-second bound (`maestroWindow.handler.ts:20-33,146-172,175-198`). Boot errors destroy the partial runtime and reject into the current-generation Home fallback. |
| Locale/mount/generation readiness fence | **PASS** | Each create issues a random token before renderer load; Main accepts only the live window's current token and invalidates it during shutdown (`src/main/maestro/windows/main/maestroWindow.controller.ts:296-325,339-348,1655-1666`). The Home renderer reads the URL token, awaits Main-owned language initialization, mounts Vue, awaits `nextTick`, then calls the typed readiness method (`src/renderer/maestro/home/src/main.ts:14-23`; `src/shared/maestro/coach.api.ts:6-21`; `src/main/maestro/xpc/coach.handler.ts:74-77`). |
| Exact Omni-derived chrome | **PASS** | The tab strip is 44px, address row 48px, root 92px, macOS gutter 78px, surface `#4e5882`, and divider `#3d4666` (`src/renderer/maestro/home/src/components/MenuBar/MenuBar.less:1-25,100-110`). Native traffic lights are `{ x: 12, y: 14 }` (`src/main/maestro/windows/window.helper.ts:58-65`). Idle/pinned controls use translucent white and active tabs remain white (`MenuBar.less:35-98`). |
| DOM-owned native bounds with 92px fallback | **PASS** | The first-frame fallback is 92px (`src/main/maestro/windows/main/maestroWindow.controller.ts:151-157,1541-1547`). Renderer placeholders still report their `getBoundingClientRect()` values through the existing typed call (`src/renderer/maestro/home/src/views/layout/Layout.vue:12-50`), and `setViewBounds()` remains the runtime owner (`maestroWindow.controller.ts:1555-1564`). |
| Scoped implementation and style | **PASS** | The source diff is limited to startup visibility/readiness, the typed readiness contract, and MenuBar geometry/colors. New standalone helpers use arrow-const style; class behavior remains method shorthand; XPC methods accept one typed object parameter. No unrelated package, persistence, network, tab, capture, or Workbench behavior was changed. |

## Source-only verification

| Check | Result |
| --- | --- |
| Full task-owned working-tree diff and referenced startup/layout sources | **REVIEWED** |
| `git diff --check` | **PASS** — no whitespace errors in the tracked diff; untracked issue/task/review docs also pass an explicit trailing-whitespace scan |
| Tests/typecheck/lint/build/Electron/Playwright/E2E/network | **NOT RUN — prohibited by task contract** |

## Remaining owner acceptance

Ral still owns the real-app checks:

- persisted valid-session relaunch first shows the complete Maestro window with no BitterLess/New
  Chat frame;
- signed-out, invalid-session, transient-recovery, activation-failure, and forced Maestro-timeout
  paths visibly recover to Home;
- logout does not refocus Maestro while transitioning to Login;
- on macOS, traffic lights are vertically centered in the 44px strip and the 44/48/92px chrome
  visually matches Omni Browser at normal and minimum window sizes.

## Conclusion

**APPROVED for source handoff.** Startup visibility ownership, current-generation fallback,
generation-ready fencing, timeout disposal, and the Omni-derived 44/48/92px chrome all satisfy the
task contract. Runtime first-frame and macOS visual acceptance remain with Ral.
