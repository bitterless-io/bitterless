---
id: miniapp-entry-visibility-001-1
status: pass
reviewed_task: miniapp-entry-visibility-001
date: 2026-07-22
review_type: independent-static
---

# Verdict

**PASS. No P1, P2, or P3 finding remains.**

# Findings

- P1 blocking: none.
- P2 blocking: none.
- P3 non-blocking: none.

# Accepted Evidence

- The active `createMiniApps()` array still contains Todo, EyesOnAgents, and Omni Browser, including
  their original callbacks. The Maestro and Coin card objects are inside block comments, so Vue's
  `v-for` cannot render either card and `openApp()` cannot receive either dormant action from this
  collection (`src/renderer/home/src/views/miniApp/miniApps.constant.ts:24`, `:32`, `:42`, `:52`,
  `:59`; `src/renderer/home/src/views/miniApp/MiniApp.vue:2`, `:69`, `:86`).
- Hiding is limited to the Home collection. The Home component still imports both XPC emitters,
  defines active `openMaestro()` / `openCoin()` callbacks, and passes them into `createMiniApps()`
  (`src/renderer/home/src/views/miniApp/MiniApp.vue:44`, `:45`, `:61`, `:65`, `:86`). The factory
  signature and icon imports are also retained, making restoration a small source edit
  (`src/renderer/home/src/views/miniApp/miniApps.constant.ts:1`, `:16`).
- No Maestro/Coin runtime, lifecycle, preload, renderer, packaging, or persistence implementation
  file is changed by this task. Current wiring remains registered through the main XPC helper and
  both window handlers; Electron Vite still includes the Coin renderer, four Maestro renderers, and
  Maestro preloads; Electron Builder still packages `maestro-tools`
  (`src/main/xpc/xpc.helper.ts:15`, `src/main/xpc/maestroWindow.handler.ts:58`,
  `src/main/xpc/coinWindow.handler.ts:25`, `electron.vite.config.ts:151`, `:189`,
  `electron-builder.yml:40`).
- The feature docs now consistently describe dormant Home entries while preserving runtime,
  lifecycle, resources, and persisted state (`docs/features/README.md:10`,
  `docs/features/maestro.md:9`, `:64`, `docs/features/coin.md:7`, `:49`).
- The new comment stripping uses the TypeScript scanner and removes only single-line and multiline
  comment trivia before checking the active Mini Apps source
  (`scripts/maestro/check-embedded-host.mjs:10`, `:40`, `:71`). A focused in-memory fixture proved
  that commented Maestro/Coin markers are absent after stripping while an active Maestro object is
  still detected. Against the real file it reported both dormant entries absent, all three retained
  entries present, and both dormant source blocks still available for restoration.

# Checks

- Focused TypeScript-scanner visibility fixture — PASS: comments are ignored, an active marker is
  detected, Maestro/Coin are absent from the real active collection, and Todo/EyesOnAgents/Omni
  Browser remain present.
- `git diff --check` — PASS.
- `yarn typecheck:web` — BLOCKED by existing out-of-scope diagnostics. None targets
  `miniApps.constant.ts`, `MiniApp.vue`, or the changed Maestro check. Reported files include
  Connector, existing Coin workspace, Poker tests, Home Chat/emitter types, Maestro bridges,
  Omni Window, EyesOnAgents, and path helpers; the task does not modify those implementations.
- `yarn check:maestro` — BLOCKED before reaching `check-embedded-host.mjs` by the existing Maestro
  alias-boundary gate. It reports committed, task-untouched imports in
  `src/main/maestro/windows/window.helper.ts` and Maestro renderer bootstrap files. The focused
  visibility assertions were therefore exercised independently in memory.

# Conclusion

Maestro and Coin are hidden only from the authenticated Home Mini Apps collection. Their active
Home-to-XPC callback wiring and integrated runtimes remain intact, while Todo, EyesOnAgents, and
Omni Browser are unchanged in the visible collection. The comment-aware visibility check behaves
correctly for both commented and active fixtures. The task passes independent static verification;
the two requested project-wide commands remain unavailable because of unrelated baseline failures.

# Verification Boundary

The shared worktree contains unrelated Translator/Omni work. This review did not modify or assess
that delivery beyond separating its diagnostics from this task. No Electron/UI/E2E session was
launched.
