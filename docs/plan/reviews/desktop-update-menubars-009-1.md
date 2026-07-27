---
id: desktop-update-menubars-009-1
status: pass
reviewed_task: desktop-update-menubars-009
target: 931b81b
base: b5300cb
compared_with: desktop-update-menubars-009
date: 2026-07-27
review_type: independent-code-ui-and-contract
---

# Verdict

**PASS.** No P1, P2, or P3 finding remains. Commits `e80b756` and `931b81b` satisfy the compact
cross-window update-action contract and the strict top-level Omni ownership boundary.

# Findings

No open findings.

The first review found one blocking P3: Omni's new target-version tooltip was hard-coded in English.
Commit `931b81b` moved it to the shared English/Chinese renderer messages and added interpolation and
no-hardcoded-English guards. Re-review passed.

# Evidence

- The exact visible lowercase literal `upate` is shared by English and Chinese and consumed by Home,
  Maestro, and Omni. Maestro's label does not expand while downloading; disabled state and detailed
  title retain the state distinction.
- Omni renders exactly one ready-only action in the top-level `omniWindow` 32px Menu Bar, after the
  flexible title/Layout region and before Windows controls. The action is content-sized and no-drag.
- Omni calls the existing Home subscriber before language initialization and Vue mount, then uses
  Home's validated live-wins-snapshot state. It neither starts polling nor owns updater transport.
- The click path delegates to the existing Main `quitAndInstall` handler.
- Negative source guards cover all `omniCell` and Omni Control files, including
  `OmniPaneMenuBar`, so no pane or Layout subrenderer can render or subscribe to the action.
- Omni's detailed title uses shared `Update to {version}` / `更新到 {version}` messages while the
  visible label remains `upate`.

# Verification

| Check | Result |
|---|---|
| `yarn test:desktop-auto-update` | pass — 17/17 |
| `node --test tests/omni/omniLayoutLifecycle.test.mjs` | pass — 8/8 |
| `node scripts/maestro/check-update-ux.mjs` | pass |
| `yarn check:renderer-i18n` | pass |
| `yarn test:customer-auth` | pass — 14/14 |
| focused strict changed-renderer Vue/TypeScript | pass |
| scoped lint with existing JS explicit-return rule excluded | pass |
| `git diff --check b5300cb..931b81b` | pass |

The normal scoped lint command reports one unchanged `readProject` helper in a JavaScript check file
under `@typescript-eslint/explicit-function-return-type`; JavaScript cannot carry a TypeScript return
annotation, and the line predates this task. Full Web typecheck retains unrelated repository
diagnostics; focused strict checks cover all changed renderer modules.

# Boundary

Verification did not launch Electron, build, package, sign, notarize, publish, upload, refresh a CDN,
or access or mutate the remote update feed. Real-device placement, renderer recreation, and install
acceptance remain with Ral.
