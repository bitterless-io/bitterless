---
id: onlypreview-omni-embedding-026
scope: Open the Preview (OnlyPreview) sub-app inside an Omni cell
status: pending; deferred by owner 2026-08-21 — do not implement yet
depends-on: [onlypreview-design-completion-025, omni-miniapp-cells-001]
---

# Open Preview inside Omni

## Owner decision

Recorded on 2026-08-21 at the owner's request: Omni must eventually be able to open the Preview
(OnlyPreview) sub-application in a cell. The owner explicitly deferred the work — this task records
the intent only. No source change, feature-contract amendment, or test work starts from it until the
owner says so.

## Objective

Make `onlypreview` a selectable, fully operational Omni mini app in a cell, following the precedent
of [`trench-omni-embedding-012`](trench-omni-embedding-012.md) (fifth mini app) and
[`submodules-omni-embedding-001`](submodules-omni-embedding-001.md) (sixth mini app), as the seventh
bounded `OmniMiniAppId`.

## Blocking contract conflict

This request reverses a delivered decision. The current contracts forbid exactly what it asks for,
so the feature docs must be amended — or this task rejected — before any code is written:

- [`../../features/onlypreview.md`](../../features/onlypreview.md) *Standalone-only boundary*:
  "OnlyPreview is not an Omni mini app… Omni must not list `onlypreview`, accept it in persisted
  cell state, map it to a runtime target, or load an OnlyPreview preload. There is no embedded DOM
  Preview adapter or container mode."
- Same doc, *Home Integration And Omni Exclusion*: Omni's allowlist, persisted cell contract,
  runtime mapping, Control selection, renderer preload map, and cell lifecycle "must exclude
  `onlypreview`", and a persisted `miniAppId: 'onlypreview'` leaf is unsupported input.
- [`../../features/omni-miniapp-cells.md`](../../features/omni-miniapp-cells.md) *Persisted Content
  Contract* rule 6: "A historical or test-only `miniAppId: 'onlypreview'` value is therefore
  rejected as unsupported."
- [`onlypreview-standalone-only-002`](onlypreview-standalone-only-002.md) (done) removed OnlyPreview
  from Omni on purpose after [`onlypreview-mvp-001`](onlypreview-mvp-001.md) had embedded it, and
  `tests/onlypreview` plus focused Omni tests assert `parseOmniMiniAppId('onlypreview')` throws.

The two feature docs and this task cannot both stand as written.

## Open questions for the owner

1. **Embedded view shape.** OnlyPreview's usable surface is a native `BaseWindow` graph with one
   Shell view plus one mutually exclusive Preview Region content view (raw Chromium/PDF or the Vue
   Preview renderer), while an Omni leaf hosts one operation `WebContentsView`. Does the embedded
   form (a) collapse Shell and Preview into a single renderer, (b) nest child views inside the cell,
   or (c) embed a preview-only surface driven by a path chosen elsewhere?
2. **Coexistence.** Keep the standalone window and Home card alongside the cell (Trench precedent),
   or make the cell the primary surface?
3. **Runtime security.** Target the Trench-style sandboxed mini-app runtime, or the non-sandboxed
   Submodules runtime? The read-only file capability, path containment, and result-envelope
   contracts must survive either way.
4. **Standalone-only affordances.** Which of MenuBar, Settings window, Guide window, Find Bar,
   per-view DevTools, drag region, and traffic-light padding are host-gated off in a cell?

## Scope sketch (non-binding until the questions above are answered)

- `onlypreview` added to the shared ID list, display URL, Main runtime map, Control selector, i18n
  label, icon, persisted layout round trip, packaged asset audit, and navigation fence.
- OnlyPreview preload/renderer regain a host mode (`standalone` | `omni`) and gate every
  standalone-window affordance on the non-Omni host.
- Feature contracts amended in `onlypreview.md` and `omni-miniapp-cells.md`, including the
  fail-closed recovery rule that currently rejects the ID.

## Path (expected)

- `src/shared/omni/omni.types.ts`
- `src/shared/onlypreview/onlyPreview.types.ts`
- `src/main/windows/omniMiniAppRuntime.service.ts`
- `src/renderer/omni/omniControl/src/components/OmniPane.vue`
- `src/preload/onlypreview/**`
- `src/renderer/onlypreview/**`
- `docs/features/onlypreview.md`
- `docs/features/omni-miniapp-cells.md`
- `tests/omni/**`, `tests/onlypreview/**`

## Verification

Deferred with the task; to be fixed when it starts. Baseline expectation, mirroring
`submodules-omni-embedding-001`: Omni parser/runtime/round-trip tests updated from six to seven mini
apps with `parseOmniMiniAppId('onlypreview')` accepted, OnlyPreview tests updated where they assert
the exclusion, host-gated renderer affordances covered, `yarn typecheck`,
`yarn check:renderer-i18n`, focused error-level ESLint, and `yarn build`. Electron E2E only if the
owner asks for it in that session.
