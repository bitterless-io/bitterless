# Bitterless Todo MCP tools

The production tools operate the user's personal, multi-device-synchronized Todo store. Bitterless
owns synchronization; MCP calls read and write the local production app. All tools return MCP
`content` plus machine-readable `structuredContent`; use `structuredContent` for decisions and
assertions. Timestamps are integer Unix milliseconds or `null`.

## Domain operations and todo reads

### `domain.list`

Arguments: `{}`.

Returns `{ domains, focus }`. Each domain includes at least `id`, `title`, and `description`.
Only active human-managed domains are returned. Call this before `todo.create` or `todo.move`.

### `domain.create`

Arguments: `{ title, description? }`. `title` is required and must contain 1–200 characters after
trimming. `description` is optional, must be a string, and may contain at most 500 characters after
trimming.

Returns `{ domain }`, where `domain` is newly created and active. Call this only when the user
explicitly requests or authorizes that new domain; never create one implicitly while handling a
todo request. Creation is rejected when 17 active domains already exist. Domain rename, archive,
restore, and delete are not exposed through MCP.

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

Arguments: `{ ids }`, where `ids` contains 1–100 positive integer IDs.

Returns `{ items, summary }`. Each item has a `state` of `active`, `completed`, `deleted`, or
`missing`. Prefer this over list polling for tracked IDs.

## Todo writes

### `todo.create`

```json
{
  "domainId": 1,
  "title": "Concise personal action",
  "dueAt": null,
  "remindAt": null,
  "important": false,
  "note": "Optional context"
}
```

Required: `domainId`, `title`. Optional: `dueAt`, `remindAt`, `important`, `note`. Returns
`{ todo }`. Resolve `domainId` through `domain.list` first.

### `todo.update`

Arguments: `{ id, title?, dueAt?, remindAt?, important?, note? }`. Returns `{ todo }`. Send only
fields that should change. Use `null` to clear nullable timestamps; use `""` to clear the note.
Never send `note: null`.

### `todo.complete` and `todo.uncomplete`

Arguments: `{ id }`. Each returns `{ todo }` with the resulting state.

### `todo.move`

Arguments: `{ id, domainId }`. Returns `{ moved: true, id, domainId }`. Resolve the target through
`domain.list` first.

### `todo.delete`

Arguments: `{ id }`. Returns `{ deleted: true, id }`. Treat deletion as destructive and use it only
when requested or for an owned smoke-test cleanup.

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

`important: true` stars an active todo into Focus. Use it only for a human action blocking the
current live agent session, such as an approval, missing input, account/domain creation, decision,
or manual step. Do not star deferred reminders or backlog items.
