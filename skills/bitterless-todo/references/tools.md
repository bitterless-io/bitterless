# Bitterless Todo MCP tools

The production tools operate the user's personal, multi-device-synchronized Todo store. Bitterless
owns synchronization; MCP calls read and write the local production app. All tools return MCP
`content` plus machine-readable `structuredContent`; use `structuredContent` for decisions and
assertions. Timestamp arguments are nonnegative integer Unix milliseconds; `todo.update` also
accepts `null` to clear an existing date.

## Domain operations and todo reads

### `domain.list`

Arguments: `{}`.

Returns `{ domains, focus }`. Each domain includes at least `id`, `title`, and `description`.
Only active, non-deleted human-managed domains are returned. Each row also includes `archived`,
`position`, `created_at`, and `updated_at`. Use descriptions with titles for semantic placement and
call this before `todo.create` or `todo.move`.

### `domain.archived.list`

Arguments: `{}`.

Returns `{ domains }`. Only archived, non-deleted human-managed domains are returned, with the same
required row fields as `domain.list`. Use this only for explicitly requested historical context.
Archived rows are read-only context and are never valid targets for `todo.create` or `todo.move`.

### `domain.description.update`

Arguments: `{ id, description }`. `id` is a 20-digit decimal Domain Snowflake ID. `description` is
required, trimmed, and may contain 0–500 characters; send `""` to clear it.

Returns `{ domain }` after the persisted reread. Call this only when the user explicitly authorizes
changing the description of an active Domain resolved through `domain.list`. Archived, deleted,
missing, or malformed IDs are rejected. Do not infer this write from Todo placement.

### `domain.create`

Arguments: `{ title, description? }`. `title` is required and must contain 1–200 characters after
trimming. `description` is optional, must be a string, and may contain at most 500 characters after
trimming.

Returns `{ domain }`, where `domain` is newly created and active. Call this only when the user
explicitly requests or authorizes that new domain; never create one implicitly while handling a
todo request. Creation is rejected when 17 active domains already exist. Domain rename, archive,
restore, and delete are not exposed through MCP; only an explicitly authorized description update
is available through `domain.description.update`.

Call `domain.list` first. If an active domain already has the requested title, ask before creating
an intentional duplicate. This write is non-idempotent: after a timeout, disconnect, or missing
response, list domains to check whether it succeeded and do not retry automatically.

### `todo.list`

Arguments: `{ domainId? }`.

Returns `{ domains, todos, todosByDomain }`. It intentionally includes only incomplete todos from
active domains. Use it to select a domain or prevent an obvious duplicate, not for repeated polling.

### `todo.get`

Arguments: `{ id }`.

Returns the todo row. Use it for one known ID.

### `todo.status`

Arguments: `{ ids }`, where `ids` contains 1–100 unique 20-character decimal Snowflake strings.

Returns `{ items, summary }`. Each item has a `state` of `active`, `completed`, `deleted`, or
`missing`. Prefer this over list polling for tracked IDs.

## Todo writes

### `todo.create`

```json
{
  "domainId": "00000000000000000001",
  "title": "Concise personal action",
  "important": false,
  "note": "Optional context"
}
```

Required: `domainId`, `title`. Optional: `dueAt`, `remindAt`, `important`, `note`. Returns
`{ todo }`. Resolve `domainId` through `domain.list` first. Omit `dueAt` and `remindAt` entirely
when unspecified; never send `""` or `null` on create. When supplied, each date must be a
nonnegative integer Unix-millisecond timestamp.

Set `important: true` when the user explicitly asks to star or prioritize the new Todo, mark it as
important/重点/优先, or place it in Focus. An agent may also set it when an immediate human action
blocks the current session. Otherwise use `important: false` or omit it; a reminder, due date, or
ordinary backlog item alone does not imply a star.

Creation is non-idempotent because intentional identical Todos are valid. After a clear validation
rejection, call `todo.list` for the target Domain and compare normalized title plus relevant note,
timing, and context. If an obvious active duplicate exists, use it and do not retry; otherwise
sanitize the arguments and retry at most once. After a timeout, disconnect, or missing response,
allow a delayed commit to settle and recheck. One immediate empty list is insufficient evidence;
ask instead of immediately retrying while the result remains ambiguous.

