---
id: omni-active-cell-border-004-1
target: working-tree-2026-08-09-active-cell-border
compared_with: omni-active-cell-border-004
status: pass
---

# Verdict

**PASS. No P1, P2, or P3 blocking or non-blocking finding was identified.**

# Findings

None.

# Contract evidence

- Main retains `activeCellId` as `string | null` at `omniWindow.helper.ts:196`; the single
  `broadcastActiveCell` path updates that retained value and broadcasts the same nullable payload
  at lines 1090-1092.
- Browser chrome focus records its cell at `omniWindow.helper.ts:889-893`. The shared content
  lifecycle records focus at lines 1014-1023, so it covers both remote-browser and mini-app content
  views while ignoring replaced or destroyed views.
- Full Omni view cleanup clears the retained state and broadcasts `null` at
  `omniWindow.helper.ts:280-291`. The singleton Control receives an unconditional retained-state
  replay after its document loads (lines 425-431), whenever it becomes visible (lines 484-502),
  and through `replayControlState` itself (lines 727-733); a reused Control cannot keep a stale
  highlight.
- `layout.store.ts:50,164-166` stores the nullable active ID. Its event subscriber at lines
  201-208 accepts only a non-empty string or explicit `null`, rejects `undefined`, empty strings,
  and non-strings, and applies `null` so cleanup visibly clears the state.
- `OmniPane.vue:157-162` applies `omni-pane--active` only when the rendered node is a leaf and its
  ID exactly matches the retained active ID. Split/container nodes and unmatched or removed IDs
  therefore receive no active modifier.
- `OmniPane.less:1-19` establishes only a positioning context on the pane and draws the highlight
  with an absolutely positioned, inset-zero `::after` overlay. Its exact
  `2px solid oklch(0.68 0.2 250)` border is bright blue, `box-sizing: border-box` keeps it inside
  the pane, and `pointer-events: none` preserves interactions. No padding, width, height, splitter,
  or native-content bounds are changed.
- The focused lifecycle guard at `tests/omni/omniLayoutLifecycle.test.mjs:370-412` covers nullable
  retention/broadcast, both focus sources, cleanup, replay, store validation, leaf-only selection,
  and the non-layout-affecting 2px overlay. The rest of the same suite continues to cover structural
  layout behavior, the accepted compact split/close controls, Escape handling, and update actions.

# Verification

- `node --test tests/omni/omniLayoutLifecycle.test.mjs` — pass, 11/11 tests. Node emitted only the
  existing package-module-type performance warning.
- `yarn eslint src/renderer/omni/omniControl/src/components/OmniPane.vue src/renderer/omni/omniControl/src/store/layout.store.ts`
  — pass with exit 0 and 0 errors. It reported 32 Prettier warnings; direct HEAD-source audits show
  30 warnings already existed in these files. The active subscriber adds one same-style,
  non-blocking single-line-return warning; the remaining new warning belongs to the concurrent
  Trench work and is outside this task.
- Scoped `git diff --check` for the feature contract, Main helper, Control store/pane/Less, and
  focused lifecycle test — pass.
- Full Web typecheck was not rerun, per the requested verification scope; the developer's reported
  diagnostics were unrelated baseline failures and the focused test plus targeted ESLint expose no
  task-related diagnostic.

