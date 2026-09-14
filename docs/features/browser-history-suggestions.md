# Browser history and address suggestions

Status: implemented and code-verified on 2026-09-14; human Electron testing pending.

## Request and scope

Ral requested browser-history support in Bitterless CoWork and Micromeet Cowork, each implemented in its own worktree. The attached Chrome screenshots define a compact address suggestion list with page titles, URLs, highlighted selection and individual removal.

## Persistence contract

- Store history through the existing encrypted SQLite preload/process and its migration lifecycle. No separate plaintext file or renderer localStorage.
- Keep at most 1000 distinct normalized HTTP(S) URLs per existing database scope. Revisiting updates title, favicon when available, visit count and last-visited integer UTC milliseconds; prune least-recently-visited rows in the same transaction. Keep fragments because hash routes identify pages; strip URL userinfo. Ignore local files, bundled entries, mini-app/internal pages and failed navigations.
- Record successful main-frame navigation and same-document/hash navigation; update late titles/favicons without counting another visit. Browser tabs opened by agents follow the same events.
- Match case-insensitively against URL and title, including Unicode titles/decoded URL text. Prefer exact/prefix matches, then recency/frequency with deterministic ties. Return a bounded list (8 suggestions); an empty query shows most recent entries. Literal percent/underscore must not act as wildcards.
- Each history suggestion has a remove control (the Google search row does not); deleting removes the stored URL until a future visit. History write failure must not prevent browsing; report a bounded warning without logging visited URLs. Query failures show a retryable localized state.

## Address interaction and renderer

Use a dedicated transparent WebContentsView renderer above page/control views, anchored directly below the address field and clipped to the window. Keep address typing focused in the home renderer. Share state/actions through electron-xpc, with request sequencing to discard stale queries and prevent reopening after dismissal.

    [ page type ] [ URL / search input                         ] [ history ]
                 ( Search Google for current input           )
                 ( title of matched page        https://…   x )
                 ( another page                 https://…   x )
                 ( recent history / no matches / retry state )

- Focus/click or typing in the URL input opens matching suggestions; history icon toggles recent history (blank query). Opening history on a non-web tab can display recents but must preserve existing local-path/page-type behavior.
- Arrow Down/Up changes selection, Enter opens the selected result (or submits the typed URL/search through the existing navigation path), Escape hides, and Tab dismisses without trapping focus. IME composition must not trigger selection or navigation.
- For every nonempty input, show an explicit localized “Search Google for <input>” candidate alongside matching history; it participates in arrow-key selection and mouse/Enter activation and builds https://www.google.com/search?q= with correctly encoded original input. Plain non-URL text submitted without a history selection also uses Google. History title matching is required, including partial Chinese/Unicode titles, as Ral reaffirmed on 2026-09-14.
- Clicking a row navigates; clicking its remove icon removes only that row. Provide explicit history toggle and close controls, with accessible labels and loading/empty/error states.
- Dismiss on outside click/focus leaving the address interaction, window blur, navigation, tab switch/close, renderer destruction and window closure. Reposition safely on window resize. Avoid address blur racing with popup row clicks.
- Chrome-inspired horizontal rows: site/history icon, readable title, accent URL, soft selected background, rounded surface/shadow. No borders for hierarchy. Use existing app font/theme and local UI components, semantic BEM classes and stable name attributes; all text localized in each app's existing i18n system.

## Verification and delivery

Run proportionate executable persistence/matching/lifecycle unit tests, applicable type/build/i18n/migration checks. Persistence verification covers deduplication, 1000-row eviction, repeat-visit refresh, restart/reopen, title-only updates and literal/Unicode matching. UI state verification covers stale query/dismissal and keyboard/IME behavior where practical.

Do not launch Electron, E2E, packaged apps or an independent review. Human testing: visit several sites and hash routes, restart, type title/URL fragments, exercise mouse/keyboard/removal/toggle/Escape/outside dismissal, resize and switch tabs while popup is open. Verify popup stays above page and chat views. Worktrees include a snapshot of pre-existing uncommitted work; only changes after that snapshot belong to this task.

## Electron references

Native layering uses the documented [View child ordering](https://www.electronjs.org/docs/latest/api/view#viewaddchildviewview-index). Recording and dismissal follow [WebContents navigation and input events](https://www.electronjs.org/docs/latest/api/web-contents).

## Bitterless implementation and verified delivery

History is stored in Maestro’s existing encrypted config database through BrowserHistoryDao. Fresh schema and migration 260914160000 create browser_history; no earlier Bitterless browser-history table existed to import. Main-frame navigation, hash changes and metadata-only updates feed the same DAO. The dedicated history preload/renderer and native view use electron-xpc. The Google candidate preserves the original query.

- 31 executable tests passed: 8 persistence, 9 address/recording, 14 native popup lifecycle (including popup-crash late-message rejection). Command: `node --test tests/maestro/maestroBrowserHistory.test.mjs tests/maestro/maestroBrowserHistoryInput.test.mjs tests/maestro/maestroBrowserHistoryPopup.test.mjs`.
- `node scripts/maestro/check-new-tab-focus.mjs`, `node scripts/renderer-i18n/check-renderer-i18n.mjs` and `node scripts/sqlite-migrations/audit.mjs` passed. Narrow persistence TypeScript check passed.
- Final `yarn build` passed, including the new history renderer and preload. Existing mac_arm tool-cache files were copied into this worktree to satisfy its real-file staging contract; no tools were downloaded. Build-only package version drift was restored to the initial snapshot.
- Relevant TypeScript surface results are unchanged from the pre-feature baseline: shared 3, main 64, preload/maestro 7, renderer/common 0, renderer/maestro 4 diagnostics. Full type checks are not clean; no new diagnostics were added. The broad maestro source guard remains blocked by two pre-existing Workbench Zellij import violations.

Verification logs are in `/Users/ral/Documents/projects/overmind/tmp/browser-history-verification`. The initial implementation was verified in separate `codex/browser-history` worktrees. At Ral’s request, the feature-only increment was then three-way merged into each original project’s attached `dev/next` working tree on 2026-09-14, preserving existing uncommitted work and newer unrelated changes. No commit or push was performed.

Human handoff is recorded in Bitterless Preview, domain `agent builid`, Todo `00357809900035809304`: “验收 BL / Cowork 浏览历史、标题匹配与 Google 搜索候选”. Run `yarn dev` from this project’s app directory after stopping any existing development instance; verify restart persistence, title/URL matching, Google query fidelity, focus, native placement and all popup dismissal paths. No Electron/E2E or independent review was run.

## Attached-checkout handoff

The current test target is `/Users/ral/Documents/projects/overmind/projects/bitterless`: run `yarn dev` there after stopping the existing development instance. The earlier isolated worktree launch instructions are superseded. Integration used the saved pre-feature snapshot, retained both independently added documentation-index entries, and left all dependency/cache symlinks out of the merge.

Post-integration verification passed in the attached checkouts: Bitterless 31 history/input/native-view tests; Cowork 32 history/address tests plus URL, schema and i18n guards. Bitterless’s unrelated Node/Electron SQLite ABI mismatch is repaired separately in [sqlite-native-abi-mismatch.md](../issues/sqlite-native-abi-mismatch.md). No Electron GUI/E2E was launched.
