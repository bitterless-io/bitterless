# Review: trench-todo-menubar-parity-016

## Findings

- **P1 · blocking:** None.
- **P2 · blocking:** None.
- **P3 · non-blocking:** None.

## Contract evidence

- `TrenchHeader.less:1-23` matches Todo's shell contract at
  `src/renderer/todo/src/components/MenuBar/MenuBar.less:1-25`: 32px fixed height, `#4e5882`
  background, `#3d4666` divider, 12px horizontal padding, 78px standalone macOS left clearance,
  native drag in standalone, and no-drag in Omni.
- `TrenchHeader.vue:10-55` now has the same one-title/one-action-group hierarchy as Todo. The former
  `BL` badge and subtitle are absent. The right group preserves the live status plus the stable
  `trench__header__agent-guide` and `trench__header__refresh` actions.
- `TrenchHeader.less:25-40,67-84` matches Todo's 13px semibold near-white title, 8px action gap,
  28px Arco buttons, 16px Tabler icons, near-white foreground, and Royal Blue hover treatment.
- `TrenchHeader.vue:12-21,72-81` retains distinct local/loading/refreshing/unavailable status
  semantics. `TrenchHeader.less:86-93` hides only the status label below 560px; the dot and both
  required actions remain present. Refresh keeps loading/disabled fencing and both icon actions keep
  localized title, tooltip, and accessible label.
- `src/renderer/coin/src/App.less:71-75` no longer applies a short-height header override, so the
  32px contract remains invariant while only the module row compacts.
- `tests/omni/trenchOmniEmbedding.test.mjs:103-161` statically guards the exact shell tokens, host
  modifiers, simplified identity, icon actions, narrow-label behavior, and absence of a height
  override.

## Visual and responsive evidence

- Fresh standalone captures at 1360×860 and 800×600 show a 32px Royal Blue top bar with the title
  aligned after the 78px macOS traffic-light clearance and the status, Agent, and Refresh controls
  aligned at the right edge. No action is clipped or overlapped.
- Fresh Omni captures at 800×568 and 800×282 show the same 32px background, baseline, padding, and
  action spacing with 12px left clearance and no host-specific height drift.
- The fresh 398×568 Omni capture shows the intended constrained state: status text yields, the green
  live-status dot remains, and Agent plus Refresh stay fully visible. The visible Agent focus ring
  also confirms keyboard focus treatment does not clip at the top or right edge.
- Original-resolution files inspected:
  - `/tmp/bitterless-menubar-e2e.ErSD8h/out/playwright/coin/screenshots/trench-structured-1360x860.png`
    (2720×1720 physical pixels)
  - `/tmp/bitterless-menubar-e2e.ErSD8h/out/playwright/coin/screenshots/trench-structured-800x600.png`
    (1600×1200)
  - `/tmp/bitterless-menubar-e2e.ErSD8h/out/playwright/coin/screenshots/trench-structured-omni-800x568.png`
    (1600×1136)
  - `/tmp/bitterless-menubar-e2e.ErSD8h/out/playwright/coin/screenshots/trench-structured-omni-398x568.png`
    (796×1136)
  - `/tmp/bitterless-menubar-e2e.ErSD8h/out/playwright/coin/screenshots/trench-structured-omni-800x282.png`
    (1600×564)
- The design brief explicitly requires Todo parity, so exact reuse of Todo's shell tokens is the
  deliberate direction rather than a new ornamental identity. The retained live-status dot is the
  single Trench-specific signature; the rest stays quiet and structurally consistent.

## Verification evidence

- PASS: `yarn vue-tsc --noEmit -p tests/coin/tsconfig.trench-renderer.json --composite false`.
- PASS: `node --test tests/omni/trenchOmniEmbedding.test.mjs` — 6/6 after a fresh build. The initial
  pre-build run passed the five source-contract cases and failed only the expected stale-output
  timestamp assertion.
- PASS: `git diff --check`.
- PASS: fresh shared-tree debug build using
  `VITE_ENV=prod VITE_MODE=debug yarn _build:debug`; it retained the selected `debug_prod` profile
  and `Bitterless_DEBUG_PROD` package identity.
- PASS: fresh canonical `yarn build` in isolated copy `/tmp/bitterless-menubar-e2e.ErSD8h`, emitting
  the required `debug_dev` marker without mutating the shared profile or package.
- PASS: focused Electron Playwright standalone and Omni specs in that isolated build:
  `VITE_ENV=dev VITE_MODE=debug yarn _test:e2e:coin --project electron --grep 'renders the secure
  read-only Trench vault|embeds live sandboxed Trench cells'` — 2/2.
- The first direct Playwright attempt in the shared tree was stopped before Electron launch by its
  intentional `debug_dev` marker gate. This was a verification-environment mismatch, not a product
  failure, and the unchanged specs subsequently passed against the isolated canonical build.
- The user's `Bitterless_DEBUG_PROD` process remained running after verification. No app process was
  stopped or restarted.

No Keychain, credential store, Ops secret, or secret-bearing file was read during verification.
The runtime acceptance was performed on macOS; no Windows runtime claim is made.

## Conclusion

**pass** — no P1, P2, or P3 finding. Trench now matches Todo's menu-bar height, Royal Blue shell,
padding, title/action layout, icon treatment, hover behavior, and host semantics while preserving
truthful status and reachable Agent/Refresh actions across wide, narrow, and short Omni layouts.
