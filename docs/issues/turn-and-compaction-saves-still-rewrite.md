# Turn-lifecycle and compaction saves still rewrite the whole session

Deliberately deferred by [the incremental-save work](session-save-rewrites-the-whole-session.md) on
2026-09-18, and recorded here so it is a decision rather than an omission.

## What is left

Metadata and single-message saves now write what changed. These call sites still go through the full
rewrite — delete every message row of the session, re-insert them all, and deep-clone every message
on the renderer side:

- `turn.service`: steering applied, turn start, turn finish, recovered replies, stop.
- `message.store`: both compaction saves.

They run a few times per turn rather than per token, so they were never the pathology behind the
2026-09-18 outage. But in a long conversation each one still costs the entire history, which is
exactly the property the incremental lanes exist to remove.

## Why they were not converted with the rest

Each can change several messages at once, and the set is not obvious from the call site:

- compaction flags an arbitrary number of messages `compressed` **and** appends a summary entry;
- a turn boundary touches the in-flight assistant message plus state that is not clearly scoped to
  one message (`updateSessionContextUsage` can restamp `tokenCount` on many).

Enumerating that dirty set wrongly does not fail loudly — it silently never writes an edit the user
can see on screen. That is a worse failure than the cost being wrong, so converting them needs a
per-site audit rather than a pattern-match.

## Repair contract

One site at a time, each with its own test, in this order (cheapest and most isolated first):

1. **Turn finish / stop / recovered reply** — the changed message is identifiable at the call site.
2. **Steering and turn start** — establish first whether anything other than the in-flight message
   and session metadata actually changes; if not, these become a message save plus a metadata save.
3. **Compaction** — the flagged set is known inside the loop that flags it, so it can be collected
   there and handed to `persistMessages` together with the appended summary.

`updateSessionContextUsage` needs deciding explicitly: if it can restamp `tokenCount` on messages
outside the dirty set, either it reports what it touched, or those sites keep the full rewrite.

A site stays on `persistSession` until its audit is done. Partial conversion is fine; guessing is not.

## Verification

Per site: the messages it writes are exactly the ones it changed (counted, as in the other issues),
and a read-back after the operation deep-equals the in-memory session. The existing turn, steering,
compaction and archive suites must pass unchanged.

## Paired scope

Same call sites exist in Bitterless over `queueSessionSave` / `saveSessionNow`; convert each side
together so the two do not drift.
