# Every save recounts every message of every session

**Status:** Fixed 2026-09-18 in both projects (code + tests). Owner `yarn dev` acceptance pending.

Split out of [the incremental-save work](session-save-rewrites-the-whole-session.md) on 2026-09-18.
That change made a save's *write* proportional to the edit. Its *read* is still proportional to the
entire database, and now dominates.

## What happens

Every successful save — all three lanes — ends with `await this.refreshHistory()`, which calls
`listSessions`. That query is:

```sql
SELECT s.*, COUNT(m.id) AS message_count,
  COALESCE((SELECT content FROM cowork_chat_message
            WHERE session_id = s.id AND content != '' AND prompt_excluded = 0 AND type != 'compact'
            ORDER BY sort_order DESC LIMIT 1), '') AS preview
FROM cowork_chat_session s
LEFT JOIN cowork_chat_message m ON m.session_id = s.id
GROUP BY s.id
ORDER BY s.updated_at DESC
```

So a metadata save that now writes **zero** message rows still joins every message of every session
and runs one correlated subquery per session, to recompute counts and previews that did not change.
The new `(session_id, sort_order)` index makes it far cheaper than it was, but the cost still scales
with the whole history of every conversation, on every save.

Before the incremental lanes this was hidden: the save itself already cost the whole session, so the
recount was a rounding error. It isn't any more.

## Repair contract

Proportionality again, not caching-for-its-own-sake.

- A save that changed only the session row should not make the history list recompute message
  counts and previews for conversations it did not touch.
- The list must stay correct without a cache that can silently go stale — the current query's one
  real virtue is that `messageCount` and `preview` are derived, so nothing can drift. Any stored
  counter has to be maintained in the same transaction as the row it counts, or it will drift.
- Prefer narrowing the refresh (update the one row the save touched) over adding denormalized
  columns. Reach for stored counters only if measurement shows the narrow refresh is not enough.
- Whatever lands must keep the ordering (`updated_at DESC`), the archived/active split, and the
  preview's existing exclusions (empty content, `prompt_excluded`, `compact`).

## Applied — 2026-09-18

**DAO.** `listSessions`'s projection moved into one shared `SESSION_SUMMARY_COLUMNS`, and
`getSessionSummary({ id })` reads a single session through it. Sharing the projection literally is
what keeps the narrow row and the list row from drifting: `messageCount` and `preview` stay
DERIVED, so there is no stored counter to maintain in the same transaction, which the repair
contract above explicitly preferred. `message_count` became a correlated `COUNT(*)` instead of
`LEFT JOIN … GROUP BY` — identical results (a session with no messages counts 0 either way), but
each session is answered from the `(session_id, sort_order)` index instead of joining the whole
table. `null` is returned when the row is gone, so a caller drops it rather than keeping a stale
entry.

**Store.** `refreshHistoryRow(sessionId)` replaces the whole-list reload at the end of every
successful save. It patches the one row in place and re-sorts on `updatedAt` descending, which
reproduces the query's `ORDER BY s.updated_at DESC`.

**One thing the narrowing had to preserve.** An empty `historySessions` means the startup load never
succeeded, and the documented recovery for that is "the next write re-pulls"
(`maestro-chat-blind-send-path-and-cowork-parity.md` #2). Narrowing every save would have removed
that recovery silently, so the narrow path only applies once there is a list to patch; with an empty
list it still falls back to the full pull. That fallback has its own test.

Untouched on purpose: the initial load, the post-delete refresh, and the two user-driven reloads
(the Sessions drawer, `sessionActions`). Those are not saves and run once.

## Verification

Both halves of the contract are asserted, because neither is visible from the other side.

**Equivalence and narrowness, against real SQLite** — `tests/maestro/chatHistoryRowIsNarrow.test.mjs`:

- `getSessionSummary(id)` **deep-equals** that session's entry in `listSessions()`, over a fixture
  with a busy session, an empty one, an archived one, and one whose newest messages are all excluded
  from the preview (empty content / `prompt_excluded` / `compact`). The derived fields are also
  spot-checked directly, so an equivalence that is "both wrong" still fails.
- A save to one session leaves every other session's row byte-identical.
- A missing or deleted session reports `null`.
- **The query plan** is asserted, not just the result: the message table is never `SCAN`ned for one
  session's summary, and the `(session_id, sort_order)` index carries both the count and the
  preview. A query that is narrow in its result but still scans the table would have moved no cost
  at all, and nothing in the result would reveal that.

**The store's half** — `tests/onlypreview/saveRefreshesOneHistoryRow.test.mjs` (shared, host-aware, byte-identical in both projects): the
saved session's row is the only one re-read and the list is never pulled; the patched list keeps
`updated_at DESC`; a vanished session leaves no stale row; a first save inserts a row the list has
never seen; an empty list still falls back to the full pull; a failed read keeps the list it had.

`tests/onlypreview/sessionSaveIsIncremental.test.mjs` was updated in the same change: it now extracts the real `refreshHistoryRow` and
asserts that a successful save re-reads exactly the session it saved and pulls no list.

Runs: DAO 4/4, store 6/6, incremental-save 8/8. Typecheck: the `shared`, `main`, `preload/maestro` and `renderer/maestro` surfaces each match their HEAD baseline, and no diagnostic falls in a touched file.

Not run: Electron E2E (CLAUDE.md). Owner step: the Sessions drawer still lists every conversation
with the right counts, previews and order after sending, renaming and archiving.

## Paired scope

Identical in Bitterless: `maestroChat.dao.ts` runs the same `LEFT JOIN` + `COUNT` + correlated
preview subquery, and its store awaits `refreshHistory()` on every save path too.
