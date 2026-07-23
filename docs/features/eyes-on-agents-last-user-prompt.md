# EyesOnAgents Last User Prompt

Status: compact card disclosure implemented and independently statically reviewed; owner verification pending

Date: 2026-07-21

Implementation tasks: [eyes-on-agents-last-user-prompt-016](../plan/tasks/eyes-on-agents-last-user-prompt-016.md),
[eyes-on-agents-silent-focus-polling-018](../plan/tasks/eyes-on-agents-silent-focus-polling-018.md),
[eyes-on-agents-tiered-all-polling-019](../plan/tasks/eyes-on-agents-tiered-all-polling-019.md),
and [eyes-on-agents-thread-ingestion-prompt-card-020](../plan/tasks/eyes-on-agents-thread-ingestion-prompt-card-020.md)

## Decision

EyesOnAgents may retain one narrow piece of Codex conversation content per thread: the latest
textual user prompt. It must not retain an earlier user prompt, assistant response, reasoning,
tool call, tool result, approval detail, diff, attachment, or transcript.

Prompt retention is a separate explicit preference named **Store latest user question**. It is
default-off for existing and new installations. **Enable Codex observation** continues to authorize
lifecycle metadata only; it must not silently authorize content after an upgrade. Live capture and
targeted App Server recovery both require the prompt preference to be enabled.

Enabling the preference writes one content-free capability marker at
`<userData>/eyes-on-agents/last-user-prompt.enabled`. It is a sibling of
`<userData>/eyes-on-agents/codex-hook-outbox`, never a child of the recursively removable outbox.
The stable helper derives the marker with `join(dirname(outboxPath),
"last-user-prompt.enabled")`, so the Hook command and Codex trust hash do not change. Disabling
removes the marker, fences in-flight prompt writes, and clears every persisted prompt preview while
leaving lifecycle observation installed.

The persisted value is a preview with a maximum of 8,192 UTF-8 bytes. `truncated` makes the bound
visible. Exact content beyond that bound is intentionally unsupported; adding it requires a new
privacy contract.

## Definition

“Last user prompt” means the newest textual prompt submitted by the user for one Codex thread:

- Hook source: `UserPromptSubmit.prompt`, associated with `session_id` and `turn_id`.
- App Server recovery: textual segments from the newest `userMessage` item found through the
  bounded history API.
- Images and non-text attachments are ignored rather than described or serialized.
- `thread/list.preview` is never used because it is not a latest-message contract.
- `Stop.last_assistant_message` is always discarded and never used as prompt data.

Official protocol basis:

