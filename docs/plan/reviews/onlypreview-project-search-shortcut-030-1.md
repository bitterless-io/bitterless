# OnlyPreview Project Search Shortcut 030 — Independent Review 1

Status: **PASS**

Date: 2026-08-24

## Verdict

Task 030 satisfies its shortcut and ownership contract. Main accepts Project Search only for a
non-repeating `F` key-down with the platform primary modifier, no opposite primary modifier, and
exactly one of Shift or Option/Alt. This gives macOS `Option+Cmd+F`, non-macOS `Alt+Ctrl+F`, and the
retained Shift alias while leaving plain primary+F exclusively on current-file Find.

The change reuses the existing Main `before-input-event` binding, Shell-focus action, host-scoped
focus-search event, Project Search `enter()` flow, and existing input. Shell, Vue Preview, and raw
Chrome Preview therefore take the same route. No renderer route/API/event/input/visual state was
added. No P0-P2 finding remains.

Electron/Playwright E2E, the real app, and live shortcut verification were not run.

## Findings

| Severity | Blocking | Count |
| -------- | -------- | ----: |
| P0       | blocking |     0 |
| P1       | blocking |     0 |
| P2       | blocking / non-blocking |     0 |

## Contract audit

| Required behavior | Result | Independent evidence |
| ----------------- | ------ | -------------------- |
| macOS Option+Cmd+F | **PASS** | `isProjectSearchShortcut()` requires the macOS primary `meta`, rejects `control`, and accepts `alt=true, shift=false` (`src/main/windows/onlyPreviewWindow.helper.ts:114-128`). The executable predicate test runs this combination under `darwin` (`tests/onlypreview/onlyPreviewFindRenderer.test.mjs:500-528`). |
| Non-macOS Alt+Ctrl+F | **PASS** | The same predicate requires `control`, rejects `meta`, and accepts the exclusive Alt secondary on the non-Darwin branch. The test executes it under `win32`, which covers the shared Windows/Linux branch. |
| Retained Shift alias | **PASS** | `input.shift === input.alt` rejects both-equal states, so Shift-only and Alt-only are the two accepted variants. Both Darwin and non-Darwin Shift cases execute and return true (`tests/onlypreview/onlyPreviewFindRenderer.test.mjs:514-515`). |
| Plain primary+F remains current-file Find | **PASS** | The Project Search predicate rejects `shift=false, alt=false`; `isCurrentFileFindShortcut()` then accepts only the plain primary chord (`src/main/windows/onlyPreviewWindow.helper.ts:117-142,743-744`). Both production predicates are executed for both platform branches (`tests/onlypreview/onlyPreviewFindRenderer.test.mjs:516,530-532`). |
| Negative modifier/event matrix | **PASS** | The executable cases reject Shift+Alt, auto-repeat, key-up, wrong key, missing primary, and mixed Cmd+Ctrl (`tests/onlypreview/onlyPreviewFindRenderer.test.mjs:517-528`). The production predicate also rejects the opposite primary explicitly at helper line 127. |
| Matched-only `preventDefault()` | **PASS** | `bindNativeShortcuts()` resolves a command, returns immediately when null, and only then calls `event.preventDefault()` (`src/main/windows/onlyPreviewWindow.helper.ts:230-235`). Source integration assertions pin that ordering (`tests/onlypreview/onlyPreviewFindRenderer.test.mjs:543-550`). |
| Main route covers Shell, Vue, and Chrome | **PASS** | `createView()` binds the handler to both Shell and Vue Preview (`src/main/windows/onlyPreviewWindow.helper.ts:691-713`); Preview Region's `bindChromeShortcuts` callback binds the same handler to raw Chrome (`src/main/windows/onlyPreviewWindow.helper.ts:620-629`). No renderer-specific keyboard implementation exists. |
| Existing focus-search flow is reused | **PASS** | The existing `focus-search` command focuses live Shell and broadcasts `ONLY_PREVIEW_FOCUS_SEARCH_EVENT` (`src/main/windows/onlyPreviewWindow.helper.ts:254-268`). Shell's existing host-gated subscriber calls `onlyPreviewProjectSearchStore.enter()`, which captures current-directory scope, and increments the revision watched by the existing input-focus hook (`src/renderer/onlypreview/shell/src/onlyPreviewShellEvents.service.ts:131-133`; `src/renderer/onlypreview/shell/src/onlyPreviewShell.store.ts:397-400`; `src/renderer/onlypreview/shell/src/onlyPreviewProjectSearch.store.ts:151-161`; `src/renderer/onlypreview/shell/src/App.vue:653-656`). |
| No new renderer/API/UI surface | **PASS** | The production change is confined to the Main shortcut predicate. It reuses the pre-existing event and Shell Project Search UI; Task 030 adds no shared API/type, renderer route, renderer event, input, or visual component. |
| Executable tests use production predicate | **PASS** | `loadShortcutPredicate()` reads `onlyPreviewWindow.helper.ts`, locates the named production predicate, transpiles its exact body into an executable function, and injects only platform/primary-modifier dependencies (`tests/onlypreview/onlyPreviewFindRenderer.test.mjs:9-45,60-79`). The truth table therefore executes production predicate code rather than a copied test implementation. |
| Performance/device safety | **PASS** | One constant-time boolean predicate runs inside the existing input listener. The alias adds no I/O, iteration, allocation proportional to input, renderer, process, worker, or persistent listener. |

