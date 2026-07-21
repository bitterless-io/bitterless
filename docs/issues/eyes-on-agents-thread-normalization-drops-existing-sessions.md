# EyesOnAgents drops existing Codex threads during normalized ingestion

状态：修复已实现，待 Ral 运行验证

Implementation: [eyes-on-agents-thread-ingestion-prompt-card-020](../plan/tasks/eyes-on-agents-thread-ingestion-prompt-card-020.md)

## Report

Affected Codex thread: `019f20ef-0a63-71f2-9499-574405e85057`.

Two user-visible symptoms share one ingestion failure chain:

1. The existing, non-archived pinned thread is absent from **All** after a full Refresh.
2. Activating that thread creates an EyesOnAgents row whose card reads
   `Untitled Codex task · 019f20ef` instead of the Codex session name `OPS aliyun`.

## Confirmed evidence

- Codex `state_5.sqlite` contains the thread with `archived = 0`; Codex Desktop global state includes
  it in `pinned-thread-ids`.
- Bitterless received the thread from App Server. Its persisted raw snapshot contains the correct
  ID, `name = "OPS aliyun"`, and `status.type = "notLoaded"`.
- That raw snapshot has a 322-character multiline `preview`.
- The current Bitterless normalized row has `title = NULL`. It was first created by the Hook/runtime
  path when the thread became active, then remained untitled through a later full snapshot sync.
- A read-only 2026-07-21 audit of the active development database found 97 active raw snapshots and
  30 without normalized rows. Twenty-six of those missing rows have a valid non-empty name together
  with a preview that the current 300-character/single-line validator rejects. The bug is therefore
  broader than this one thread.

Pinned is not causal. EyesOnAgents does not request, store, or filter by Codex Desktop pin state, and
the target raw snapshot proves `thread/list` pagination already returned it. **All** must include a
valid non-archived thread independently of whether Codex pins it.

## Confirmed root cause

`parseThreadEntry()` in `src/main/eyesOnAgents/eyesOnAgents.service.ts` parses a valid `name`, then
unconditionally parses `preview` before choosing `name ?? preview`. `parseEyesOnAgentsText()` rejects
text longer than 300 characters and any CR/LF. The target preview violates both rules, so the outer
catch returns `null`. `performSync()` silently removes that entry from the normalized collection.

Raw snapshot persistence and normalized persistence are separate. The raw snapshot succeeds, but
`upsertDiscoveredThreads()` never receives the rejected thread, so a previously unknown thread has
no row for **All**.

When a Hook or App Server lifecycle event later activates an unknown thread,
`applyRuntimeEventInTransaction()` creates the missing normalized row with `title = NULL`. Runtime
events carry thread/turn/state/cwd metadata, not the Codex session name, and that transaction neither
reads the existing raw snapshot nor performs an immediate targeted `thread/read`. `ThreadCard` then
uses its Untitled fallback.

The ten-second tiered All refresh is only asynchronous compensation. When the EyesOnAgents renderer
is mounted and App Server connection intent permits it, the row will eventually enter a 40-thread
hot or cold batch whose name-first `thread/read` projection can repair this title. A skipped or
rejected read is still silent, while window-activation full sync uses the broken
`parseThreadEntry()` path. Therefore polling is not a reliable ingestion guarantee or a diagnosable
fallback for this bug.

## Required correction

1. Separate thread admission from optional display-field parsing. A valid thread ID must not be
   discarded because an optional `preview`, name fallback, status detail, or other display field is
   malformed.
2. Resolve title lazily: accept a valid bounded `name` first; inspect `preview` only when name is
   absent. A preview fallback must fold line breaks and truncate to the display bound rather than
   reject the whole thread.
3. Preserve the complete provider object only in the existing raw snapshot table. Persist only the
   normalized bounded title in the thread row.
4. After an activation event creates a previously unknown row, enrich its missing title from the
   already persisted raw snapshot or one targeted `thread/read`. Apply the title only when it differs
   and do not expand the background poll into full inventory work.
5. Keep background behavior visually silent, but retain enough bounded diagnostic state to
   distinguish a skipped title enrichment from a rejected App Server response.
6. The next successful Refresh must repair existing missing rows and `NULL` titles; no destructive
   migration or manual reclassification may be required.

Increasing the text limit alone is not a fix: the reported preview also contains line breaks, and
future previews may be longer.

## Acceptance

- A valid non-archived thread with `name = "OPS aliyun"` and a multiline preview longer than 300
  characters appears in **All** after Refresh without requiring activation.
- The affected thread displays `OPS aliyun`, not the Untitled fallback.
- Pinning or unpinning the thread in Codex does not change **All** membership.
- A malformed optional preview cannot prevent a valid ID/name/cwd row from being inserted or
  updated; only the invalid fallback field is omitted.
- Activating a previously unknown thread may briefly create metadata-only state, but connected title
  enrichment repairs it without a full inventory write and exposes a bounded failure reason when it
  cannot run.
- Existing Domain assignment, unread state, archive state, and raw snapshots survive the repair.
- Regression coverage includes long previews, multiline previews, valid name plus invalid preview,
  name-less preview fallback, and Hook-first activation followed by title enrichment.

## Resolution

Task 020 separates UUID admission from optional display fields and uses one name-first title
normalizer across full inventory, targeted reads, and raw-snapshot recovery. Lifecycle persistence
can atomically recover a stored title; otherwise it schedules one non-blocking title-only read with
a NULL-title compare-and-set and bounded drawer diagnostic. The reported valid-name/long-multiline-
preview shape is now admitted and the next successful full Refresh repairs both missing rows and
NULL titles without changing Domain, unread, archive, Project, or raw snapshot data.

Independent static review accepted the implementation. Runtime confirmation for the reported
thread remains with Ral by request.
