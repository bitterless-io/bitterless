---
name: bitterless-todo
metadata:
  version_code: "260723121906"
description: >-
  Manage the user's personal, multi-device-synchronized Bitterless todos and explicitly authorized
  domains through the local production `bitterless` MCP server. Use when an agent needs to list,
  create, inspect, update, complete, reopen, move, delete, or monitor personal todos and their
  independently checkable steps; preserve a concrete user-owned follow-up across devices; or record
  an immediate human action blocking the current session. DEBUG MCP aliases are test-only.
---

# Bitterless Todo

Treat Bitterless as the user's personal Todo manager, synchronized by Bitterless across the user's
devices. The production `bitterless` MCP writes real, durable personal data. It is not a project
issue tracker and is not scratch space for steps the agent can perform itself. Bitterless owns
account/device synchronization; the MCP helper only connects the agent to the running local app.

Use MCP tools as the only data boundary. Never open or modify Bitterless SQLite directly. Never
substitute `bitterless-debug`, `bitterless-dev`, or `bitterless-dev-debug` for real work.

## Decide whether to create a personal todo

Create a todo when the user explicitly asks to remember, track, schedule, or add one. An agent may
also create one without another confirmation only when all of these are true:

- the user personally owns the next action;
- the action is concrete and useful after the current session ends;
- preserving it across devices is more useful than leaving it in chat;
- the title, target domain, and relevant timing are clear;
- no obvious active duplicate already exists.

Do not create a todo for internal agent steps, work the agent can finish now, speculative ideas,
team/project issues that belong elsewhere, or vague follow-ups. When the ownership or durable value
is unclear, ask instead of writing. Briefly report judgment-based creations to the user.

## Choose a Todo or Steps

Keep a Todo atomic when one user-owned action or outcome can be completed as a whole. Add Steps when
one durable Todo contains multiple user-owned sub-actions that are independently checkable but still
serve that same outcome. Use separate Todos when actions have independent outcomes, timing, or
priority. Never record the agent's own execution plan as personal Steps.

## Operate todos

1. Call `domain.list` before a create or move. It is the default active-domain catalog; use each
   returned `description` with its title to select an existing active domain by meaning. Use an
   existing general domain such as `Others` when appropriate; never create a domain merely because
   no precise match exists. Use `domain.archived.list` only for explicitly requested historical
   context. Archived domains are never valid Todo targets.
2. Call `todo.list` for the selected domain before a judgment-based create and avoid an obvious
   duplicate. Do not turn this into broad polling.
3. For `todo.create`, omit `dueAt` and `remindAt` entirely when unspecified. Send only nonnegative
   integer Unix-millisecond values when supplied; never send `""` or `null`. After a clear
   validation rejection, list the target Domain and compare normalized title plus relevant context;
   use an obvious active duplicate, otherwise correct the arguments and retry at most once. After a
   timeout, disconnect, or missing response, allow a delayed commit to settle and recheck. One
   immediate empty list is insufficient; ask instead of immediately retrying while ambiguous. Only
   `todo.update` may send `null`, and only to clear an existing date.
4. Call `domain.create` only when the user explicitly requests or authorizes that new domain. Treat
   it as non-idempotent: after a timeout, list domains and never retry the write automatically.
5. Call `domain.description.update` only when the user explicitly asks to change an active domain's
   description. Never infer this write from Todo placement and never update an archived domain.
6. Call the narrowest Todo or Step tool needed. Preserve returned Todo and Step IDs for later reads
   and writes. Call `step.list` before editing or deleting an unknown Step and before retrying
   `step.create`. After a clear validation rejection, retry at most once only when the list shows no
   obvious duplicate. After an ambiguous execution result, settle and recheck before deciding; do
   not immediately retry from one empty list. Treat `step.complete` and `step.uncomplete` as
   idempotent.
7. Read `structuredContent`, verify the returned ID/state, and report the resulting title, domain,
   and state concisely.
8. Delete a Todo or Step only when the user requests deletion or when cleaning up agent-owned
   smoke-test data.

Set `important: true` only when the user must act now before the agent can continue the current
session. Leave it false or unset for reminders, backlog, and non-blocking follow-ups. Focus is a
virtual view of active important todos, not a domain.

For exact arguments and response shapes, read [references/tools.md](references/tools.md).

## Resume or wait

- Use `todo.status` for known IDs.
- Use `event.list` with the last cursor when resuming work that may have changed on another device.
- Use `event.wait` only while actively waiting for the user; it is bounded long-polling, not push.
- Do not repeatedly list all todos to check a known ID.

## Recover setup or connection failures

If the production MCP dependency is missing, or when installing this skill package, read
[references/mcp-setup.md](references/mcp-setup.md). If the bridge is unavailable, ask the user to
start or keep production Bitterless running. Never fall back to a DEBUG instance and never bypass a
failed helper by reading the database.
