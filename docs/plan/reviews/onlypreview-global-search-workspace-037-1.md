# onlypreview-global-search-workspace-037 — Review 1

- Date: 2026-08-26
- Result: **BLOCKED**
- Scope: independent review of task 037 and the accepted Global Search design against the current
  dirty worktree. Unrelated worktree changes were preserved and excluded.
- Method: source/contract audit, focused plus adjacent non-E2E tests, Node/Web diagnostics, renderer
  i18n diagnostics, scoped whitespace check, and production line-count audit.
- E2E/live app: intentionally not run. Electron, Playwright/E2E, the real application, packaged
  smoke, and `yarn build` remain excluded by the assigned verification contract.

## Findings

### [P1] Entering Global Search does not close current-file Find, so `Esc` can move focus into the hidden Preview and strand the search workspace

`src/renderer/onlypreview/shell/src/onlyPreviewShell.store.ts:364-366` handles the native
`focusSearch` event by calling only `onlyPreviewGlobalSearchStore.enter()`. It does not close the
Main-owned current-file Find. Main therefore still considers Find open after the right work area has
switched to Global Search and its native Preview has been set to zero bounds.

On the next unmodified `Esc`, `src/main/windows/onlyPreviewWindow.helper.ts:753-764` resolves
`close-find-in-file` before the key can reach the Shell. The shared `before-input-event` handler at
`src/main/windows/onlyPreviewWindow.helper.ts:234-256` prevents the key, closes Find, and calls
`focusActiveContent()`. At that moment the active Preview is deliberately 0×0 behind Global Search.
Consequently the first `Esc` never reaches the query-clear branch at
`src/renderer/onlypreview/shell/src/components/GlobalSearch/GlobalSearchWorkspace.vue:225-230`, and
focus is transferred out of the visible search workspace. Further `Esc` input can remain in the
hidden Vue/Chrome Preview, so the required “first clear, second close” interaction is not merely one
extra keypress; it can become unreachable until the user clicks the Shell again.

Make the two find modes mutually exclusive on Global Search entry. Close the Main-owned Find before
focusing/broadcasting Global Search (without focusing the hidden Preview), synchronize the Shell Find
state, and keep focus on the Global Search input. Add a behavioral regression for the exact sequence:
open current-file Find → `Shift+Cmd/Ctrl+F` → non-empty Global query → first `Esc` clears → second
`Esc` closes, for Shell, Vue Preview, and Chrome Preview shortcut origins.

### [P2] Closing Global Search always focuses the Project tree instead of restoring the actual opener

The accepted focus contract restores the element that opened Global Search when it remains valid,
then falls back to the current Project row, then the main Preview. The implementation records no
opener. `src/renderer/onlypreview/shell/src/App.vue:495-501` unconditionally calls
`focusTreePath(onlyPreviewShellStore.focusTree())` whenever Global Search becomes inactive.

This is observable for the primary shortcut path: Main binds the shortcut to Shell, Vue Preview, and
Chrome Preview WebContents, but `src/main/windows/onlyPreviewWindow.helper.ts:258-271` focuses the
Shell and broadcasts the same event without retaining the originating WebContents. A search opened
while reading HTML/PDF or a Vue preview therefore closes into the Project tree, not back into the
file being read. It also fails for a Shell control other than the tree.

Capture the valid Shell element or originating Preview WebContents before the focus handoff and
restore it on close, with the documented Project-row/main-Preview fallbacks. Cover Shell, Vue, and
Chrome origins and a destroyed/invalid opener.

### [P2] Files/Contents collapse state survives close even though both groups must begin expanded

`filesCollapsed` and `contentsCollapsed` are initialized to `false` at
`src/renderer/onlypreview/shell/src/onlyPreviewGlobalSearch.store.ts:68-71`, but neither
`enter()` nor `exit()` at lines 126-140 resets them. Collapse Files or Contents, close Global Search,
and reopen it: the previous group remains collapsed. That contradicts the accepted interaction
contract that both groups begin expanded and makes a newly captured search scope open with results
silently hidden.

Reset both flags on a fresh inactive→active entry (while retaining the explicitly persistent
per-window preview split), and add a reopen regression.

### [P3] Removed Project Search presentation leaves its full dead style/catalog surface behind