### `todo.update`

Arguments: `{ id, title?, dueAt?, remindAt?, important?, note? }`. Returns `{ todo }`. Send only
fields that should change. Omit unchanged dates; use a nonnegative integer to set one or `null` to
clear one. Never send an empty string for a date. Use `""` to clear the note; never send
`note: null`.

Send `important: true` for explicit star/important/重点/优先/add-to-Focus intent. Send
`important: false` for explicit unstar/cancel-priority/remove-from-Focus intent. Omit `important`
when changing only the title, note, timing, Domain, or another unrelated field so the existing star
state is preserved.

### `todo.complete` and `todo.uncomplete`

Arguments: `{ id }`. Each returns `{ todo }` with the resulting state.

### `todo.move`

Arguments: `{ id, domainId }`. Returns `{ moved: true, id, domainId }`. Resolve the target through
`domain.list` first.

### `todo.delete`

Arguments: `{ id }`. Returns `{ deleted: true, id }`. Treat deletion as destructive and use it only
when requested or for an owned smoke-test cleanup.

## Step reads and writes

A Step is a user-owned, independently checkable sub-action of one durable Todo. Keep a Todo atomic
when it can be completed as a whole, use separate Todos for independently scheduled or prioritized
outcomes, and never store agent-internal execution as Steps. All Todo and Step IDs below are
20-digit decimal strings.

### `step.list`

Arguments: `{ todoId }`.

Returns `{ todo, steps }`. `todo` is the validated live parent and `steps` contains every live,
reconciled Step in stable repository order. Call this before editing or deleting a Step whose exact
ID is not already known, and before retrying a failed or ambiguous `step.create`.

### `step.create`

Arguments: `{ todoId, title }`. `title` is required and trimmed to 1–200 characters.

Returns `{ step }`. Preserve `step.id`. Creation is non-idempotent. After a clear validation error,
call `step.list`; use an obvious matching live Step instead of retrying, otherwise retry at most once
with corrected arguments. After a timeout, disconnect, or missing response, allow a delayed commit
to settle and recheck; do not immediately retry from one empty list while the result is ambiguous.

### `step.update`

Arguments: `{ id, title }`. `title` is required and trimmed to 1–200 characters.

Returns `{ step }` after the persisted reread. This changes only the Step title.

### `step.complete` and `step.uncomplete`

Arguments: `{ id }`. Each returns `{ step }` with the requested completion state. Both operations
are idempotent: repeating the same request succeeds without toggling to the opposite state.

### `step.delete`

Arguments: `{ id }`.

Returns `{ deleted: true, id, todoId }`. Treat deletion as destructive and call it only when the
user requests removal or when cleaning up an agent-owned smoke-test Step.

## Change events

### `event.list`

Arguments: `{ afterEventId?: 0, limit?: 50 }`, with a maximum limit of 100. Returns
`{ events, latestEventId, hasMore }`. Pass the returned `latestEventId` as the next
`afterEventId`; while `hasMore` is true, continue immediately with that cursor.

### `event.wait`

Arguments: `{ afterEventId?: 0, limit?: 50, timeoutMs?: 25000 }`. `timeoutMs` must be 1000–30000.
Returns `{ events, latestEventId, hasMore, timedOut }`. Continue with
`afterEventId: latestEventId`; `timedOut: true` means no event arrived during this wait. Use only
during an active wait.

## Important/Focus policy

The optional `important` field on `todo.create` and `todo.update` is the complete star API; do not
invent or call a separate star tool. `important: true` stars an active Todo into Focus, while
`important: false` unstars it and removes it from Focus. Focus is a virtual view, not a Domain.

Honor clear user meaning rather than requiring one exact field name: 星标, 重点, important,
priority/优先, or Focus placement means `true`; 取消星标, 不再重点, unstar, or removal from Focus
means `false`. Without that intent, create with `false` or omit the field, and omit it on update to
preserve the existing state. A due date, reminder, ordinary backlog item, or unrelated edit alone
never changes importance. An agent may autonomously use `true` for an immediate human action that
blocks the current live session, such as an approval, missing input, account/domain creation,
decision, or manual step.
