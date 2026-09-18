# Every save recounts every message of every session

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

## Verification

Assert the cost as a count, as with the other two issues: a save that touched one session must not
read rows belonging to other sessions, and the history list's contents must be identical to what the
current query produces for a fixture with several sessions, archived ones included.

## Paired scope

Identical in Bitterless: `maestroChat.dao.ts` runs the same `LEFT JOIN` + `COUNT` + correlated
preview subquery, and its store awaits `refreshHistory()` on every save path too.