The Project input and `ProjectSearchResults` components are absent from the live template, but
`src/renderer/onlypreview/shell/src/App.less:168-170,237-334` still contains the old Project search,
clear-button, scope-control, and scope-target rules. The old English/Chinese Project filter and
Project Search catalog remains at `src/renderer/onlypreview/common/onlyPreviewI18n.ts:22-37` and
`:223-238`. This has no current runtime effect, but the task explicitly removes that surface and the
dead selectors/catalog make later audits and styling changes ambiguous. Remove the unused surface
after confirming no non-OnlyPreview consumer imports those keys.

## Verified behavior

- The Project input and old result component are absent from `App.vue`; the old component/store
  files are deleted and have no live Shell references.
- `Shift+Cmd/Ctrl+F` is exact, rejects Alt/Option and mixed primary modifiers, and is bound across
  Shell, Vue Preview, and Chrome Preview. Plain `Cmd/Ctrl+F` remains current-file Find.
- Global Search sets native Preview bounds to 0×0, preserves that hidden sentinel across BaseWindow
  resize, and restores live DOM bounds without selecting or presenting the file again.
- The synthetic root is first, starts expanded, participates in tree ARIA/keyboard navigation, uses
  a root-only Main capability, copies relative path as `.`, exposes no Delete action, and ordinary
  `OnlyPreviewFileRef` continues to reject `relativePath: ''`.
- Files precedes Contents; each section is capped at 250; IME dispatch is 120ms latest-only; selected
  token replacement refetches Preview and fences the stale result/promise.
- Click/Enter remains preview-only. Double-click and `Cmd/Ctrl+Enter` explicitly open a file or reveal
  a directory and close after success. Captured directory scope remains stable across result
  selection and Project-scope switching.
- Preview variants are selected through six `defineAsyncComponent` branches. Markdown strips link
  authority and raw HTML; static HTML uses a zero-attribute, XHTML-only allowlist and forbids scripts,
  resources, navigation/form/embed/media/style/SVG active content.
- Renderer collections remain bounded to 250 Files + 250 Contents and one preview. Text Preview is
  bounded to 256KiB, directory Preview to 200 direct children, and context Preview to the accepted
  bounded match. No recursive selection scan or persistent per-click collection was found.
- Preview split defaults to 38%, clamps to 25–70%, supports pointer and keyboard resizing, includes
  the 800px layout rule, and removes its introduced chevron transition under reduced motion.
- Every reviewed production file is below 800 lines. The largest is
  `onlyPreviewShell.store.ts` at 796 lines; `onlyPreviewWindow.helper.ts` is 777,
  `onlyPreviewPreviewRegion.service.ts` is 763, and `onlyPreview.handler.ts` is 757.

## Verification

| Command / evidence | Result |
|---|---|
| `node --test` over task 037's five suites plus Find renderer and task 036's five grouped-search suites | **PASS, 46/46** |
| `yarn typecheck:node` | **PASS** |
| `yarn typecheck:web` | **BLOCKED outside reviewed scope:** existing diagnostics only in poker tests, connector/home/maestro/omni renderers, and shared path helper; no OnlyPreview diagnostic was emitted |
| `yarn vue-tsc --noEmit --noCheck -p tsconfig.web.json --composite false` | **PASS** (full Web SFC syntax/resolution pass) |
| `yarn i18n:check` | Not available: package has no such script; the task's command name is stale |
| `yarn check:renderer-i18n` | **BLOCKED outside reviewed scope:** existing `Tray must follow Home creation` assertion; OnlyPreview's typed EN/ZH catalog compiled with no diagnostic |
| Scoped `git diff --check` for reviewed source/tests | **PASS** |
| Production line-count audit | **PASS:** all reviewed production files below 800 lines |
| `yarn build` | Not run; explicitly excluded from this independent review |
| Electron / Playwright / E2E / real app / packaged smoke | Not run, as required |

## Conclusion

**BLOCKED.** The grouped Global Search data/UI, bounded lazy preview, native zero-bounds handling,
synthetic root capability, sanitizer boundary, and device-safety ceilings are substantially present.
Task 037 cannot pass while a normal Find→Global Search transition can strand focus in a hidden
Preview and while the accepted focus restoration and initial group-state contracts remain unmet.
