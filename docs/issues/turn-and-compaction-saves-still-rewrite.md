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

> **Superseded by the audit below (2026-09-18). The order this section originally gave was wrong and
> would have caused silent message loss — it is kept here only so the correction has something to
> point at.** The original text: convert "turn finish / stop / recovered reply" first, "because the
> changed message is identifiable at the call site"; then steering and turn start; then compaction;
> and decide `updateSessionContextUsage` explicitly.

A site stays on `persistSession` until its audit is done. Partial conversion is fine; guessing is not.
That rule stands, and it is what the audit below applied.

## Audit — 2026-09-18 (both projects, read-only)

### The stated blocker is not a blocker

`updateSessionContextUsage` **cannot restamp an existing `tokenCount`**. Its write is
`message.tokenCount = message.tokenCount || safeTokenCount(...)`, which short-circuits on any truthy
value, and it skips `compressed` / `promptExcluded` messages entirely. The only transition it can
cause is `undefined | 0 → N`.

It would not matter if it could: **`tokenCount` is derived, and the stored column is write-only.**
The load path pipes every row through `withTokenCount`, which overwrites the persisted value
unconditionally from the message's own content. So failing to persist `tokenCount` for a message
outside the dirty set loses nothing the next load cannot rebuild, byte for byte.

**Conclusion: `updateSessionContextUsage` forces no site to keep the full rewrite.**

### The real blocker, which this doc did not know about

Several places **append a message to the timeline and never save it**. They rely on whatever full
rewrite happens next as a catch-all:

- the `type:'files'` attachment message, and the "could not attach N file(s)" bubble;
- error cards (`pushErrorCard`, including the compaction-failure path);
- task cards from `registerTaskBinding`, and every `message.tasks[]` tick below terminal;
- the recovered root human message of a crash-recovered turn;
- every mid-turn **sealed** assistant segment — `appendTimelineEntry` calls `sealSink`, which mutates
  the *previous* in-flight message and returns only the newly appended one;
- in Cowork additionally: drill notes, confirm cards, and confirm answers (see the parity note).

**Turn finish and stop are the flush point for all of it.** They are therefore the *least* isolated
sites in the file, not the most. Converting them to `persistMessages(session, [assistant])` on this
doc's original rationale would mean a user who sends a message with attachments sees the attachment
on screen and finds it gone after reload — exactly the silent loss this doc was written to prevent.

Note also that the doc's "`message.store`: both compaction saves" is **stale for Bitterless**:
`compactSessionIfNeeded` there is a stub (Pi's AgentSession schedules native compaction), and no
Bitterless compaction site calls `persistSession` any more. The two compaction saves are Cowork-only.

### Prerequisite, now done

`persistMessages` matched messages by **object identity** against a `reactive()` array, so a caller
holding the raw literal it had just pushed was dropped — and the call still answered `true`. Every
conversion below hands a message set to that lane, so none of them was safe until it was fixed:
[incremental-save-reports-unwritten-messages-as-saved.md](incremental-save-reports-unwritten-messages-as-saved.md).

### Corrected order

Provably isolated first. Each step keeps a downstream full rewrite as the backlog's flush point, so
no step can strand the appends listed above.

1. **`forceStop`'s silent-release branch** → `persistSessionMeta`. Zero messages change, provably:
   the branch requires no root human message and no host-authored turn, so no sink was ever created.
2. **The confirm-card sites that change exactly one message** → `persistMessages(session, [message])`:
   "answered elsewhere" and the user's own answer. One message each, already the live element,
   nothing else changes. *(Bitterless only — see the parity note.)*
3. **Turn start's accepted-root-message save, with its title sibling** — they are the two branches of
   one decision and must move together. One message; `sealSink` is provably a no-op there because the
   turn was just created with no assistant message.
4. **The new-confirm-card site** — three messages: the previous unanswered card, the appended card,
   and the sink that appending sealed. Requires capturing `appendTimelineEntry`'s return value, which
   is currently discarded.
5. **The task-snapshot save** — better restructured than converted: accumulate a `Set` across the
   whole loop and issue one `persistMessages` at the end, which is both one save instead of N full
   rewrites and a fix for the running-task and sealed-sink gaps.
6. **Steering** (accepted / merged / failed). Mechanically fine once the pre-append sink is captured,
   **but not before step 7** — today they double as mid-turn checkpoints for the in-flight turn.
7. **Introduce a turn-scoped dirty ledger, then convert turn finish and stop.** A `Set` of message
   ids on the turn, written by the five places that touch a message during one — `appendTimelineEntry`,
   `ensureSink`, `sealSink`, `appendStreamDelta`, `finishAssistant` — and seeded from the recovered-turn
   path. This removes the enumeration guesswork instead of re-deriving it per site, and it is the only
   way found to convert these two without silent-loss risk.
8. **The crash-repair backstop in `send`'s `finally` stays on the full rewrite permanently.** It fires
   only when turn finish threw midway, i.e. exactly when the turn's messages are half-mutated and
   unsaved; a total checkpoint is its entire value, and it costs nothing because it ~never fires.

### Also found: metadata-only saves that were not on anyone's list

These do a full rewrite — delete every message row, re-insert, deep-clone every message — for a
change that touches no message at all. They bypass `persistSession` (they call `saveSession`
directly), which is why a grep for `persistSession(` missed them:

- **Cowork** — `mutateSessionMetadata` (the shared body of archive / restore / rename / restore-title)
  and `requestSessionTitle`.
- **Bitterless** — `setArchived`, `renameSession` and `applySessionTitle`, each calling
  `saveSessionNow(session)` with no `write` override.

All are `meta`. They are the cheapest conversions in either file and carry no dirty-set question.
They keep their hand-rolled fences and rollbacks, which is the only reason they are not a one-liner.

### Parity note for Ral — a real divergence, not a conversion artifact

Bitterless persists a confirm card when it appears, when it is answered elsewhere, and when the user
answers it. **Cowork does none of the three.** Today a Cowork confirm card and its answer survive a
crash only if some later full rewrite happens to run. That is pre-existing, and it becomes a *loss*
rather than a *latency* the moment Cowork's turn-lifecycle sites stop being full rewrites. Under the
paired-development rule this is common functionality with a one-sided implementation; nothing was
changed, because closing it is a product decision about what a pending confirmation means after a
restart.

## Verification

Per site: the messages it writes are exactly the ones it changed (counted, as in the other issues),
and a read-back after the operation deep-equals the in-memory session. The existing turn, steering,
compaction and archive suites must pass unchanged.

## Paired scope

Same call sites exist in Bitterless over `queueSessionSave` / `saveSessionNow`; convert each side
together so the two do not drift.
