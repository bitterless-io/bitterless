# Settings navigation and built-in menu/manual

Owner request: 2026-09-24. Status: BL implemented and code-verified; human app checks pending. Paired with Cowork on existing branches.

## Contract

- Rename the user-facing Agent Setting Workbench entry, tab chip and window heading to Settings (with existing localization conventions).
- Rename the existing Settings subtab to General and place it immediately before Capture. Preserve existing saved navigation/deep-link compatibility; internal Workbench identifiers can remain implementation details. General may retain the existing `settings` pane ID to avoid breaking IPC consumers.
- Existing navigation, settings contents, terminal-settings links and remembered tabs keep working.
- Add discoverable built-in `menu` skill in both apps. `/menu` or natural-language requests can list the available Settings tabs or open a named tab for human viewing. Use native host navigation, not browser automation. Accept only this product's supported tabs; invalid input must report allowed tabs without opening a different page. Navigation must work on first open and when Settings is already open/backgrounded.
- Add discoverable built-in `manual` skill in both apps, with separate product-local content. Explain the app's actual usage, Settings tabs and menu examples. BL describes Maestro and its BL-specific pages; Cowork describes its CRMS/customer workflow and Cowork-specific pages. Never suggest the sibling product's exclusive pages. Keep content source-local and easy to update, with no network, account mutation or external runtime dependency.
- Built-ins must be included in the live skill catalog and executable through registered host tools; no recorded-skill lookup is required. Tool discovery/UI metadata must match the actual registered capability.

## Layout

```text
Agent Setting → Settings
Settings
[General] [Capture] [Skills] ... existing product-specific tabs ...
```

## Verification / handoff

- Code-level tests cover catalog registration, menu valid/invalid input, the actual host navigation boundary and product-specific manual output. UI labels/order checked with existing focused checks or typecheck.
- Run proportionate type/build checks, preserve unrelated in-progress changes.
- No independent review or review agent. No Electron E2E or app launch. Ral manually checks Settings label/order and chat `/menu`, opening a specific tab from closed/backgrounded Settings, and `/manual` in both products.

## BL implementation and evidence (2026-09-24)

- `src/shared/maestro/settingsNavigation.ts` owns the renderer order and menu destinations: General, Capture, Skills, Workflows, Injections, Tools, Models, Apps, Connectors, About, Log. General retains pane ID `settings`; `/general` is an alias for `/settings`, and remembered pane IDs remain unchanged.
- English and Chinese labels, the Settings tab chip/tooltips, heading and HTML title use the new names. Existing visual styling and General contents are preserved.
- `src/main/agent/tools/settingsTools.ts` provides `menu({ tab? })` and `manual({ topic? })`; both have catalog metadata and built-in briefs in the normal and session skill guidance paths. Omitting a tab lists destinations without navigation; invalid input returns allowed tabs without opening a substitute.
- Native `openWorkbenchPane` retains the requested pane in the main process. The renderer consumes it on mount and on the request event, so navigation survives a missed first-load event. The home navigation uses this same path; old pane broadcasts and terminal settings behavior remain supported.
- `src/main/agent/settingsManual.ts` contains only Bitterless / Maestro instructions, including its personal apps. Cowork maintains its own bundled content.
- `node --test tests/maestro/settingsMenuManual.test.mjs`: **6/6 passed**. Covers list/order, named/aliased/invalid menu inputs, native first-open retention, reopening closed/backgrounded Settings, last-request behavior, reset cleanup, product-specific/manual-topic content, registered metadata and both built-in catalog paths, renderer consume wiring and legacy navigation compatibility.
- Main surface typecheck (`yarn exec -- tsc -p tsconfig.surface.settings_main.json`): **blocked by 59 diagnostics outside this change's edited lines**. Maestro renderer surface (`yarn exec -- vue-tsc -p tsconfig.surface.settings_maestro.json`): **blocked by 8 diagnostics** in the existing Omni emitter, About store and TabAliasApp. No diagnostics in the new navigation, tools/manual or edited Settings renderer modules. Captured output: `/tmp/bl-settings-main-check.log` and `/tmp/bl-settings-renderer-check.log`. Temporary surface configs were removed after the checks.
- Targeted `git diff --check`: passed. No build, independent review, Electron E2E or app launch performed; the focused tests and surface checks are the code-level handoff.

## Human handoff

- In BL, verify the Settings entry/chip/heading in English and Chinese, and General immediately left of Capture. Confirm remembered sections, `/settings`, `/general` and terminal settings links still work.
- In a new Maestro Chat, send `/menu`, `/menu general`, `/menu capture`, `/menu models`, then a nonexistent tab. Confirm only requested valid tabs open and invalid input lists allowed tabs. Repeat opening a tab while Settings is closed and while it is backgrounded, including the first opening after startup.
- Send `/manual` and `/manual capture`; confirm the help describes Bitterless / Maestro and its BL apps, and compare with Cowork's separate customer manual. Inspect Tools for menu/manual. These are manual UI/agent-runtime checks; code-level host acceptance does not prove the renderer reached its final visible state.
