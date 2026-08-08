---
id: onlypreview-menubar-003-2
status: blocked
reviewed_task: onlypreview-menubar-003
target: 0f230dec8169a69e0397768552dea87ec96a0486
base: 57f5a6cf6a63af5f7a649c856fd7755aea952eeb
date: 2026-08-08
review_type: independent-contract-regression
---

# Verdict

**BLOCKED. The Round 1 documentation P2 is closed, but Ral's real runtime screenshot exposes a new
P2 blocking native-chrome failure. The existing P3 non-blocking hover-test reliability finding also
remains. No P1 finding was identified.**

# Findings

- P1 blocking: none.
- P2 blocking: the real OnlyPreview window still renders a complete native macOS titlebar above the
  32px Royal Blue custom MenuBar. The screenshot shows traffic lights and a centered native
  `OnlyPreview` title in the upper dark bar, then the custom OnlyPreview identity/actions in a second
  bar below it. This directly violates the task objective to replace the default native titlebar
  treatment and the feature contract's one-bar composition
  (`docs/plan/tasks/onlypreview-menubar-003.md:9-13`;
  `docs/features/onlypreview.md:44-59,328-339`). The constructor declares
  `titleBarStyle: 'hidden'` and a traffic-light position
  (`src/main/windows/onlyPreviewWindow.helper.ts:350-364`), but the observed runtime proves that
  declaration is not producing the required effect for this `BaseWindow`. Treat the actual window,
  not the source option or source guard, as authoritative. Ral's evidence is
  `/var/folders/wy/7d_0dtns4lxc3g7r2l1z1jl80000gn/T/codex-clipboard-c8b87992-5ce6-40a7-9884-e2b5728f7df1.png`.
- P3 non-blocking: the Round 1 hover acceptance still sends only one synthetic `mouseMove` before
  polling computed style (`tests/onlypreview/specs/onlyPreview.spec.ts:466-484`). It failed once in
  the original independent run, then passed both its focused rerun and a complete 3/3 rerun. This
  remains a test-injection reliability concern, not a product behavior or delivery blocker; retain
  it in the delivery backlog.

# Round 1 Resolution

The Round 1 P2 documentation-contract finding is closed. The normative feature interface now lists
all three capability-scoped window commands immediately after `updatePreviewBounds`:

```ts
minimizeWindow(params: HostRequest): Promise<OnlyPreviewResult<void>>;
toggleMaximizeWindow(params: HostRequest): Promise<OnlyPreviewResult<void>>;
closeWindow(params: HostRequest): Promise<OnlyPreviewResult<void>>;
```

Those signatures match the shared contract's `OnlyPreviewHostRequest` plus
`OnlyPreviewResult<void>` forms (`docs/features/onlypreview.md:145-162`;
`src/shared/onlypreview/onlyPreview.types.ts:149-154`). Their names and result types also match the
typed XPC handler methods (`src/main/xpc/onlyPreview.handler.ts:141-171`). Main routes each command
to `requireStandaloneWindow`, which first requires a live content host and exact equality with the
currently active standalone host before resolving the singleton `BaseWindow`
(`src/main/windows/onlyPreviewWindow.helper.ts:192-207,330-348`).

The corrected interface is now consistent with the later feature rule that Shell uses
capability-scoped typed XPC requests while Preview never owns window chrome
(`docs/features/onlypreview.md:328-339`) and with the task's active-window constraint
(`docs/plan/tasks/onlypreview-menubar-003.md:54-56`). No API method, handler, helper, renderer, test,
or configuration change was needed for the resolution.

# New Runtime Blocker Evidence

`view_image` inspection of Ral's 3430×156 real-running-window crop shows two vertically stacked
chrome regions:

1. a native dark titlebar with macOS traffic lights and centered `OnlyPreview` title;
2. the Royal Blue Shell MenuBar with a second OnlyPreview identity and its file actions.

The expected EyesOnAgents effect has only the second region, with the native traffic lights inset
into it. The double titlebar consumes additional vertical space and visibly duplicates application
identity, so this is not a cosmetic variance or stale documentation. It is the central user-visible
outcome of the task failing in the owner's runtime.

Round 1's Electron assertions check the configured traffic-light position and renderer MenuBar
geometry, but they never assert that the operating system's native titlebar region is absent. The
saved desktop-capture screenshots therefore provided insufficient evidence for that native-frame
requirement. A fix needs a real-window acceptance that fails whenever the native title/titlebar is
still stacked above the Shell MenuBar; this review does not prescribe or implement the source fix.

# Regression Scope

- Fix commit `0f230de` changes exactly one file, `docs/features/onlypreview.md`, by adding the three
  missing interface lines. It does not modify implementation, tests, task status, dependencies, or
  package metadata.
- Round 1's unaffected source/runtime/visual evidence remains applicable: 32px Royal Blue Shell
  MenuBar, drag/no-drag and double-click behavior, active-host capability checks,
  separate Shell + Preview views, exact Preview/status bounds, standalone-only Omni exclusion,
  unchanged Settings, i18n/accessibility/BEM, successful build, final 3/3 Electron acceptance, and
  inspected 1180×760 plus 800×600 content captures. Those captures do not override the new real
  native-frame evidence.
- The pre-existing `package.json` working-tree diff remains outside both task commits. Its diff
  SHA-256 is still exactly
  `3d1803a21e22dd01c928cd459520d6c0dc0a6b8c769571b505960d0bc032b5cd`.

# Verification

- `node --test tests/onlypreview/*.test.mjs` — pass, 29/29.
- `git diff --check 57f5a6c..0f230de` — pass.
- `git diff --check ab1b89b..0f230de` — pass.
- Current `git diff --check` — pass.
- `view_image` inspection of Ral's real runtime screenshot — failed the single-titlebar contract;
  the native titlebar remains visibly stacked above the custom MenuBar.
- Fix commit scope, feature/shared/handler/helper signature agreement, later window-contract
  agreement, unchanged Round 1 review, and preserved package diff hash — independently inspected.
- Round 1 evidence retained without rerunning unaffected gates: `yarn typecheck:node`, renderer i18n,
  targeted ESLint, build, final OnlyPreview E2E 3/3, and both required screenshot inspections passed.
