# Bitterless model provider (Qwen through the Bitterless relay)

Status: **implemented, not yet run end to end in the app** — see *Verification*.

Requested by Ral 2026-09-23: *「bitterless 客户端要增加一个 provider 叫做 bitterless，先只提供
qwen3.8-flash 和 max，bl 前端模型配置参考 cowork relay，参考 micromeet mono」*.

Reference implementation: `micromeet-cowork`
`apps/cowork/src/main/agent/runtime/aiCrmsProvider.ts` + `apps/cowork/src/main/llm/llmModels.ts`.
Server side: `bitterless-private` `docs/features/bailian-qwen-relay.md`.

## What this adds

A third selectable LLM backend beside Codex:

| Provider | Credential | Models |
|---|---|---|
| `openai-codex` | pi OAuth (coding-agent subscription) | GPT-6 Astra / 5.6 Sol / Terra / Luna |
| **`bitterless`** | **the Bitterless account the user is already signed into** | **Qwen 3.8 Max, Qwen 3.8 Flash** |

## It is a pi provider, not a second agent

This copies cowork's conclusion rather than re-deriving it. The relay speaks standard OpenAI
`chat/completions`, so it is registered into pi's `ModelRuntime` and the agent loop, built-in tools,
compaction and steering stay **one implementation**. Cowork learned this the expensive way: a
separate hand-written session for its relay accepted `builtinTools` in its types and ignored them at
runtime, so a system prompt promising `bash` reached a runtime that had none — one "say hello" burned
37 steps and never sent the message (`agent-capability-must-not-depend-on-provider.md`). Capability
must not vary by provider, so there is no `bitterless` runtime adapter.

## Credential: the app's own login, not an OAuth flow

`registerBitterlessProvider()` reads `customerSessionService` — the Core session token the renderer
pushes into main after login, already used by `web_search`. That token is the relay's `apiKey`.

Two consequences, both deliberate:

- **`bitterless` is NOT in `LLM_LOGIN_PROVIDERS`.** That table drives pi's browser/device-code login;
  giving this provider a button there would send people into a flow that does not exist for it. The
  user signs in through the app's normal Bitterless login.
- **Not signed in ⇒ registration is skipped silently, not thrown.** Registration happens on every
  `ModelRuntime` construction, including while the user is happily using Codex. A throw would take
  Codex down with it. Unsigned-in simply means these two models are not selectable, and the existing
  "not signed in" path reports which provider needs attention.

## Where it registers, and why there

Inside `createModelRuntime()` in `piRuntimeAdapter.ts` — not only in `createSession()` — so every
runtime that adapter builds (sessions, the auto-compaction self-test, the context-window lookup)
knows the provider. `registerProvider` is upsert, and both `baseUrl` and the token are runtime
values, so re-registering per runtime is the correct cost.

Registration lives on that runtime **instance**: pi has no built-in `bitterless`, so a runtime built
anywhere else has never heard of it. This section used to claim that registering here made
`checkTarget()` answer correctly; `checkTarget()` has no callers, and the readiness Control gates on
came from a different path that built its own, never-registered runtime — so Bitterless was never
ready and chat asked the user to "Sign in to Bitterless" while they were signed in
([bitterless-provider-asks-to-sign-in-inside-chat.md](../issues/bitterless-provider-asks-to-sign-in-inside-chat.md)).
Hence:

- **Readiness is a pure session read, not a runtime lookup.** `MaestroLlmService.checkLlmProviderReady()`
  answers `bitterless` as ready iff the app-account session is in main (`customerSessionService.current`,
  which exists only with both token and base URL) and the model is a Bitterless preset — no runtime,
  no lock, no network; the same shape as Cowork's `ai-crms` branch. Main re-broadcasts
  `coach/llm-config` whenever that session changes (sign-in, restore, sign-out, invalidation), so
  readiness follows it without re-selecting the model. Control's "Sign in to Bitterless" card never
  calls `loginLlm` for this provider: its Login button re-validates the app-account session, and an
  invalid session lands on the login form.
- **Main-process runtimes built outside the adapter must register it too.** The compaction handler's
  `resolveTarget()` (`compaction.handler.ts`, which serves `shouldCompact` — the automatic compaction's
  real-usage veto; `/compact` itself runs on the session's own, already-registered runtime) builds its own
  runtime, so for a Bitterless target it calls `registerBitterlessProvider()` before looking the model up.
  **Known gap:** workflow agents run in a utilityProcess with their own runtime and a relay descriptor that only
  knows `ai-crms`, so a Bitterless target there reports `Workflow model authentication unavailable`
  (review [189-1](../plan/reviews/bitterless-provider-readiness-189-1.md) F2; tracked separately).

## Relay endpoint

`resolveBitterlessRelayBaseUrl()` hands pi the **provider prefix root** (`…/v1/bailian`); pi appends
`/chat/completions`. A configured value that already carries the suffix is stripped, or the URL
becomes `/chat/completions/chat/completions`.

Default is the deployed Shanghai relay; `BITTERLESS_RELAY_URL` overrides it for local or test relays.

## Model metadata

`compat` mirrors what the upstream actually wants: `thinkingFormat: 'qwen'` (with `reasoning: true`
on each model, or pi short-circuits and `enable_thinking` is never sent), `maxTokensField:
'max_tokens'`, and `supportsUsageInStreaming` so the relay can bill a streamed turn. Cost is reported
as `0` rather than an invented number — the client is not billed per token; the cost surface is
server-side.

Presets sit **after** the Codex ones in `LLM_PRESETS`. `normalizeLlmTarget()`'s last-resort fallback
is `LLM_PRESETS[0]`; putting Qwen first would have silently moved where stray or retired targets
land, from Astra to Qwen Max. Nobody asked to change the default model.

The client catalog is convenience, not authority: the relay's `BAILIAN_ALLOWED_MODELS` is the real
gate, so listing a model here that the relay does not allow yields a clean `400` rather than access.

## Verification

- `yarn typecheck` — the three touched files produce no diagnostics. (The repository has 97
  pre-existing diagnostics on this branch, none in these files and none introduced here.)
- Server side is fully verified, including the session-token channel this provider uses and
  revocation enforcement — see `bailian-qwen-relay.md`.

**Not done:** launching the app and driving a real turn through the picker. Per this workspace's
rules Electron E2E is not run unprompted; this needs Ral to sign in and pick *Bitterless → Qwen 3.8
Max* once. Nothing else is expected to be required.
