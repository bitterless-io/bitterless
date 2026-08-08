---
id: onlypreview-shell-ux-005-2
status: pass
reviewed_task: onlypreview-shell-ux-005
target: 39c9b76424f96928b82fd0ac5e0ce322dad05ebc
base: 2cefb37e1f4ff1ff382553686ea4596b08da058f
date: 2026-08-08
review_type: independent-round2-finding-closure-node-electron-and-visual
---

# Verdict

**PASS — the Round 1 Settings work-area P2 is closed. No P1, P2, or P3 finding remains.**

Commit `39c9b76424f96928b82fd0ac5e0ce322dad05ebc` constrains restored Settings dimensions against the
display matching the currently authorized OnlyPreview parent before it centers or clamps position.
The focused pure cases, the real BrowserWindow integration path, the complete task regression suite,
and both required captures pass.

# Findings

- P1 blocking: none.
- P2 blocking: none.
- P3 non-blocking: none.

# Round 1 P2 Resolution

The new pure `resolveOnlyPreviewSettingsBounds` service first rounds each requested dimension and
constrains it to the interval between the app minimum and the current work-area dimension. It then
computes centering and position clamps from those already-constrained dimensions
(`src/main/onlypreview/onlyPreviewWindowBounds.service.ts:12-34`). The window helper obtains
`screen.getDisplayMatching(parentBounds).workArea` from the current parent and supplies the exact
`800×600` minimum (`src/main/windows/onlyPreviewWindow.helper.ts:147-161`).

The Round 1 reproduced case now resolves exactly as required:

- current work area: `(1920, 0)`, `1024×768`;
- current parent: `(1920, 34)`, `1000×700`;
- persisted Settings size: `1600×1000`;
- result: `(1920, 0)`, `1024×768`, with no right or bottom overflow.

That case is executed as a functional Node assertion, not merely a source-pattern check
(`tests/onlypreview/onlyPreviewCore.test.mjs:163-174`). The same test defines the unavoidable
sub-minimum case: a `640×480` work area yields the required minimum `800×600` at the work-area
origin, explicitly acknowledging that full containment cannot coexist with the BrowserWindow's
minimum in that environment (`tests/onlypreview/onlyPreviewCore.test.mjs:175-186`). A third case
proves ordinary parent-relative centering when the minimum-sized window fits
(`tests/onlypreview/onlyPreviewCore.test.mjs:187-197`).

Both Settings open paths use the corrected resolver: an already-live singleton is resized and
repositioned before show, while a newly created window passes restored width/height through it and
reapplies the calculation at `ready-to-show`. Persisted `x/y` remains ignored, the window stays
parented to the active standalone `BaseWindow`, and `windowStateService.show()` cannot reapply a
stale position (`src/main/windows/onlyPreviewWindow.helper.ts:273-317`).

Electron acceptance also traverses the production helper rather than calling only the pure
function. It persists a `900×650` Settings size, substitutes an `800×600` work area for the current
parent display, reopens Settings, and observes exactly `800×600`, the correct parent, centered and
clamped coordinates, and full work-area containment
(`tests/onlypreview/specs/onlyPreview.spec.ts:1485-1502,1566-1663`).

# Regression Contract Assessment

- The fix delta changes only the task evidence, one Main-only pure bounds service, its helper
  integration, and focused Node/runtime/Electron test wiring. It changes no renderer API, preload,
  native Menu command, file capability, association catalog, Omni source, dependency, or package
  configuration.
- The cumulative folder-first API remains exact: the visible picker and `Cmd/Ctrl+O` open a
  directory, while the separate Main-owned OS route still accepts an absolute file. Visible Open
  File, Refresh, item totals, and READ ONLY text remain absent; native refresh and Monaco read-only
  behavior remain intact.
- The current-file crosshair still clears search, expands ancestors, centers and focuses the row
  without a Main request or preview reload. The native file Menu is still owned by the active
  `BaseWindow`, and Preview/system-open/reveal callbacks re-resolve the capability-scoped relative
  file reference.
