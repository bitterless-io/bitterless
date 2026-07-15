# Review: todo-archived-domains-modal-refresh (round 1)

## Findings

The independent review found one low-severity accessibility issue: the search input used only its
placeholder as a visible hint. The final patch adds a localized `aria-label`; the reviewer rechecked
the change and reported no remaining findings. The final patch also keeps title letter spacing at
the project-required value of `0`.

## Contract review

| Contract | Result | Evidence |
|---|---|---|
| One modal header and close | pass | `ArchivedDomainsModal` now supplies Arco's `#title` slot and contains no custom `IconX`; Escape, mask close, and the native close remain wired through `cancel`. |
| Bitterless visual system | pass | The modal uses the documented Royal Blue surface, border, text, and action colors; internal modules use 12px gaps and archive rows use an 8px radius. |
| Compact-window geometry | pass | Width is capped at 520px and at the viewport minus 32px/24px; the modal body owns viewport-relative scrolling. Browser probes measured 520px at 554x608 and 336px at 360x520. |
| Read-only archive behavior | pass | Search still filters title and description, resets on close, and exposes no restore or destructive action. |
| Loading and failure behavior | pass | The Archive menu trigger uses the non-destructive Archive icon, has an accessible label and loading state, ignores repeat clicks, and keeps the modal closed while showing a localized error on failure. |
| Localization | pass | English and Chinese include `archivedDomainsLoadFailed`; the unrelated in-progress Maestro localization edits were preserved. |

## Verification

| Check | Result | Evidence |
|---|---|---|
| Focused source contract | pass | 13 assertions cover the native title/close contract, responsive width, 12px gaps, Royal Blue values, Archive trigger/loading, localized failure, search label, and removal of the old `oklch` palette. |
| Targeted compilation | pass | `@vue/compiler-sfc` compiled both touched Vue components and Less compiled `ArchivedDomainsModal.less`. |
| ESLint | pass with warnings | The focused command exited 0 with no errors; existing Prettier warnings remain in the touched files. |
| Production build | pass | `yarn build` completed the main, preload, and renderer production bundles in 15.09 seconds. |
| Populated modal browser harness | pass | At 554x608 and 360x520, the harness covered populated rows, body scrolling, search/filter/reset, empty/no-match states, loading/failure/retry, Escape, mask close, and the single native close. |
| Isolated Electron failure path | pass | A temporary Playwright spec verified that an unavailable Todo SQLite service shows the localized error and does not open stale modal data. The test passed and the temporary spec was removed. |
| Web typecheck | baseline failure | `yarn typecheck:web` still reports existing errors outside the five implementation files; no diagnostic referenced this task's files. |
| Patch hygiene | pass | `git diff --check` exits 0. |

## Conclusion

Pass. The Archived domains modal now matches the current Bitterless modal contract, remains usable
at compact dimensions, and handles its asynchronous entry point explicitly. A populated archive
could not be exercised through the isolated Electron SQLite service because that environment lacks
the native `better-sqlite3-multiple-ciphers` binding; the populated-state browser harness and full
production build cover the resulting visual and compilation risk.

