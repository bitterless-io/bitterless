# onlypreview-global-search-workspace-037 — Review 2

- Date: 2026-08-26
- Result: **PASS**
- Scope: independent re-review of Review 1's four findings and the current dirty-worktree task 037
  boundary. Unrelated worktree changes were preserved and excluded.
- Method: fresh source/contract audit, focused plus adjacent non-E2E tests, Node typecheck, Web SFC
  syntax/resolution check, scoped whitespace check, production line-count audit, and focus-race review.
- E2E/live app: intentionally not run. Electron, Playwright/E2E, the real application, packaged
  smoke, `yarn build`, and visual acceptance remain excluded by the assigned verification contract.

## Findings

No P0, P1, P2, or P3 finding remains.

## Review 1 finding closure

### Find → Global Search `Esc` and hidden Preview: closed

- `src/main/windows/onlyPreviewWindow.helper.ts:266-278` now closes the Main-owned current-file Find
  before it captures the opener, focuses Shell, and broadcasts Global Search. That branch never
  calls `focusActiveContent`, so it cannot transfer focus into the deliberately 0×0 Preview.
- Closing Find publishes the synchronized state before the focus-search broadcast. The native
  unmodified-`Esc` interception remains conditional on Main still reporting Find open; after the
  transition, `Esc` reaches `GlobalSearchWorkspace` and follows query-clear then workspace-close.
- The behavioral store regression covers Shell, Vue Preview, and Chrome Preview origins: the first
  `Esc` clears a non-empty query and the second exits Global Search.

### Exact opener restoration and invalid-opener fallback: closed

- Main records one first opener with its exact host and `shell` / `vue` / `chrome` origin. Vue and
  Chrome restore the original live `WebContents`; Shell restores the captured connected DOM element.
  A Shell, destroyed, or wrong-host Main opener returns `false` without focusing it.
- `src/renderer/onlypreview/shell/src/App.vue:512-547` restores the live Preview bounds first, then
  tries the Main Vue/Chrome opener, the Shell DOM opener, the current Project row, and finally the
  active Preview. Its generation fence prevents a superseded close continuation from focusing an
  older target.
- Current-file `Cmd/Ctrl+F` calls `onlyPreviewGlobalSearchStore.exit(false)` before awaiting Find
  focus. The inactive watcher therefore uses `discard`, which clears Main's saved opener and performs
  no focus fallback; the old Global Search opener cannot steal focus from the new Find input.
- The restore request is exact-key parsed and requires a live `content` host. It carries no path or
  filesystem authority.

### Fresh group expansion with persistent split: closed

- A fresh inactive → active `enter()` resets both `filesCollapsed` and `contentsCollapsed` to
  `false`. It intentionally leaves `previewPercent` untouched, so the 38% initial value and the
  per-window user-selected 25–70% split survive close/reopen.
- The behavioral regression collapses both groups, closes, reopens with a new origin, and verifies
  both groups expanded while the 61% split remains.

### Removed Project Search CSS and i18n surface: closed

- No production source match remains for `ProjectSearchResults`, `onlyPreviewProjectSearch`,
  `projectSearch`, the removed English/Chinese filter copy, or the old Project-search/scope CSS
  selectors.
- The old component/store files remain deleted; the Global Search catalog and component styles are
  the only live search presentation surface.

## No-regression audit

- Shortcut routing remains exact: only `Shift+Cmd/Ctrl+F` opens Global Search; Alt/Option and mixed
  primary modifiers are rejected. Plain `Cmd/Ctrl+F` remains current-file Find across Shell, Vue,
  and Chrome Preview WebContents.
- Global Search still reports the exact zero-bounds sentinel while active, preserves it across
  BaseWindow resize, and restores current DOM bounds without file reselection or Preview reload.
- Files still precedes Contents, each section remains capped at 250, IME dispatch remains 120ms and
  latest-only, and result-token replacement refetches Preview behind stale request/component fences.
