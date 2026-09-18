# `persistMessages` reported success for messages it never wrote

**Status:** Fixed in both projects, with a red-checked guard. Found on 2026-09-18 while auditing
[turn-and-compaction-saves-still-rewrite.md](turn-and-compaction-saves-still-rewrite.md); it is a
defect in the lanes that [the incremental-save work](session-save-rewrites-the-whole-session.md)
introduced, not in the callers.

## What happened

`persistMessages(session, changed)` resolved each message's `sortOrder` with

```ts
const persisted = session.messages.filter((message) => !message.localOnly)
persisted.indexOf(message)
```

`session.messages` lives in `reactive()`, so **`filter` hands back proxies**, while a caller that
just built and pushed a message holds the **raw literal**. Probed against the installed `vue@3.5`:

```
filter yields proxy?  true
indexOf(raw literal) = -1
indexOf(proxy elem)  =  0
```

An unmatched entry was silently dropped, and when every entry was dropped the call fell through to

```ts
if (!ordered.length) return this.persistSessionMeta(session)   // ← returns TRUE
```

— so the lane **answered `true` for a message it had not written**.

## Why that is worse than a slow save

At least one caller treats that answer as durable. `applyWorkflowCompletion`
([`message.store.ts`](../../src/renderer/maestro/control/src/store/message.store.ts), the
`workflowUnsaved` branch) does:

```ts
session.messages.push(appended)                                   // raw literal
if (await this.persistMessages(session, [appended])) this.workflowUnsaved.delete(id)
```

`workflowUnsaved` is the retry ledger. A false `true` **retires the retry**, so the
workflow-completion message is rendered on screen and then absent after a reload, with nothing
logged. It is intermittent by construction: `loadPersistedSession` returns the reactive element when
the chat is already in `this.sessions` (the common case, which fails) and a raw local object when it
was just loaded from the database (which happens to work).

## Fix

Two changes, both in `persistMessages`, in both projects:

1. **Resolve by `id`, not by object identity**, and serialize the live element that was found — so a
   caller holding a raw literal, a proxy, or a copy all write the same row. This removes the class,
   rather than asking every caller to remember which side of the reactive boundary it is on.
2. **Never report success for a message that is not in the session.** A non-`localOnly` message that
   cannot be located returns `false` with a warning. The pre-existing `localOnly` fallback is kept
   and is unchanged: those are legitimately never written, and a request to write only those is
   still a metadata save.

Not changed: the callers. `applyWorkflowCompletion` now simply keeps its retry when a save really
did not happen.

## Verification

`tests/onlypreview/sessionSaveIsIncremental.test.mjs` (shared with Cowork, byte-identical) grew two
cases, and both were **red-checked against the old `indexOf` implementation**:

| case | old impl | fixed impl |
| --- | --- | --- |
| a caller holding a different object for the same message | ✗ 0 rows written, reported `true` | ✓ 1 row, correct `sortOrder` |
| a message that is not in the session at all | ✗ reported `true` | ✓ `false`, and no metadata save either |

Full runs: Bitterless `8/8`, Cowork `8/8`; the six pre-existing cases pass unchanged on both
implementations, so the two new ones are the only thing the change moved.

Typecheck: no diagnostic in any touched file on either side (Bitterless `shared` / `renderer/maestro`
surfaces and Cowork `typecheck:node` all match their HEAD baselines).

Not run: Electron E2E (CLAUDE.md).

## Consequence for the deferred work

This is why [turn-and-compaction-saves-still-rewrite.md](turn-and-compaction-saves-still-rewrite.md)
could not have been converted safely before now: every conversion hands a message set to this lane,
and until today the lane could drop the set and still answer `true`.
