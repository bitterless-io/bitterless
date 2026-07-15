# Review: todo-archived-domains-modal-refresh (round 2)

## Findings and fixes

The first pass found that a committed restore could be reported as failed when `loadAll()` failed,
and that two stale windows could both pass the renderer-side 17-domain check. The first re-review
then found that `loadAll()` could partially clear unrelated board state and that a concurrent create
could still race a restore.

The final implementation resolves all findings:

- Restore uses one count-guarded SQLite `UPDATE`; create uses the matching count-guarded `INSERT`.
  Serialized writers cannot take the active-domain count above 17.
- A successful restore updates only the restored domain and loads only that domain's todos. Failed
  follow-up reads are logged without converting a committed restore into a failure or clearing other
  domains.
- Renderer create and restore paths show the existing localized limit warning, while MCP domain
  creation returns the explicit active-domain-limit error.

The independent final re-review reported no remaining correctness findings.

## Contract review

| Contract | Result | Evidence |
|---|---|---|
| Standard compact modal | pass | Native Arco title/close, white body, 12px toolbar/list gap, no eyebrow or card grid |
| Stable scrolling | pass | Modal body overflow is hidden; the bordered domain list is the only vertical scroll owner |
| Restore interaction | pass | Every row has a Royal Blue Restore button with row-local loading and disabled sibling actions |
| State consistency | pass | Restore reconciles one domain, retains unrelated todo maps, and broadcasts cross-window refresh |
| Active-domain cap | pass | Create and restore enforce `< 17` inside their SQLite write statements |
| Localization | pass | English and Chinese include matching load, restore, success, and failure labels |

## Verification

| Check | Result |
|---|---|
| Actual Vue/Arco browser harness at 800x600 | pass: 520px modal, list-only scroll, no overflow, loading visible, restore removed one row |
| Compact browser probe at 360x520 | pass: 336px modal, responsive row action, no horizontal overflow |
| Electron-native SQL probe | pass: restore-then-create and create-then-restore both stop at 17 active domains |
| `yarn test:mcp:domain-create` | pass |
| `yarn typecheck:node` | pass |
| `yarn check:renderer-i18n` | pass |
| Focused ESLint and Less compilation | pass with existing formatting warnings only |
| `yarn build` | pass |
| `git diff --check` | pass |
| `yarn typecheck:web` | existing baseline failures outside the changed files; no scoped diagnostic |

## Residual risk

The complete production Electron multi-window flow was not automated in this round. The component
was rendered with its real Vue/Arco implementation, and the database limit was exercised with the
project's Electron-native SQLite binding, but Escape/mask close and two visible Todo windows remain
manual integration coverage.
