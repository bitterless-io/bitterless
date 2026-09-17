# Review: Zellij selection contrast 001

Date: 2026-09-16. Independent verifier; did not implement the source or tests.

Contract: [issue](../../issues/zellij-selection-contrast.md) and
[task](../tasks/zellij-selection-contrast-001.md). Reviewed the current-worktree selection delta
in `src/main/zellij/zellijDefaultConfig.constant.ts` and the two configuration test files.

## Findings and result

No P1/P2/P3 findings in the selection scope. **PASS**; no blocking findings.

## Evidence

- Compared every semantic style against pinned Zellij 0.45.1's
  [legacy conversion](https://github.com/zellij-org/zellij/blob/v0.45.1/zellij-utils/src/data.rs#L1646-L1771).
  All 13 style declarations and ten multiplayer colors retain their resolved values except
  `text_selected.base` / `background`. Indexed color `0` remains indexed, and omitted
  `frame_unselected` remains `None`. The selected list/table styles are unchanged.
- The native selection is `#15161e` text on `#7aa2f7`; supported web keys explicitly set the
  same pair and inactive background `#6686c2`. Original foreground, background, cursor and
  sixteen ANSI colors remain unchanged. Native grid and web fallback use those exact fields
  ([native](https://github.com/zellij-org/zellij/blob/v0.45.1/zellij-server/src/panes/grid.rs#L2013-L2026),
  [web](https://github.com/zellij-org/zellij/blob/v0.45.1/zellij-client/src/web_client/control_message.rs#L163-L170)).
- Version `260916230933` uses the existing validated full-template replacement and private
  backup. Same-version explicit native/web colors survive; missing defaults are completed.
  Failure and concurrent-edit tests preserve the previous file/marker. Runtime, copy handling
  and session lifecycle code are unchanged by this repair.
- Normalized Bitterless/Cowork constants are byte-identical except product naming. Outside
  theme, three web selection keys, template version and explanatory comments, executable
  constant content matches HEAD. Earlier login-PATH and unrelated package changes were retained.

## Verification

- Independently ran `yarn node --test tests/zellij/zellijDefaultConfig.test.mjs
  tests/zellij/zellijConfigDefaults.test.mjs`: **23/23 pass, zero skips** in each client.
  This exercised real staged Zellij **0.45.1** `setup --check` for all platform defaults and
  isolated fresh/upgrade candidates, complete legacy mapping, contrast, backup and custom-color
  behavior. `setup --dump-config` was not used as evidence of resolved configuration.
- Inspected the actual before/after image and provenance under workspace-local
  `output/zellij-selection-contrast/`. The renderer used an isolated native session and real
  mouse drag; browser active/inactive cases use xterm selection. Measured region/text contrast
  is **6.79/7.16** active and **4.68/4.94** inactive. The image clearly distinguishes the selected
  region and retains ordinary ANSI output. This renderer run was performed by the separate
  rendering agent; the verifier inspected its image and measurements.
- Inspected parent full-suite log `tmp/zellij-selection-contrast/bitterless-suite.log`:
  **195/195 pass, zero skips**. Developer reports scoped strict TypeScript and lint passed.

## Limits

No installed or packaged Electron client, Electron E2E, real user configuration or user
sessions were used for this review. The rendered fixture uses production Bitterless native/web
services with disposable configuration and a readable fixture font size; it is not a packaged
client screenshot. Cowork equivalence is established by source parity and its focused tests,
not a second installed-client screenshot. Live installed upgrades were not tested.
