---
id: onlypreview-menubar-003-3
status: pass
reviewed_task: onlypreview-menubar-003
target: 168528f3dc481899c2c7d944665a80fc75a829e1
base: 57f5a6cf6a63af5f7a649c856fd7755aea952eeb
date: 2026-08-08
review_type: independent-fresh-main-native-runtime
---

# Verdict

**PASS. The Round 1 documentation P2 and Round 2 native-chrome P2 are both closed. No P1 or P2
finding remains. The historical synthetic-hover P3 remains non-blocking for backlog follow-up.**

# Findings

- P1 blocking: none.
- P2 blocking: none.
- P3 non-blocking: the hover acceptance still sends one synthetic `mouseMove` before polling its
  computed style (`tests/onlypreview/specs/onlyPreview.spec.ts:528-546`). It failed once during
  Round 1, then passed its focused rerun, the second Round 1 full run, the pre-hardening Round 3
  run, and the final `168528f` run. This is a test-injection reliability concern rather than a
  current product failure; retain it in the delivery backlog.

# Round 2 Evidence Reconciliation

Round 2 correctly reported what Ral's first screenshot showed, but that screenshot represented a
hybrid stale runtime rather than a freshly created window using the reviewed Main code:

1. the old development Main process, PID 91334, started at 19:02:08;
2. `src/main/windows/onlyPreviewWindow.helper.ts` was modified later, at 19:21:03;
3. renderer HMR updated the visible Shell MenuBar inside the already-created window, but it could
   not replay constructor-only `BaseWindow` options such as `titleBarStyle` and
   `trafficLightPosition` (`src/main/windows/onlyPreviewWindow.helper.ts:350-364`);
4. the 19:36:01 screenshot therefore combined the new renderer MenuBar with the old Main-created
   native frame, producing the apparent two-titlebar failure.

This closes the Round 2 blocker by correcting the runtime evidence, not by claiming a later source
fix. No implementation source change followed `57f5a6c`: `0f230de` only completed the feature
document's API block, and `168528f` only hardens two verification documents plus the Electron E2E
spec. The Round 2 review remains unchanged as the historical record of the evidence available then.

# Fresh Main Native Acceptance

Ral fully restarted Bitterless. Process inspection confirms the current Main PID 1708 started at
19:38:26, after the 19:21:03 helper change. Its sandboxed OnlyPreview Shell and Preview renderer
processes were both newly created at 19:38:31 under that Main, so this window graph cannot be the
pre-change BaseWindow from PID 91334.

The Main-owned CGWindow 29632 was then captured with native `/usr/sbin/screencapture` to
`/tmp/onlypreview-live-after-restart.png` at 19:40:47. Independent `view_image` inspection of the
full 3414×2830 image confirms:

- exactly one top chrome region, the 32px Royal Blue Shell MenuBar;
- macOS traffic lights inset into the left side of that same region;
- one OnlyPreview identity in the custom MenuBar;
- no separate dark native titlebar and no centered native `OnlyPreview` title row;
- Shell/project, Preview, and status regions remain intact below the MenuBar.

That is the observable EyesOnAgents window effect required by the task and feature contract
(`docs/plan/tasks/onlypreview-menubar-003.md:9-13,50-60`;
`docs/features/onlypreview.md:44-59,328-350`). The fresh native screenshot is decisive for the
creation-time frame behavior that renderer HMR and an old live window could not validate.

# Fresh Native Chrome Regression Guard

Commit `168528f` turns the fresh-Main lesson into an explicit acceptance contract
(`docs/features/onlypreview.md:419-426`; `docs/plan/tasks/onlypreview-menubar-003.md:61-73`) and an
Electron regression guard (`tests/onlypreview/specs/onlyPreview.spec.ts:132-226,291-341,547-564,728-741`):

- the test compares `BaseWindow.getBounds()` with `getContentBounds()` and strictly requires
  `{ originX: 0, originY: 0, width: 0, height: 0 }`; a native titlebar cannot be hidden by rounding
  or a one-axis-only assertion;
