# Claude Subscription Account Slots

Status: implemented; owner verification pending

Amends `claude-subscription-accounts.md` (Status: Accepted) in one place: the *location* of a
managed account's config directory. Everything else in that document — the credential boundary, the
CLI-owned login flow, verification, removal ordering, the loopback server — is unchanged and remains
authoritative.

> Not yet registered in `docs/INDEX.md`: another session is mid-edit on that file. Add the entry when
> that work settles.

## Why move

The accepted design puts each account under `<userData>/accounts/<uuid>/profile`. That is safe but
opaque: the owner cannot inspect an account, cannot log one in from a terminal, and cannot tell
whether a slot is healthy without going through the app. Debugging a pool whose login state is
invisible means debugging blind.

Ral's requirement (2026-08-26) is that slots live at `~/.claude2`, `~/.claude3`, … so that
`CLAUDE_CONFIG_DIR=~/.claude3 claude` works directly and a slot can be logged in, checked, or
repaired without Bitterless.

## The invariant that must survive

`#assertIdentity` and `#assertStoredAccountPaths` currently require every stored path to **equal**
what `#expectedIdentity(id)` computes. Paths are therefore *derived*, never *trusted from the
registry file*. A tampered or corrupted `accounts.json` cannot redirect where the CLI writes a
credential.

Storing a free-form directory per account would give that up. It is not necessary: the requirement
is a predictable, inspectable location, not an arbitrary one.

**A slot number is stored; the path is still derived.**

```
slot: 3  →  configDirectory              = <home>/.claude3
            secureStorageConfigDirectory = <home>/.claude3
            anthropicConfigDirectory     = <home>/.claude3/anthropic
            partition                    = persist:bitterless-claude-account-<id>
```

`#assertIdentity` keeps comparing against a derived value, so the invariant holds unchanged. The
only new input is an integer, validated as an integer.

## Slot rules

| Rule | Reason |
|---|---|
| A slot is an integer ≥ 2, rendered as `~/.claude<N>` | `<N>` is the whole of the untrusted input |
| `~/.claude` (the default slot) is never a pool slot | It is the directory an interactive `claude` session uses. Bitterless serialises its *own* children per account, but it cannot serialise against an external `claude` process, so it cannot make that directory safe. On 2026-08-26 exactly that collision truncated `~/.claude/.claude.json` from 50,659 bytes to a 309-byte stub |
| A slot number is unique across accounts | Two accounts sharing a directory would share a credential |
| Directories keep mode `0700`, must be plain directories, and must not be symlinks | Unchanged from the accepted design |

## Adoption

Because slots are now ordinary, inspectable directories, a slot the owner has already logged in
from a terminal can be registered without repeating the login. Adoption runs the same verification
the login flow ends with — `auth status --json` under the slot's exact environment, accepted only
for a paid first-party Claude.ai session — and then persists metadata. It does not start a PTY, does
not open a browser, and does not touch the credential.

This is what makes the move useful rather than cosmetic: without it, moving the directory only
changes where Bitterless creates a slot it still has to log in itself.

## Registry

`version` moves `2` → `3`, adding `slot`. Version 2 records are rejected rather than migrated: they
point into `<userData>/accounts/<uuid>/profile`, which is no longer derivable, and there are none —
verified 2026-08-27, no `accounts.json` exists under any `Bitterless*` application-support
directory. Rejecting an unmigratable record is safer than guessing a slot number for it.

## Acceptance

- A stored account whose `slot` does not derive the paths in its own record is rejected at load.
- A slot of `1`, `0`, a negative, a non-integer, or a non-number is rejected.
- Two accounts cannot hold the same slot.
- Creating a slot produces `~/.claude<N>` and `~/.claude<N>/anthropic` at mode `0700`.
- Adopting a slot that reports a paid first-party session registers it without a PTY or browser.
- Adopting a slot that is not logged in, or is on an API key or a free plan, is refused and
  registers nothing.
- A version 2 registry is refused at load rather than silently reinterpreted.

## Entry points

- `src/main/claudeSubscription/claudeAccount.repository.ts` — `#expectedIdentity`,
  `#assertStoredAccountPaths`, registry parsing, identity creation
- `src/main/claudeSubscription/claudeSubscription.service.ts` — adoption entry

## Related

- `claude-subscription-accounts.md` — the accepted design this amends
- `docs/issues/claude-subscription-concurrent-requests-share-one-config-dir.md` — why the default
  slot cannot be pooled
- Design record: `areas/agent-runtime/sub2api/index.html` `#7.0`
