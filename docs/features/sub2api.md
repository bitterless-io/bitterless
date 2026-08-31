# Sub2API — one local endpoint serving both subscriptions

Status: implemented; owner end-to-end verification pending

Supersedes the Codex-facing half of `claude-subscription-account-slots.md`. The Claude account
model (slots, adoption, routing, the CLI boundary) is unchanged and still described there.

> Not yet registered in `docs/INDEX.md`: another session is mid-edit on that file.

## The problem this solves

Codex Desktop has **one** `model_provider`, applied globally. It never passes `--profile`, and
per-thread provider selection exists in the app-server protocol but is wired only to a hardcoded
GitHub Copilot path (openai/codex#29156). So pointing Desktop at Bitterless meant *losing* the GPT
models: the picker showed only Claude, and threads created before the switch broke.

That framed the constraint wrongly. The limitation is not "one model family" — it is **one
provider**. If that provider can serve everything, the limitation stops mattering.

Bitterless already holds both subscriptions:

| Upstream | Path | Credential |
|---|---|---|
| Claude | unmodified `claude -p` subprocess per request | Claude Code CLI owns it; Bitterless never reads it |
| GPT | `PiCodexResponsesUpstream` → pi session | Codex OAuth in `<userData>/cowork/pi/auth.json` |

## Why the GPT upstream is not `CodexRuntimeService.run()`

`run()` already reaches the ChatGPT subscription, so reusing it looked like the whole job. It is not,
and the reason is worth stating because it looks like duplication otherwise: `run()` is Translator's
**hardened** entry point. It pins `noTools: 'all'`, treats any tool event as a `tool-violation`, and
caps the system prompt at 8 KiB and the output at 64 KiB. Each of those is right for translating a
sentence and fatal for an agent turn — a Codex Desktop request carries a multi-kilobyte instruction
block, an unbounded transcript, and is worthless if the model cannot call `shell`. Routing `gpt-*`
into `run()` would have produced a model that can only chat, which in Desktop reads as a broken
agent rather than an unavailable feature.

`PiCodexResponsesUpstream` therefore reuses `run()`'s **plumbing** — pi module load, auth and model
resolution, abort handling, all now exported rather than copied — and replaces its **policy**:

- The tools the client advertised are registered as real pi tools whose implementations never
  execute anything. The first invocation records its arguments and aborts the session; that recorded
  call is returned as the turn's `function_call`. Execution stays where the protocol puts it, in
  Codex.
- Tool names are registered under a sanitized alias and mapped back on the way out: a Codex
  `decision_name` may carry a `namespace:` prefix and percent-encoding, neither of which survives as
  a provider function name. The client only ever sees its own name.
- `noTools` is `'builtin'`, not `'all'`, so pi's own read/bash/edit/write tools stay off while the
  client's stay on. **Passing `tools: []` alongside `customTools` silently empties the tool list** —
  carried over from `run()`, it made the model answer *"I don't have access to a shell tool"* while
  every unit test still passed. Only a live run against the real subscription caught it.

Both upstreams return the same `ClaudeDecision`, so streaming, `function_call` emission and error
mapping are shared rather than duplicated per upstream.

## Design

`POST /v1/responses` routes on the requested model:

```
claude-sonnet | claude-opus | claude-haiku           → Claude account pool  (claude -p)
gpt-5.5 | gpt-5.6-luna | gpt-5.6-sol | gpt-5.6-terra → Codex upstream       (pi + ChatGPT OAuth)
anything else                                        → Claude fallback (see below)
```

The unknown-model fallback stays: a Desktop thread created before the switch still sends its old
slug, and rejecting it made every pre-existing thread unusable. The response reports the model that
actually ran, so the substitution is visible rather than silent.

A `gpt-*` request also falls back to Claude when the Codex upstream reports `not-configured` or
`runtime-unavailable` — no ChatGPT login, no pi. **A `provider-error` does not fall back.** That
distinction is the point: an upstream that cannot serve anything should not break the thread, but a
model that failed on its own should be reported as itself rather than quietly answered by a
different subscription while spending Claude quota on it.

### Effort: one picker ladder, two different mappings

Four vocabularies, none of which line up:

| | Ladder |
|---|---|
| Codex Desktop, schema | `none` `minimal` `low` `medium` `high` `xhigh` `max` `ultra` |
| Codex Desktop, **picker** | `low` `medium` `high` `xhigh` `ultra` |
| Claude CLI | `low` `medium` `high` `xhigh` `max` `ultracode` |
| pi | `minimal` `low` `medium` `high` `xhigh` `max` |
| ChatGPT backend, `reasoning.effort` | `none` `minimal` `low` `medium` `high` `xhigh` `max` |

The picker is the ladder that matters: `enabledReasoningEfforts` defaults to
`[low, medium, high, xhigh, ultra]`, so **Desktop hides `max`** even though its schema
accepts it. The catalog publishes those five rungs, and each upstream maps them its own
way — owner-agreed 2026-08-31:

| Desktop shows | Claude runs | GPT runs |
|---|---|---|
| `ultra` | `ultracode` | `max` |
| `xhigh` | `max` | `xhigh` |
| `high` | `xhigh` | `high` |
| `medium` | `high` | `medium` |
| `low` | `medium` | `low` |

The two columns differ because the upstreams do, and each rule is forced rather than
chosen:

- **Claude shifts up one.** Its CLI has a sixth rung above `max`, so aligning the tops
  spends it on `ultra` and drops the CLI's `low` — the rung least worth reaching.
- **GPT passes through.** pi's names already match Desktop's for `low..xhigh`; only
  `ultra` has no counterpart, and it takes pi's top.

Locked by a test that asserts the whole table, because a mapping is exactly the kind of
thing that drifts one rung at a time.

#### Four facts this rests on, each read from the source

- **`ultracode` is a real Claude level**, absent from the CLI's own *"Valid values: low,
  medium, high, xhigh, max"* message but accepted: `--effort ultracode` runs without the
  *Unknown --effort value* warning that `ultra` and any other unknown string produce.
  Confirmed by comparing all four against the live CLI.
- **`ultra` cannot reach the GPT upstream, and the reason is not the bridge.** Putting it
  on the wire — by overriding pi's `thinkingLevelMap` so its `max` emits `ultra` — is
  answered by the backend itself:

  > `[reasoning.effort] [invalid_enum_value] Invalid value: 'ultra'. Supported values
  > are: 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', and 'max'.`

  pi reaches `https://chatgpt.com/backend-api/codex/responses` **directly**, with the
  OAuth credential Codex stored — no IPC with the Codex app — so this is the same
  endpoint and the same subscription Desktop uses. The override was removed.
- **`ultra` is not a reasoning level at all.** Codex publishes it as *"Maximum reasoning
  with automatic task delegation"*, and its own UI calls it *"For demanding work using
  multiple agents · highest usage"*. The delegation lives in the Codex client
  (`multi_agent` appears 318 times in its core), above the HTTP layer. `max` is the
  ceiling for the model itself; what `ultra` adds is orchestration Bitterless does not
  implement.
- **An unknown level degrades rather than fails.** pi's `clampThinkingLevel` returns
  `availableLevels[0]` — the *lowest* rung — for a level it does not recognise, so
  forwarding an unmapped name would silently run at the bottom.

The mapping is applied by two functions rather than one: `shiftClientEffortToUpstream`
(rank, top-anchored) for Claude, and `clampCodexEffort` (by name, top for `ultra`) for
GPT. A single rank rule was tried and is wrong — pi pads the *bottom* of its ladder with
`minimal`, so rank alignment there pushed every level down one and `high` ran `medium`.

### The catalog needs `default_reasoning_level`

Codex's own entries carry `default_reasoning_level`, and the generated ones did not. Alongside it,
`minimal_client_version` is now emitted, matching the shape Codex 0.151 publishes for its own models.

Codex Desktop bundles core **0.151**, whose effort enum is `minimal|low|medium|high|xhigh|max|ultra`
— `max` is reachable there. The standalone `codex-cli` 0.137 stops at `xhigh`, which is why the two
disagree about what the picker can offer.

### Which Claude models are offered

Sonnet and Opus only. Haiku is dropped: the pool exists for coding turns, where it is the wrong
trade, and each unused entry is one more the owner scrolls past. Both are labelled with their
generation — `--model sonnet` reports `claude-sonnet-5` and `--model opus` reports `claude-opus-5`,
both confirmed against the live CLI — so the picker no longer leaves it ambiguous.

### `/v1/models` reflects what is actually usable

The endpoint lists a family only when that upstream can serve it: the Claude entries need an eligible
account in the pool, the GPT entries need a connected Codex credential. A model that cannot be served
must not be advertised.

## What this buys

Codex Desktop points at Bitterless as its single provider and keeps **both** subscriptions: GPT
models answer from the ChatGPT subscription, Claude models from the Claude pool, selected from the
normal model picker with no config edit or restart between them.

## Acceptance

- `/v1/responses` with a `gpt-*` model returns text produced by the Codex runtime.
- `/v1/responses` with a `claude-*` model returns text produced by the Claude pool.
- `/v1/models` omits the Claude family when no account is eligible, and the GPT family when no Codex
  credential is connected.
- The generated Codex catalog declares `gpt-5.6-sol` with `low|medium|high|xhigh|max`, `gpt-5.5` with
  `low|medium|high|xhigh`, and Claude models with `low|medium|high|xhigh|max`.
- Every catalog entry carries `default_reasoning_level`.
- Only `claude-sonnet` and `claude-opus` are offered, labelled Sonnet 5 and Opus 5.
- An effort the target upstream does not accept is clamped, not forwarded.
- A request naming an unknown model is answered by the Claude fallback, and the response reports the
  model that ran.
- A `gpt-*` turn that chooses a client tool returns a `function_call`; Bitterless does not execute it.
- A Codex `provider-error` is returned as an error rather than answered by the Claude pool.

## Verification (2026-08-31)

Both upstreams exercised through the production classes assembled outside Electron — repository,
router, `ClaudeCliExecutor`, `PiCodexResponsesUpstream`, `ClaudeResponsesRuntime`,
`ClaudeResponsesServer` — with a temporary registry, against Ral's real subscriptions:

```
GET  /v1/models  → claude-sonnet, claude-opus, claude-haiku,
                   gpt-5.5, gpt-5.6-luna, gpt-5.6-sol, gpt-5.6-terra
POST /v1/responses model=claude-sonnet → HTTP 200 · "Anthropic built me." · 3111 ms
POST /v1/responses model=gpt-5.5, reasoning.effort=max, tools=[shell]
     → HTTP 200 · response.model gpt-5.5
     · function_call shell {"command":["bash","-lc","ls -la"]} · 4772 ms
```

The GPT turn is the one that matters: the model chose the client's tool, Bitterless did **not** run
it, and the call came back over the wire as a `function_call` for Codex to execute. `effort: max`
was clamped to `xhigh` on the way in.

The Codex credential is `<userData>/cowork/pi/auth.json` from `Bitterless_DEBUG_PROD` — the same
ChatGPT subscription Bitterless already logs into for Translator, not a second credential.

### The multi-turn loop

A single turn proves nothing about Desktop, which runs a **loop**: it executes the tool and sends
`function_call_output` back with the whole transcript. pi takes one prompt string per turn, so the
transcript is flattened to text — lossy by construction, and the open question was whether the model
can still continue from it.

Exercised against seven files with unguessable names, so a correct answer cannot be a lucky guess:

```
turn 1  input: "list the files, then reply <alphabetically first filename> / <count>"
        → function_call  name "run"  namespace "local shell"
          {"command":["bash","-lc","find … -exec basename {} \; | sort"]}
turn 2  input: … + function_call + function_call_output("aa12c.txt\nbk67w.txt\n…")
        → "aa12c.txt / 7"
```

Both facts in that answer exist only in the tool output. The same run also covered a **19,031-byte**
instruction block — `run()` rejects anything over 8 KiB — and confirmed a namespaced tool is restored
to the client's own `name`/`namespace` after passing through the sanitized alias.

### The Desktop request shape

Desktop declares several tools at once and mixes prior `reasoning` items back into `input`. With
`shell`, `apply_patch`, `update_plan` and a namespaced `mcp__bitterless:todo_create` all declared and
an opaque `reasoning` item in the input, the model picked the right tool **4/4** and the reasoning
item was skipped without disturbing the transcript.

In every GPT run above the Claude executor was a stub that throws, so a misrouted request would have
failed loudly rather than being quietly answered by the other subscription.

### Known limitation: no prompt cache on the GPT path

Each GPT turn creates a fresh pi session, so `prompt_cache_key` — which the Claude path uses for
routing stickiness and which Desktop natively relies on for prefix caching — is not forwarded
upstream. The whole flattened transcript is re-sent uncached every turn. This is invisible on short
threads (turn 2 above cost 3.5 s) and gets progressively worse as a real Desktop thread grows, both
in latency and in subscription consumption. Forwarding the cache key into the pi session is the fix
and has not been attempted.

Not covered: the Electron/XPC layer, the Workbench UI, Codex Desktop itself, parallel tool calls
(the first is taken and the rest dropped), and multi-account Claude failover (the machine has one
usable Claude account).

Harness: `tmp/claude-sub-e2e/` in the overmind workspace (scratch; not part of this repository).

## The Codex provider id stays `bitterless_claude`

The copied snippet now reads `name = "Bitterless Sub2API"`, but the provider **key** is unchanged.
Renaming it would invalidate the `model_provider = "bitterless_claude"` line in an already-working
`~/.codex/config.toml` — the same class of breakage as the earlier top-level `model` line, for a
purely cosmetic gain.

The generated catalog lists both families unconditionally, unlike `/v1/models`, which filters by
live availability. Codex reads the catalog once and statically, so filtering it by a momentary
credential state would drop models from the picker until the file was copied again; an entry whose
upstream is missing falls back to Claude instead of failing.

## The endpoint logs what it served

The endpoint logged nothing at all, so a failing turn reached the client as a bare 502 whose only
detail was the fixed sentence every failure shares — which is what Codex renders as *Unknown error*.
What the request contained, which upstream took it, and what actually went wrong existed only in
memory and were discarded.

`Sub2ApiLogger` is **injected**, not imported: `ClaudeResponsesServer` and `ClaudeResponsesRuntime`
are free of Electron imports so the whole request path can be assembled and exercised outside the
app, and reaching for `electron-log` inside them would end that. The Electron wiring supplies an
implementation writing `[sub2api] …` lines to the application log; tests supply nothing.

| Event | Carries |
|---|---|
| `request` | model, effort, stream, instruction bytes, input items, tool count and types, and any request key Bitterless does not read |
| `dispatch` | the chosen upstream, requested vs resolved model, requested vs clamped effort |
| `claude-completed` / `codex-completed` | model, account, decision kind |
| `claude-failed` / `codex-failed` | the real error name, message and code, and whether it triggers a fallback |
| `failed` / `failed-mid-stream` | status, error code, duration, and whether the stream had already started |

An untyped failure is also no longer flattened into that one fixed sentence in the response: the real
message is redacted, bounded and included, so the client has something actionable instead of
*Unknown error*.

**Read the log by scope, not by prefix.** The formatter parses the leading `[sub2api]` into the
entry's `scope` field, so it is not present in the written line and `grep '\[sub2api\]'` matches
nothing on a log that is being written correctly:

```bash
grep '"scope":"sub2api"' "<userData>/logs/main.log"
```

Verified against a live request on 2026-08-31: one probe produced `request` → `dispatch` →
`claude-completed` → `responded status=200`.

### What a real Codex session sends

A new session created through the desktop's own core (0.151) against `claude-sonnet`:

```
request  instructionsBytes=23 inputItems=3 tools=25
         toolTypes=function,custom,namespace,web_search
         extraKeys=tool_choice,parallel_tool_calls,store,include,text,client_metadata
dispatch upstream=claude tools=206 unsupportedTools=custom,web_search
responded status=200 · 5776 ms
```

`tools=25` at the top level expands to **206** after namespaces. `instructionsBytes=23` is this
catalog's own `base_instructions`, which Codex uses verbatim for a model it does not otherwise know.

Codex also warns *"Configured service tier `priority` is not advertised as supported for model
`claude-sonnet` and will be omitted from requests"* — it validates `service_tier` against the entry
and drops it rather than failing, so leaving `service_tiers` absent is safe.

## A 502 that never reaches the endpoint

Codex Desktop reported `unexpected status 502 Bad Gateway: Unknown error, url:
http://127.0.0.1:12842/v1/responses` while the endpoint logged **nothing at all** — and every probe
against it, direct and through the proxy, returned 200.

The cause was outside Bitterless. Clash evaluates rules top-down, first match wins, and the owner's
rule list put process rules above the loopback rule:

```
PROCESS-NAME,codex,PROXY          ← matched first
…
IP-CIDR,127.0.0.0/8,DIRECT        ← never reached
```

The Codex core process is literally named `codex`, so its connection to `127.0.0.1:12842` was routed
to a remote proxy node, which cannot reach the user's own loopback. The 502 came from that node.

**The absence of a log entry was the evidence**, which is why the blind spot mattered: `#handle`
answered `Origin`-rejected, 404 and 415 requests before assigning a request id, so a refused client
also produced no line. A missing entry could not be distinguished from a client that never called.
Every arriving request is now logged as `received` — with method, path, `Origin`, content type and
length — before any rejection, and each early return logs `rejected` with its status.

Diagnostic rule: if Codex reports a 502 and no `received` line appears, the request never arrived and
the fault is between the client and the port. A 502 from this endpoint always carries the real error
message.

## Entry points

- `src/main/claudeSubscription/claudeResponses.server.ts` — dispatch, upstream availability
- `src/main/claudeSubscription/claudeResponses.translator.ts` — `resolveSub2ApiTarget`, filtered
  `/v1/models`
- `src/main/codex/codexResponses.upstream.ts` — the tool-capable GPT upstream, `clampCodexEffort`
- `src/main/codex/codexRuntime.service.ts` — `CODEX_RUNTIME_MODELS`, `CODEX_RUNTIME_MODEL_EFFORTS`,
  the pi primitives both upstreams share, and Translator's `run()`
- `src/shared/claudeSubscription/claudeSubscription.contract.ts` — catalog generation
- `src/renderer/maestro/workbench/src/views/WorkbenchSub2ApiView.vue` — the Workbench pane, renamed
  from Configuration now that it fronts both subscriptions

## The panel

The old header drew a `Codex → Local Responses → Claude CLI` pipeline. That shape stopped being true
once the endpoint served two upstreams, and it never carried an action anyway. It is now an
**OpenAI-compatible client** section holding a row of cards, because the reader's next step is always
inside one of them:

| Card | Holds |
|---|---|
| Local LLM endpoint | the URL, the port control, and how many Claude accounts / GPT models are being served |
| Import into your agent | the copy button, the three steps, and — only after a copy — the reminder that a running Codex keeps the old provider and model list |
| Local model configuration | Bitterless's own use of the route, model and effort |

The routing pool is two blocks rather than one, since "the pool" is no longer only Claude: a Claude
block with the account list, and a Codex block reporting whether the ChatGPT credential is connected
and which GPT models it serves. `codexUpstream` on the snapshot feeds it.

Resolving that credential loads pi and reads the auth file, which is far too slow to sit inside
snapshot creation — snapshots publish on every account and routing change. The last known answer is
served immediately and a refresh runs in the background on a 60 s TTL, republishing only when the
value changes; an unconditional republish would be observed by the next snapshot, which would probe
again, which would republish.

**Codex remains one account.** Its sign-in is browser OAuth against a ChatGPT subscription and
Bitterless holds one at a time, so the block reports status rather than offering a pool. Multiple
Codex accounts would need a per-account `auth.json` and a login flow of their own; that is not built.

## Related

- `claude-subscription-account-slots.md` — the Claude account model this builds on
- Reference: [`Wei-Shaw/sub2api`](https://github.com/Wei-Shaw/sub2api) — model-name dispatch,
  configurable model list, effort mapping with a per-group ceiling. A multi-tenant Go gateway, so
  only the concepts transfer, not the architecture.