- screenshots come from the Main-owned native window through `getMediaSourceId()` and
  `desktopCapturer`, with macOS `/usr/sbin/screencapture -l` fallback. The guard never uses a
  renderer-only `capturePage`, so it includes native frame chrome;
- the sample covers x=55%-65% and logical y=6-26 in both normal and 800x600 native captures. The
  central horizontal band avoids traffic lights and right-side action controls; its broad 20px-high
  area plus a 75% majority threshold prevents isolated text or icons from satisfying the guard;
- a pixel matches only Royal Blue `#4E5882` within RGB +/-12. An explicit deep-gray negative check
  proves the historical native titlebar color cannot pass this matcher;
- refreshed native captures measured 2360/2360 matching pixels at 1180x760 and 1600/1600 at
  800x600 (100% for both), comfortably above the required 75%.

Independent `view_image` inspection of the refreshed
`out/playwright/onlypreview/screenshots/onlypreview-normal.png` and
`out/playwright/onlypreview/screenshots/onlypreview-800x600.png` agrees with the automated evidence:
both show one integrated Royal Blue MenuBar, inset traffic lights, and no centered native title row.

# Remaining Contract Assessment

- Round 1's implementation acceptance remains valid for the 32px Royal Blue MenuBar, compact 27px
  controls, drag/no-drag regions, non-action double-click behavior, Windows controls, localized
  labels, accessibility/focus/BEM, active-host capability checks, separate Shell + Preview views,
  exact 32px Preview and 25px status bounds, standalone-only Omni exclusion, and unchanged Settings.
- Round 1's normative API documentation gap is closed by `0f230de`: the feature interface now lists
  `minimizeWindow`, `toggleMaximizeWindow`, and `closeWindow` with the same host request and
  `OnlyPreviewResult<void>` contract as shared types, handler, helper, and the later window-control
  prose (`docs/features/onlypreview.md:142-174,328-339`).
- `168528f` changes exactly `docs/features/onlypreview.md`,
  `docs/plan/tasks/onlypreview-menubar-003.md`, and
  `tests/onlypreview/specs/onlyPreview.spec.ts`; it adds no dependency and changes neither product
  implementation nor `package.json`.
- The pre-existing `package.json` working-tree diff remains outside the task commits. Its diff
  SHA-256 is still exactly
  `3d1803a21e22dd01c928cd459520d6c0dc0a6b8c769571b505960d0bc032b5cd`.

# Verification

- Native fresh-Main screenshot `/tmp/onlypreview-live-after-restart.png` — pass by `view_image`;
  3414×2830 full-window evidence has one integrated MenuBar and no native title row.
- Current-process audit — pass: Main PID 1708 started 19:38:26; OnlyPreview Shell/Preview processes
  started 19:38:31; helper source modification time is 19:21:03.
- Final `yarn test:e2e:onlypreview` at `168528f` — pass, 3/3 on the first run, including strict
  zero-gap native bounds, both native Royal Blue samples, two secure views, immutable previews, and
  isolated Settings.
- Final `node --test tests/onlypreview/*.test.mjs` at `168528f` — pass, 29/29.
- Final `yarn eslint --quiet tests/onlypreview/specs/onlyPreview.spec.ts` — pass.
- Round 1 unaffected gates remain applicable: `yarn typecheck:node`, renderer i18n, targeted ESLint,
  and `yarn build` passed; later commits contain only documentation and E2E-test changes.
- `git diff --check 0f230de..168528f`, `git diff --check ab1b89b..168528f`, and current
  `git diff --check` — pass.
- Independent native-pixel audit — pass: normal 2360/2360 (100%); 800x600 1600/1600 (100%).
- Commit scope, all three reviews, source/package timestamps, current process ancestry, screenshot
  metadata, API agreement, and package diff hash — independently inspected.