- Shell and Preview remain sibling `WebContentsView`s with their security preferences and explicit
  teardown. DevTools remains input-owner-specific, detached, non-repeating, and debug/unpackaged-E2E
  guarded. OnlyPreview remains excluded from Omni, and existing PDF/media behavior is unchanged.
- The refreshed 1180×760 and 800×600 captures preserve the integrated Royal Blue MenuBar, quiet
  Tabler crosshair, project tree, preview surface, and status rail without clipping or any removed
  chrome reappearing.

# Scope Audit

- `39c9b76424f96928b82fd0ac5e0ce322dad05ebc` is the direct child of the Round 1 target
  `2cefb37e1f4ff1ff382553686ea4596b08da058f`. It changes exactly six files: the task record, the new
  bounds service, its window-helper call site, the Node test/runtime bundle entry, and the Electron
  spec.
- No `package.json`, lockfile, dependency, packaging association, preload, renderer, Omni, feature
  contract, analysis, or Round 1 review change is present in the fix commit.
- The user-owned uncommitted `package.json` rename remains unchanged. Its diff SHA-256 is
  `3d1803a21e22dd01c928cd459520d6c0dc0a6b8c769571b505960d0bc032b5cd`.
- Before this Round 2 report, current status contained only `M package.json` and the untracked Round
  1 review `docs/plan/reviews/onlypreview-shell-ux-005-1.md`. Its SHA-256 remained
  `b20c46dee14e7c403771bee3a7c43a10a9e6df6eab06533fe1acd72aba652195`; neither was modified during
  verification.

# Verification

- `node --test tests/onlypreview/*.test.mjs` — pass, 32/32, including the exact `1024×768`,
  sub-`800×600`, and ordinary-centering Settings bounds cases.
- `yarn typecheck:node` — pass.
- `yarn check:renderer-i18n` — pass.
- `yarn eslint --no-cache --quiet` over the cumulative task's touched TS/Vue/MJS sources plus the
  new bounds service and runtime entry — pass.
- `yarn build` — pass; Main, the self-contained OnlyPreview preload, and all three OnlyPreview
  renderer entries are emitted.
- `yarn test:e2e:onlypreview` — pass, 5/5. The Settings test passes the simulated current-display
  shrink and containment assertions; folder-only chrome, locator, native Menu, independent detached
  DevTools, immutable text, selectable PDF, image, and seekable media regressions also pass.
- `view_image` inspection of
  `out/playwright/onlypreview/screenshots/onlypreview-normal.png` (1180×760) and
  `out/playwright/onlypreview/screenshots/onlypreview-800x600.png` (800×600) — pass.
- `yarn typecheck:web` — unchanged repository baseline failure only. Diagnostics remain confined to
  untouched connector, poker-test, Home, Maestro, Omni, eyes-on-agents, and shared path-helper
  sources; no OnlyPreview diagnostic is reported.
- `git diff --check 2cefb37e1f4ff1ff382553686ea4596b08da058f..39c9b76424f96928b82fd0ac5e0ce322dad05ebc`,
  cumulative `git diff --check 4fa92ff390b655bcf7e3e18bd603131fc3aa7da4..39c9b76424f96928b82fd0ac5e0ce322dad05ebc`,
  and current `git diff --check` — pass.

The build retains its existing mixed static/dynamic-import and empty-preload-chunk advisories. The
Electron runner retains its existing `NO_COLOR` / `FORCE_COLOR` warning. None is a task regression.

# Current Status

```text
 M package.json
?? docs/plan/reviews/onlypreview-shell-ux-005-1.md
?? docs/plan/reviews/onlypreview-shell-ux-005-2.md
```

No source, task, package, or Round 1 review file was modified by this review. No commit or push was
performed.

# Conclusion

**pass**