- Click/Enter remains preview-only; double-click and `Cmd/Ctrl+Enter` remain the explicit open/reveal
  actions. Directory scope stays captured and stable until the next fresh Global Search entry.
- Preview rendering remains one typed lazy `defineAsyncComponent` branch at a time. Markdown removes
  raw HTML/link authority; static HTML retains its zero-attribute allowlist and blocks active content,
  scripts, resources, navigation, forms, embeds, media, style, and SVG authority.
- Renderer state stays bounded to 250 Files + 250 Contents + one preview. Text Preview remains
  256KiB, directory Preview 200 direct children, and no new recursive scan, unbounded DOM list,
  parallel full-file read, or persistent per-click collection was introduced. The focus service
  retains at most one opener.
- Responsive/reduced-motion behavior remains present at the 800px minimum. Reviewed production
  files are below 800 lines: the largest are `onlyPreviewShell.store.ts` at 796,
  `onlyPreviewWindow.helper.ts` at 795, and `onlyPreview.handler.ts` at 775.

## Code Review 报告

The Review 1 remediation files below were rechecked against `TS-1`, `TS-2`, `FE-1`, and `FE-2`.

### 文件清单

| # | File | Issues |
|---|---|---:|
| 1 | `src/main/onlypreview/onlyPreviewGlobalSearchFocus.service.ts` | 0 |
| 2 | `src/main/windows/onlyPreviewWindow.helper.ts` | 0 |
| 3 | `src/main/xpc/onlyPreview.handler.ts` | 0 |
| 4 | `src/shared/onlypreview/onlyPreview.types.ts` | 0 |
| 5 | `src/shared/onlypreview/onlyPreview.contract.ts` | 0 |
| 6 | `src/renderer/onlypreview/shell/src/App.vue` | 0 |
| 7 | `src/renderer/onlypreview/shell/src/onlyPreviewGlobalSearch.store.ts` | 0 |
| 8 | `src/renderer/onlypreview/shell/src/onlyPreviewGlobalSearchFocus.client.ts` | 0 |
| 9 | `src/renderer/onlypreview/shell/src/onlyPreviewShell.store.ts` | 0 |
| 10 | `src/renderer/onlypreview/shell/src/onlyPreviewShellEvents.service.ts` | 0 |
| 11 | `src/renderer/onlypreview/shell/src/components/GlobalSearch/GlobalSearchWorkspace.vue` | 0 |
| 12 | `tests/onlypreview/onlyPreviewGlobalSearchShell.test.mjs` | 0 |
| 13 | `tests/onlypreview/onlyPreviewGlobalSearchUi.test.mjs` | 0 |
| 14 | `tests/onlypreview/onlyPreviewSearchShellUi.test.mjs` | 0 |

### 问题清单

None.

No replaceable `function` declaration/expression was found. Vue SFCs retain presentation/focus DOM
coordination while search requests, state transitions, cancellation, and result/preview workflow
remain in stores/services; the reusable result-row event is outside the remediation and introduces
no new business-component emit.

## Verification

| Command / evidence | Result |
|---|---|
| `node --test` over task 037's five suites, Find renderer, and task 036's five adjacent grouped-search suites | **PASS, 52/52** |
| `yarn typecheck:node` | **PASS** |
| `yarn vue-tsc --noEmit --noCheck -p tsconfig.web.json --composite false` | **PASS** |
| Scoped `git diff --check` for reviewed task source/tests, including untracked files | **PASS** |
| Production old-surface search and line-count audit | **PASS:** no old CSS/i18n/reference residue; all task production files below 800 lines |
| `yarn build` | Not run; explicitly excluded from this independent review |
| Electron / Playwright / E2E / real app / packaged smoke | Not run, as required |

## Conclusion

**PASS.** Review 1's Find/Global `Esc`, opener restoration, fresh group expansion, and dead
presentation findings are closed. The remediation preserves exact shortcut separation, zero-bounds
Preview handling, latest-only bounded search/preview behavior, sanitizer boundaries, and the
device-safety ceilings required by task 037; no new P0–P3 issue was found.
