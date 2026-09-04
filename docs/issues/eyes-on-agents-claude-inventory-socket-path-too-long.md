# Claude inventory socket path exceeds the unix `sun_path` limit

Status: Fixed in source; owner runtime verification pending

Reported: 2026-09-04, by the owner, from a running build

## Symptom

Every Claude environment sits in `Retrying` in the Connections drawer, with this error on the row:

```text
listen EINVAL: invalid argument /Users/ral/Library/Application Support/Bitterless_DEBUG_PROD/eyes-on-agents/claude-inventory-af147ca5-5493-4079-81db-1c6f8841682b.sock
```

The environment never reaches `watching`, so no transcript discovery happens for it. Because it hits
*every* environment including the default one, this makes the whole
[Claude Multi-Environment](../features/eyes-on-agents-claude-multi-environment.md) delivery
non-functional at runtime on macOS, despite every unit test passing.

## This is a defect, not expected behavior

The intended contract is that each environment gets its own watcher endpoint and reaches `watching`.
`listen EINVAL` on a path Bitterless itself constructed is a defect in the construction.

## Root cause

`getClaudeInventoryBridgeEndpoint` (`src/shared/eyesOnAgents/claudeInventoryBridge.contract.ts:36-48`)
builds the unix socket path by concatenating the **raw environment id** — a 36-character UUID — into
the filename:

```ts
const scope = environmentId === undefined ? '' : `-${safeString(environmentId, 'Claude environment id')}`;
…
return { transport: 'unix', path: join(safe, 'eyes-on-agents', `claude-inventory${scope}.sock`) };
```

A unix domain socket address is a fixed-size `struct sockaddr_un` whose `sun_path` is **104 bytes on
macOS** (108 on Linux), including the terminating NUL — so the usable path length is 103. The
observed path is **134 characters, 30 over the limit**, and `bind(2)` rejects it as `EINVAL`.

The asymmetry that hid this: the **win32 branch on line 44 already hashes** the scope down to 12 hex
characters, so named pipes stayed short. The unix branch on line 47 does not, so only unix inherited
an unbounded name. Task 085 introduced the scope; the win32 side was made safe and the unix side was
not.

### Why the budget is tighter than it looks

The directory prefix is fixed by the profile-scoped userData path, leaving very little for the file
name:

| runtime profile dir | prefix length | budget for filename (≤103 total) |
|---|---|---|
| `Bitterless` | 65 | 38 |
| `Bitterless_PREVIEW` | 73 | 30 |
| `Bitterless_DEBUG_DEV` | 75 | 28 |
| `Bitterless_DEBUG_PROD` | 76 | 27 |

Against that budget:

| filename | length | total (DEBUG_PROD) | fits |
|---|---|---|---|
| `claude-inventory.sock` (pre-085) | 21 | 97 | yes — which is why this never surfaced before |
| `claude-inventory-<uuid36>.sock` (today) | 58 | 134 | **no** |
| `claude-inventory-<hash12>.sock` | 34 | 110 | **no** — hashing alone is not enough |
| `ci-<hash12>.sock` | 20 | 96 | yes |

So the repair must shorten the **prefix as well as** the id; simply hashing the UUID the way win32
does still overflows on debug/preview profiles. Note also that the budget depends on the length of
the user's home directory, so a longer username can overflow any fixed choice — the repair should
fail loudly with an explanatory error rather than emit a path that `bind(2)` will reject.

## Why every test passed

`getClaudeInventoryBridgeEndpoint` is a pure string builder, and no test asserted anything about the
length of what it returns, nor did any test `bind` the result. `docs/plan/backlog.md` already carried
a task 085 review note that "no test constructs two real Claude environment ids and asserts
`getClaudeInventoryBridgeEndpoint` produces two distinct socket/named-pipe paths" — the same blind
spot, one property over.

## Repair

- Bound the unix filename: hash the environment id (as win32 already does) **and** shorten the base
  name, e.g. `ci-<12 hex>.sock`. Keep the unscoped form byte-identical to today's
  `claude-inventory.sock` so pre-085 callers and their tests are untouched.
- Add an explicit platform length guard so an over-long path throws a message naming the limit and
  the offending length, instead of surfacing as an opaque `listen EINVAL` on a status row.
- Cover with tests that assert: two distinct ids produce two distinct paths (closing the logged
  backlog gap at the same time), the produced path stays within the platform limit for the longest
  real profile directory, and the unscoped path is unchanged.

## Related

- Introduced by task `eyes-on-agents-claude-multi-env-watcher-085`.
- The owner hit this while running the manual verification recorded in
  [Claude Multi-Environment](../features/eyes-on-agents-claude-multi-environment.md).
