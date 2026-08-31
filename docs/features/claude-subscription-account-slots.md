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

## Slot allocation must also read the disk

`#nextFreeSlot` consults the registry **and** the filesystem. The registry alone is not enough: the
owner creates and logs into `~/.claude<N>` directories by hand, and those are invisible to it. With
an empty registry it would have allocated slot 2 — an existing, logged-in account — and the login
flow would have overwritten that credential, then deleted the whole directory if verification
failed. Creation must never land on an existing directory; adoption is the path for those.

## Adoption

Because slots are now ordinary, inspectable directories, a slot the owner has already logged in
from a terminal can be registered without repeating the login. Adoption runs the same verification
the login flow ends with — `auth status --json` under the slot's exact environment, accepted only
for a paid first-party Claude.ai session — and then persists metadata. It does not start a PTY, does
not open a browser, and does not touch the credential.

This is what makes the move useful rather than cosmetic: without it, moving the directory only
changes where Bitterless creates a slot it still has to log in itself.

**A failed adoption must leave the directory alone.** The authorization flow logs out and deletes on
failure because it created the directory; adoption did not, and an owner's working account has to
survive a failed attempt to register it.

## Configurable port

The endpoint port is owner-configurable, defaulting to **12842**. It is stored in
`<userData>/claude-subscription/settings.json` (`{version, port}`), beside the registry rather than
inside it: it is not account state, and a malformed settings file must not make the accounts
unreadable. An absent or out-of-range value falls back to the default instead of failing startup.

The server takes its port at construction, so a change applies on the next service start rather than
tearing down a listener that may be mid-request. Two consequences follow, and both are handled:

- The Codex profile snippet is **generated from the live port** (`buildClaudeSubscriptionCodexProfile`)
  rather than being a constant. A hard-coded snippet would quietly point Codex at the wrong port.
- `localClaudeProvider` builds its base URL per call instead of exporting a frozen constant.

## Letting Codex choose the model and effort

Codex does **not** read the provider's `/v1/models`; its picker is populated from
`model_catalog_json` in `~/.codex/config.toml` (verified against `codex debug models`: a provider
block alone leaves the built-in OpenAI list in place). Pinning one model in Bitterless was therefore
not a design choice so much as the absence of a catalog.

`copyCodexProfile` now writes `<userData>/claude-subscription/codex-model-catalog.json` and
references it from the copied snippet, so Codex offers all three models and every effort:

| | |
|---|---|
| Models | `claude-sonnet` · `claude-opus` · `claude-haiku` |
| Efforts | `low` · `medium` · `high` · `xhigh` · `max` |

Two constraints are encoded rather than discovered again later:

- `model_catalog_json` is emitted **before any table header**. TOML would otherwise scope it into
  `[model_providers.bitterless_claude]`, where it is ignored as an unknown provider field and the
  picker silently keeps the OpenAI models.
- Each entry carries `supports_reasoning_summaries` and `supports_parallel_tool_calls`. codex-cli
  0.137 rejects an entry without them while the desktop's bundled 0.149 tolerates it, and a single
  missing field discards the **entire** catalog.

### `max` is a real level, not a synonym

`claude --effort` accepts `low|medium|high|xhigh|max` (verified 2026-08-31). The translator
previously folded `max` and `ultra` into `xhigh`, so every request asking for the top level was
served one level weaker without any indication. `max` now maps to `max`.

`--model opus` resolves to **Opus 5** (`modelUsage` reports `claude-opus-5`), and `--effort max` is
accepted — both confirmed against the live CLI on `~/.claude2`.

## End-to-end verification

Run 2026-08-31 against the production classes — repository, router, `ClaudeCliExecutor`,
`ClaudeCliAccountAuth`, `ClaudeResponsesRuntime`, `ClaudeResponsesServer` — assembled outside
Electron, with a temporary registry so no real `userData` or `~/.claude*` directory was written:

```
repository.serverPort() = 12842
adoptable slots  [{"slot":2,"initialized":true},{"slot":3,"initialized":false}, …]
verify           loggedIn:true, claude.ai, firstParty, team
listening        http://127.0.0.1:12842
POST /v1/responses → HTTP 200
  events   response.created, output_item.added, content_part.added, output_text.delta,
           output_text.done, content_part.done, output_item.done, response.completed, [DONE]
  usage    {"input_tokens":2,"output_tokens":204,"total_tokens":206}
  text     "Anthropic built me."   (4421 ms)
```

This is the first time the chain has been exercised end to end. What it does **not** cover: the
Electron/XPC layer, the Workbench UI, and multi-account failover — the machine has one usable
account, so routing was single-account throughout.

Harness: `tmp/claude-sub-e2e/` in the overmind workspace (scratch; not part of this repository).

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
