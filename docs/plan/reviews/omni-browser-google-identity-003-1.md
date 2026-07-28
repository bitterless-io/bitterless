---
id: omni-browser-google-identity-003-1
status: pass
reviewed_task: omni-browser-google-identity-003
date: 2026-07-28
review_type: independent-source
---

# Omni Browser Google Identity 003 — Review 1

## Findings

None. No P1, P2, or P3 blocking or non-blocking finding was identified.

## Conclusion

pass

The implementation matches the provider-scoped identity contract and is ready for Ral's remaining
interactive YouTube verification.

## Source Assessment

- Profile selection parses the URL hostname, lowercases it, and matches only exact `google.com`,
  `youtube.com`, `youtu.be`, or dot-delimited subdomains. Lookalikes therefore remain on the
  default profile (`src/main/windows/omniWindow.helper.ts:72`,
  `docs/features/omni-miniapp-cells.md:108`,
  `docs/plan/tasks/omni-browser-google-identity-003.md:43`).
- The Google UA is derived from the selected persistent session's current UA. It removes every
  existing `Electron/...` and `Bitterless/...` product token, requires the real `Chrome/...` token,
  and inserts exactly one current `Bitterless/<app version>` immediately before it. Reapplying the
  function to an already configured session is idempotent and retains all unrelated product tokens
  (`src/main/windows/omniWindow.helper.ts:89`,
  `docs/plan/tasks/omni-browser-google-identity-003.md:47`).
- `persist:omni-google` receives the derived UA before its `WebContentsView` is constructed, and the
  identical UA is installed on that view before any initial or replacement `loadURL()`. The default
  `persist:omni` path calls neither session nor view `setUserAgent()`, so stock Electron identity is
  not spoofed (`src/main/windows/omniWindow.helper.ts:580`,
  `docs/features/omni-miniapp-cells.md:111`).
- Initial restored cells resolve their profile before creating their operation view. URL entry from
  either browser chrome or the Control overlay reaches `navigateCell`; a profile change replaces
  only that cell's remote content view and loads the destination only after the replacement is
  configured (`src/main/windows/omniWindow.helper.ts:514`,
  `src/main/windows/omniWindow.helper.ts:735`,
  `src/main/windows/omniWindow.helper.ts:957`,
  `docs/features/omni-miniapp-cells.md:121`).
- Navigation and crash handlers reject events from a superseded content view by checking the
  cell's current content identity. Focus handling has the same fence, and late browser-chrome
  initialization resolves the current replacement view rather than retaining the destroyed one
  (`src/main/windows/omniWindow.helper.ts:790`,
  `src/main/windows/omniWindow.helper.ts:865`,
  `src/main/windows/omniWindow.helper.ts:928`).
- The replacement keeps the existing cell object, menubar, layout tree, bounds, and persisted URL
  flow. Browser notification interception and permission behavior are installed for both browser
  sessions, while mini-app session/preload handling remains separate. The working-tree source
  change is confined to `src/main/windows/omniWindow.helper.ts`; it does not alter Maestro identity,
  request headers, UA-CH, CDP, JavaScript identity globals, package configuration, or tests.

## Verification Boundary

- `git diff --check -- src/main/windows/omniWindow.helper.ts` — pass.
- Per Ral's instruction, runtime tests, Electron launch, build, typecheck, lint, and repeated login
  checks were intentionally not run. This verdict is based on independent source and lifecycle
  review only.
- Ral's complete interactive YouTube login inside an Omni browser cell remains the owner acceptance
  step.
