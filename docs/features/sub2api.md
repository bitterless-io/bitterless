# Sub2API — one local endpoint serving both subscriptions

Status: draft

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
| GPT | `CodexRuntimeService.run()` → pi session | Codex OAuth in `<userData>/cowork/pi/auth.json` |

Both were verified working on 2026-08-31 (see **Verification**). The remaining work is dispatch, not
capability.

## Design

`POST /v1/responses` routes on the requested model:

```
claude-sonnet | claude-opus | claude-haiku        → Claude account pool  (claude -p)
gpt-5.5 | gpt-5.6-luna | gpt-5.6-sol | gpt-5.6-terra → Codex runtime      (pi + ChatGPT OAuth)
anything else                                     → Claude fallback (see below)
```

The unknown-model fallback stays: a Desktop thread created before the switch still sends its old
slug, and rejecting it made every pre-existing thread unusable. The response reports the model that
actually ran, so the substitution is visible rather than silent.

### Effort is not one vocabulary

The two upstreams do not accept the same levels, and this is where a naive catalog goes wrong:

| Upstream | Accepted efforts |
|---|---|
| Claude (`claude --effort`) | `low` `medium` `high` `xhigh` `max` |
| Codex, most models | `low` `medium` `high` `xhigh` |
| Codex `gpt-5.6-sol` | `medium` `high` `xhigh` only |

So the Codex model catalog must declare **per-model** reasoning levels rather than one shared list,
and each upstream clamps what it receives. Declaring a level an upstream rejects puts a broken option
in the picker — the user selects it and the request fails.

`ReasoningEffortMapping` in `Wei-Shaw/sub2api` solves the same problem the same way (rewrite, then
apply a per-group ceiling); this is that idea reduced to two upstreams.

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
- The generated Codex catalog declares `gpt-5.6-sol` with `medium|high|xhigh` and Claude models with
  `low|medium|high|xhigh|max`.
- An effort the target upstream does not accept is clamped, not forwarded.
- A request naming an unknown model is answered by the Claude fallback, and the response reports the
  model that ran.

## Verification (2026-08-31, before implementation)

Both halves were exercised standalone, outside Electron, against Ral's real subscriptions:

```
Claude   POST /v1/responses → HTTP 200 · "Anthropic built me." · 206 tok · 4421 ms
pi agent stopReason "stop"  · "PI-BRIDGE-OK" · 3997 ms
Codex    CodexRuntimeService.run({model:'gpt-5.5', effort:'low'})
         → provider openai-codex · model gpt-5.5 · "GPT-5 mini" · 5951 ms
```

The Codex run used `<userData>/cowork/pi/auth.json` from `Bitterless_DEBUG_PROD`, which holds a
`type/access/refresh/expires/accountId` credential — i.e. the ChatGPT subscription Bitterless already
logs into for Translator.

## Entry points

- `src/main/claudeSubscription/claudeResponses.server.ts` — dispatch
- `src/main/claudeSubscription/claudeResponses.translator.ts` — model and effort resolution
- `src/main/codex/codexRuntime.service.ts` — `CODEX_RUNTIME_MODELS`, `CODEX_RUNTIME_MODEL_EFFORTS`,
  `run()`
- `src/shared/claudeSubscription/claudeSubscription.contract.ts` — catalog generation

## Related

- `claude-subscription-account-slots.md` — the Claude account model this builds on
- Reference: [`Wei-Shaw/sub2api`](https://github.com/Wei-Shaw/sub2api) — model-name dispatch,
  configurable model list, effort mapping with a per-group ceiling. A multi-tenant Go gateway, so
  only the concepts transfer, not the architecture.