## Code Review report

- Scope: Task 030 production and executable/source tests on `dev/next`
- Date: 2026-08-24

### File list

| # | File | Lines | Findings |
| -: | ---- | ----: | -------: |
| 1 | `src/main/windows/onlyPreviewWindow.helper.ts` | 769 | 0 |
| 2 | `tests/onlypreview/onlyPreviewFindRenderer.test.mjs` | 555 | 0 |
| 3 | `tests/onlypreview/onlyPreviewSearchShellUi.test.mjs` | 591 | 0 |

### Problems

None under the workspace `code-review` rules. All three TS/JS files are at most 800 lines (TS-1),
and no replaceable `function` declaration/expression appears (TS-2). Task 030 changes no Vue
business component, so FE-1 and FE-2 are not applicable. There are no backend rules.

## Fresh verification

| Check | Result |
| ----- | ------ |
| `node --test tests/onlypreview/onlyPreviewFindRenderer.test.mjs tests/onlypreview/onlyPreviewSearchShellUi.test.mjs` | **PASS — 14/14**, zero failed/cancelled/skipped/todo |
| `node --test tests/onlypreview/*.test.mjs` | **PASS — 337/337**, zero failed/cancelled/skipped/todo |
| `yarn typecheck:node` | **PASS** |
| `yarn check:renderer-i18n` | **PASS** |
| focused `yarn eslint --quiet` over the three scoped code/test files | **PASS**, zero errors |
| `git diff --check` | **PASS** |
| `yarn build` | **PASS** — Main 1,664, preload 1,039, client 10,428 modules; existing OnlyPreview Shell/Preview entries emitted |

The build emitted the existing unrelated mixed static/dynamic-import warnings for Maestro ExcelJS,
EyesOnAgents handler, and Home router. No warning points at Task 030.

## Owner-only live acceptance

Ral still owns the environment-dependent verification intentionally excluded from this review:

- from Shell, Vue Preview, and HTML/PDF Chrome Preview, verify Option+Cmd+F on macOS or Alt+Ctrl+F
  on Windows/Linux enters Project Search and focuses the existing input;
- verify the Shift alias still enters Project Search and captures the expected current-directory
  scope;
- verify plain Cmd/Ctrl+F still opens only current-file Find, combined Shift+Option/Alt does
  nothing, auto-repeat causes no duplicate action, and unmatched editor/content input remains
  native.

## Delivery handoff

The delivery owner should transition the task/feature/design/analysis/README ledger only after this
review is incorporated. This independent review intentionally edited none of those files.

## Conclusion

**PASS.** The new Option/Alt alias is exact, cross-surface Main routing is preserved, current-file
Find remains separated, and all required non-E2E checks pass with no P0-P2 finding.