- [Codex `UserPromptSubmit` Hook](https://learn.chatgpt.com/docs/hooks#userpromptsubmit)
- [Codex `Stop` Hook](https://learn.chatgpt.com/docs/hooks#stop)
- [Codex App Server API](https://learn.chatgpt.com/docs/app-server#api-overview)

## Data flow

```text
Codex UserPromptSubmit
        |
        | full prompt exists only in Hook input memory
        v
Node-only helper -- capability marker enabled? -- no --> metadata-only event
        |
       yes
        |
        +---- bound to <= 8,192 UTF-8 bytes -------> live bridge V2
        |                                               |
        | send/ACK unavailable                          | trusted admission
        v                                               v
metadata-only outbox                           SQLite atomic update + receipt
(prompt removed)                                (one latest preview per thread)
        |                                               |
        +---------------- replay metadata --------------+
                                |
                                | preview becomes pending
                                v
                    tiered All App Server recovery
                    thread/read(includeTurns: false)
                          -> one bounded thread/turns/list(itemsView: full)
                                |
                                v
                    same conditional SQLite upsert
```

The full raw Hook input is never serialized. When the capability marker is absent, the helper drops
the prompt without deriving a preview. When present, it derives the bounded preview immediately,
then releases the raw input. If live delivery does not receive a commit acknowledgement, the helper
strips the preview before creating an outbox file. Quarantine, coverage-gap, and receipt records are
therefore also content-free.

This outbox rule is mandatory. Persisting Hook prompt content per delivery would retain several
historical prompts while Bitterless is closed, contradicting the one-latest-prompt boundary.

## Live Hook contract

The Hook bridge becomes a backwards-compatible union:

- V1 events remain metadata-only and must continue to replay after upgrade.
- The helper emits V2 events. Only a V2 `UserPromptSubmit` event may contain
  `userPromptPreview` and `userPromptTruncated`.
- `SessionStart`, `PermissionRequest`, and `Stop` reject prompt fields.
- A V2 event written to the offline outbox must be converted to its metadata-only form while
  retaining the same delivery ID, thread ID, turn ID, event time, and lifecycle meaning.
- Prompt parsing is content-specific: multiline text is allowed, NUL is rejected, empty/whitespace
  input is unavailable, and truncation must preserve valid Unicode.

The capability marker is an atomic, content-free file whose existence means enabled. It contains no
prompt or credential and inherits private `userData` permissions. Its explicit sibling location
survives `CodexDesktopBridgeService.remove()`, which may recursively remove only
`codex-hook-outbox`; uninstalling lifecycle Hooks therefore does not silently change the separate
prompt-retention preference. The helper-side marker check is a data-minimization optimization; the
main listener checks the current preference again immediately before persistence and is the
authoritative gate.

The existing trust inspection, admission epochs, bounded in-memory queue, serialized SQLite write
tail, commit acknowledgement, persistent delivery receipt, and duplicate handling remain
authoritative. Adding preview data must not bypass or weaken them. The stable Hook command does not
change, so preference changes and application upgrades must not provoke a new Codex trust prompt.

Disabling prompt retention establishes a new prompt-admission epoch, prevents queued/live events
from persisting content, waits for any already-started prompt transaction, then clears all six
prompt columns. Lifecycle metadata in the same deliveries still commits normally.

An invalid prompt value degrades that delivery to metadata-only and marks recovery pending while
preserving the lifecycle event. Invalid content is intentionally indistinguishable from another
content-free delivery at the listener, so this degradation is silent and never logs the rejected
value.

## Tiered All-thread App Server recovery

App Server is compensation, not a transcript crawler. The renderer exposes only the parameter-free
semantic operation `refreshThreadPages()`; Main and the SQLite repository select already persisted,
non-archived All rows. The renderer cannot provide IDs, page numbers, page size, an App Server
method, cursor, limit, or arbitrary JSON-RPC payload. Prompt recovery is skipped before contacting
Codex unless the explicit preference is enabled.

The scheduler owns a fixed 40-row logical page size. Every admitted ten-second tick snapshots the
current recency order, processes page 1 first, then processes one cold page in the cycle
`2 -> 3 -> ... -> last -> 2`. One tick therefore reads at most 80 threads. The order is
`COALESCE(last_activity_at, updated_at) DESC`, `updated_at DESC`, then `thread_id ASC`; Project and
title filters, Domain assignment, Focus membership, and renderer attention sorting never change
coverage. Page 1 and its current cold page are selected before either batch writes, hot and cold
batches run sequentially, and a cold cursor advances only after its batch completes.

For each selected row, Main captures a request evidence time, then calls
`thread/read({ threadId, includeTurns: false })` to obtain the narrow title/status projection plus a
provider-activity watermark. A lifecycle notification that arrives while the read is pending remains
newer than that response; an equal-millisecond polling status also yields to the already persisted
lifecycle state. At most four row pipelines run concurrently within each 40-row batch. A newer
reliable watermark advances `last_activity_at` monotonically so newly active rows enter the next hot
page. Prompt content is requested only when
the watermark is newer than `last_user_prompt_checked_at` or the row has never been checked. The
content read uses descending one-turn pages:

```text
thread/turns/list({
  threadId,
  cursor: null,
  itemsView: "full",
  sortDirection: "desc",
  limit: 1
})
```

Codex 0.137 declares `thread/turns/items/list` in generated schemas but returns JSON-RPC `-32601`
because the method is not implemented. EyesOnAgents therefore never calls it. `itemsView: "summary"`
is also insufficient because it keeps only the first user message in a turn and can miss a later
same-turn steer.

EyesOnAgents follows the validated `nextCursor` through at most ten turns and stops as soon as the
newest textual `userMessage` is found. Each page is visited newest-item-first; only textual content
segments are concatenated in original segment order and bounded to 8,192 UTF-8 bytes. All other
items are discarded immediately. This preserves same-turn steer while avoiding one response that
aggregates ten complete turns. If no scanned turn contains a textual user message, the row is marked
checked/pending at the provider activity watermark without fabricating content; the same unchanged
rollout is not replayed again ten seconds later.

Ordinary App Server responses and notifications retain a 4 MiB UTF-8 frame limit. A complete
response may use the separate 16 MiB cap only when its numeric ID matches a pending,
Bitterless-authored `thread/turns/list(itemsView: full)` request. The parser consumes complete JSONL
frames before checking its unfinished residual buffer, and its UTF-8 decoder preserves characters
split across stdout chunks. An unfinished frame may never exceed the 16 MiB absolute cap.

Do not use `thread/read({ includeTurns: true })`: it returns full history. Full inventory Refresh and
activation never fetch prompt content; they remain the discovery/archive fallback, while the tiered
poll eventually covers every already persisted non-archived row. App Server response objects,
assistant content, tools, reasoning, and earlier user messages never leave main-process call scope.

App Server may transiently return unrelated items in the bounded response. They remain inside the
main-process call scope and must never be copied, logged, persisted, broadcast, or returned.

## Connections control

Task 018 adds one compact preference row inside the existing Codex observation card; task 016
reuses it for live Hook admission and does not add a modal, onboarding page, or board column.

```text
┌ Codex observation ───────────────────────────────────────┐
│ Installed · Listener active                             │
│                                                        │
│ Store latest user question                  [ Off  ○ ]  │
│ Keeps one local preview per thread. No responses or     │
│ transcript history are stored.                          │
└────────────────────────────────────────────────────────┘
```

| state | control behavior |
|---|---|
| default / upgraded | Off; lifecycle Hooks continue metadata-only |
| enabling | disable the switch, atomically create the capability marker, then show On |
| enabled | live capture and targeted recovery are allowed |
| disabling | disable the switch, fence prompt writes, remove the marker, clear cached previews, then show Off |
| error | retain the last committed preference, show the existing bounded action error, allow retry |

The label, description, current state, and error are available to assistive technology. The switch
uses `size="small"` and the existing background hierarchy; it adds no decorative border or shadow.

The always-visible Connections guide names this as a fourth, independent step after Hook
installation, Codex trust review, and status verification:

```text
Codex observation setup
1 Install or repair lifecycle Hooks
2 Review Codex-flagged Hooks when requested
3 Check observation status in Bitterless
4 Optional content: Store latest user question is Off by default
  Enabling stores one bounded local preview; disabling clears all saved previews
```

Step 4 must not imply that Hook installation or trust grants content permission. It repeats the
narrow boundary: no replies, reasoning, tools, attachments, earlier questions, or transcript
history are retained.

Preference transitions are atomic from the product's perspective. If enabling creates the marker
but the final snapshot cannot be loaded, Main removes the marker again before returning the original
error. Disabling first advances the prompt-admission epoch and removes the marker, then waits for a
running tiered refresh and clears SQLite directly. If that clear fails, Main best-effort restores the
previously enabled marker, advances the epoch again, and returns the original clear error. A later
disable retry always calls the repository clear even when the marker is already absent.

## Persistent state

The content-free capability marker owns the opt-in preference. The existing encrypted Core SQLite
`eyes_on_agents_thread` row owns the one retained preview:

| column | type | contract |
|---|---|---|
| `last_user_prompt_preview` | `TEXT NULL` | bounded textual prefix; `NULL` when unavailable or pending |
| `last_user_prompt_turn_id` | `TEXT NULL` | Hook/App Server turn identity when available |
| `last_user_prompt_at` | `INTEGER NULL` | source event/turn time normalized to milliseconds |
| `last_user_prompt_truncated` | `INTEGER NOT NULL DEFAULT 0` | boolean bound indicator |
| `last_user_prompt_source` | `TEXT NULL` | `codex_hook` or `app_server` |
| `last_user_prompt_checked_at` | `INTEGER NULL` | content-free provider activity watermark for suppressing unchanged recovery reads |

Availability is derived without another column:

```text
unavailable = preview NULL, turn_id NULL, prompt_at NULL
pending     = preview NULL, turn_id or prompt_at present
available   = preview non-NULL
```

The normalized renderer/main contract is:

```ts
type EyesOnAgentsLastUserPromptState = "available" | "pending" | "unavailable";

interface EyesOnAgentsLastUserPrompt {
  state: EyesOnAgentsLastUserPromptState;
  preview: string | null;
  turnId: string | null;
  observedAt: string | null;
  checkedAt: string | null;
  truncated: boolean;
}
```

`EyesOnAgentsThread.lastUserPrompt` exposes this normalized value in the existing snapshot. Task 019
updates it through the parameter-free tiered All refresh; no arbitrary or per-ID content read is
exposed to the renderer. Task 020 renders the normalized value without adding another content-read
surface:

- `available`: one muted, single-line question echo between the title and action row, with display
  whitespace folded and overflow ellipsized;
- `pending`: one muted localized **last user question pending** line, which describes state without
  claiming that an App Server request is currently running;
- `unavailable`: no question row, so default-off and never-captured cards keep their previous
  compact height.

The stored 8 KiB value remains unchanged; whitespace folding is presentation-only. The available
row's native tooltip and accessible card label receive the full stored bounded preview. When
`truncated` is true, localized wording explicitly says the preview is truncated. The row adds no
icon, badge, border, background, spinner, or separate status region.

When the capability marker is off, Main defensively normalizes every snapshot prompt to
`unavailable` with null preview, turn, observed/check times, and `truncated: false`, even if an older
database or failed cleanup still contains cached values. This read-time redaction never substitutes
for cleanup: the disable operation still invokes `clearLastUserPrompts()` directly on every retry.

`EyesOnAgentsSnapshot` also exposes `lastUserPromptCaptureEnabled` so the Connections panel can
render the explicit preference without reading marker files in the renderer. The only mutation is
`setLastUserPromptCaptureEnabled({ enabled: boolean })`; it accepts no file path or content.

## Ordering and atomicity

All writes are conditional and monotonic:

1. A newer `UserPromptSubmit` replaces the previous prompt.
2. A newer metadata-only submission clears the previous preview and records the new turn/time as
   pending, so EyesOnAgents never labels an older question as current.
3. An older replay is acknowledged but cannot overwrite newer prompt state.
4. Equal-time conflicts prefer the existing value; App Server may only fill an existing pending
   record for the same non-null turn when it supplies a non-null preview. A content-free App Server
   result never downgrades an available value or changes a Hook-owned pending source. One additional
   same-turn case is allowed: an existing App Server preview may update from a later checked
   watermark when the new preview is non-null. This captures a later steer whose provider turn
   start time is unchanged. An available Hook preview for that same turn is never replaced, even
   when the App Server reports a later completion time; only its checked watermark may advance.
5. App Server converts validated `Turn.startedAt`/`completedAt` Unix seconds to safe integer
   milliseconds before comparison. Outside the same-turn available-Hook protection in #4, a
   reliably newer value may replace the prior value or establish a newer pending state, while an
   older value is rejected. Without a comparable reliable time it may only perform the same-turn
   pending-to-available fill from #4; that fill preserves the stored turn/time identity. The
   content-free checked watermark may still advance monotonically when the prompt merge itself is
   rejected.
6. Hook delivery receipt insertion, lifecycle transition, and prompt-state mutation commit in the
   same SQLite transaction.

Archive/unarchive, Domain movement/deletion, unread changes, thread opening, and title refresh do
not clear or rewrite the prompt. Disabling lifecycle observation stops Hook delivery but does not
change the separate prompt preference or cached value. Disabling **Store latest user question**
removes the capability marker and clears every cached preview without removing Hooks or changing
runtime/unread evidence.

## Failure contract

- Disabled prompt retention silently skips content capture before contacting App Server and rejects
  Hook content at the main-process persistence gate. Lifecycle metadata remains admissible.
- A single paged-row App Server failure skips that row, preserves its stored prompt and check
  watermark, and does not enter the foreground action-error surface.
- A Hook prompt parse failure degrades only that delivery to metadata-only pending state. The
  lifecycle transition still commits, and errors never include the rejected value.
- A recovery failure preserves the newest stored prompt state and does not change runtime, unread,
  connection intent, Domain, archive, or title state.
- Prompt capture failure must not suppress the associated lifecycle event.
- No fallback may inspect Codex JSONL transcripts or private Desktop stdio.

## Privacy and disclosure

- At rest, Bitterless retains at most one bounded prompt preview per thread in encrypted SQLite.
- Existing users remain default-off after upgrade; no trusted metadata-only installation starts
  retaining prompts until its owner explicitly enables the separate preference.
- Hook outbox, quarantine, receipts, logs, errors, telemetry, exports, raw inventory snapshots, and
  settings never receive prompt text from this capability.
- Renderer snapshots receive only the allowed bounded preview, never App Server response objects.
- Assistant output, reasoning, tools, diffs, approvals, attachments, and earlier user prompts remain
  prohibited.
- The Connections guide must provide the default-off **Store latest user question** control and
  disclose that it stores one bounded preview locally, while lifecycle observation itself remains
  metadata-only and no transcript or response content is retained.

## Migration and compatibility

- Add an idempotent `ensureEyesOnAgentsLastUserPromptSchema` migration for all six columns and register it in both
  `finalizeCoreSqliteSchema` and the ordered Core migration manifest.
- Use a new 12-digit `YYMMDDHHmmss` migration version allocated at implementation time.
- Ensure `package.json.version_code` is a 12-digit build timestamp at least as new as that migration
  while preserving unrelated package metadata; the migration audit must never see a future
  migration relative to the application version.
- Existing rows migrate to `unavailable`; do not derive a prompt from `title`, `preview`, or the raw
  `thread/list` snapshot.
- The capability marker is absent after every upgrade unless the user enabled it through the new
  control; migration must not infer consent from installed/trusted Hooks.
- V1 Hook outbox files remain replayable and create pending prompt state only for their
  `UserPromptSubmit` lifecycle event.
- The retained multi-version SQLite audit must cover direct upgrades from every stored baseline.

## Acceptance criteria

- Two live prompts for one thread leave only the second preview in SQLite and snapshots.
- Upgrading an existing trusted metadata-only Hook installation leaves prompt retention disabled;
  UserPromptSubmit continues to update lifecycle without storing content.
- Enabling the preference does not rewrite Hook definitions or require trust again. Disabling it
  fences races, removes the marker, clears all cached previews, and preserves lifecycle evidence.
- Multiline and Unicode input remains valid; a value over 8,192 UTF-8 bytes is safely truncated and
  marked without exceeding the 64 KiB live Hook frame. Offline files remain prompt-free and below
  their separate 16 KiB envelope limit.
- `Stop.last_assistant_message` and prompt fields on non-`UserPromptSubmit` events never cross the
  bridge contract.
- Offline and lost-ACK deliveries write metadata-only outbox files; no prompt fragment appears in
  pending, quarantine, coverage, receipt, or log data.
- Metadata-only replay changes the prompt state to pending without leaving an older preview visible.
- Tiered All recovery finds the newest textual `userMessage`, including same-turn steer, through at
  most ten descending one-turn `thread/turns/list(itemsView: "full")` pages and persists only its
  bounded preview. An unchanged checked thread does not replay the rollout on the next poll.
- App Server Unix-second turn times are validated and normalized to safe integer milliseconds
  before they can compete with Hook timestamps.
- Out-of-order replay, duplicate delivery, and a concurrent App Server result cannot overwrite a
  newer Hook prompt.
- Explicit disconnect intent, Hook trust, lifecycle Focus/unread behavior, archive reconciliation,
  and thread title refresh remain unchanged.
- Available and pending latest-question states render as one quiet optional ThreadCard line;
  unavailable renders no line, and truncation is disclosed in tooltip/accessibility text.
- The Codex observation guide includes a fourth independent-content step that says the preference
  is off by default, disabling clears saved previews, and no response or history content is kept.
- Fresh and multi-version SQLite migrations, repository tests, Hook delivery tests, App Server
  tests, XPC/core tests, UI disclosure guards, typechecks, and the migration audit pass without
  launching Electron.
