# Saving a chat costs the whole session (paired with Cowork)

Same defect, same shape. The investigation, the measurements that exposed it and the full design are
in [Cowork's issue](../../../micromeet-cowork/docs/issues/session-save-rewrites-the-whole-session.md);
this records the Bitterless side.

## Confirmed identical here

`src/preload/maestro/sqlite/maestroChat.dao.ts` ran `DELETE FROM cowork_chat_message WHERE
session_id = ?` followed by one insert per message on every save, and `cowork_chat_message` had no
index on `session_id` — so a save cost the whole history, and every per-session read scanned every
message of every session.

## Applied

- `MaestroChatSession` now extends a messages-free `MaestroChatSessionMeta`, and the DAO exposes
  `saveSessionMeta` / `saveMessages` / `saveSession`. All three bind rows through one shared
  `messageRowValues`, so an incremental write and a full rewrite cannot disagree about a row.
- `saveSessionNow` grew an optional `write`, so the account fence, the identity check, the usage
  refresh and the history reload stay in one place while the payload varies. `persistSessionMeta`
  and `persistMessages` sit on top of it, both still queued through `queueSessionSave`.
- `toStoredSession` is now a composition of `toStoredSessionMeta` + `toStoredMessage`, which is what
  lets the lanes share serialization instead of duplicating the field-by-field enumeration that this
  file's own comments warn about.
- `(session_id, sort_order)` index added with `IF NOT EXISTS`, so existing databases build it on the
  next open.
- Routed to the metadata lane: `chooseWorkspace`, `stopUsingWorkspace`, `adoptPreviewWorkspace`, the
  vanished-directory branch of `refreshWorkspace`, and `applyWorkspaceBroadcast`. Routed to the
  message lane: both workflow-completion saves.
- **Deliberately still full rewrites**, as in Cowork: turn-lifecycle and compaction saves, which can
  change several messages at once and need a per-site audit before their dirty set can be trusted.

## One host difference, recorded rather than hidden

Bitterless re-checks the account **after** the write returns; Cowork's lane only checks before it.
That divergence predates this change and is left alone — the shared test asserts each host's actual
behavior instead of pretending they match, and asserts that whatever each host does, it does
identically across all three payload sizes.

## Verification

`tests/onlypreview/sessionSaveIsIncremental.test.mjs` (shared with Cowork, host-aware): **6/6**.
Metadata writes zero message rows and clones nothing; appending one message to a 500-message session
writes one row and clones one message; `sortOrder` skips `localOnly` exactly as a full rewrite would
number it; and the incremental row is `deepEqual` to the row the rewrite would have stored.

Typecheck surfaces `shared` 3, `main` 63, `renderer/maestro` 4 — all identical to baseline.
