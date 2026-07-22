---
id: translator-miniapp-001-1
status: pass
reviewed_task: translator-miniapp-001
date: 2026-07-22
review_type: independent-static
---

# Verdict

**PASS. No P1, P2, or P3 finding remains.**

# Findings

- P1 blocking: none.
- P2 blocking: none.
- P3 non-blocking: none.

# Resolved Findings

1. **Invalid persisted Omni layouts now fail closed to a visible default browser leaf.**

   The shared parser validates the complete tree before it is trusted: node variants, bounded and
   unique trimmed IDs, HTTP(S) URL syntax and length, split direction, at least two children,
   positive finite size arity and normalization, maximum depth, and maximum node count
   (`src/shared/omni/omni.types.ts:77`). Legacy missing leaf fields still receive only the explicitly
   documented browser/Todo defaults. Main uses the same parser for persisted restore, renderer
   updates, tree assignment, and persistence (`src/main/windows/omniWindow.helper.ts:462`, `:466`,
   `:964`, `:1020`); Omni Control uses it for load, apply, and save
   (`src/renderer/omni/omniControl/src/store/layout.store.ts:162`, `:169`, `:182`, `:188`).

   A parse failure installs the deterministic Bing browser tree and sets a Main-owned recovery
   state (`src/main/windows/omniWindow.helper.ts:978`). That state is retained and replayed together
   with mini-app load failures after control `did-finish-load` and whenever the control overlay is
   shown (`src/main/windows/omniWindow.helper.ts:396`, `:447`, `:641`). Omni Control also catches an
   invalid direct load itself and renders the shared localized recovery alert, so event ordering
   cannot lose the user-visible error (`src/renderer/omni/omniControl/src/store/layout.store.ts:188`,
   `src/renderer/omni/omniControl/src/App.vue:14`).

2. **Ordinary Pi auth-file refreshes no longer invalidate an in-flight final translation.**

   Both the direct file watcher and its suppression-window trailing reconciliation now call
   `refreshCredentialState(false)` (`src/main/modelProvider/modelProvider.service.ts:450`, `:495`).
   The semantic path returns without committing or advancing the epoch when the provider remains
   `ready`, while a real auth-state/invalidation change still commits with `advanceEpoch=true`
   (`src/main/modelProvider/modelProvider.service.ts:461`). Explicit login/logout credential
   transitions continue through `handleCredentialTransition()` and the default epoch-advancing
   commit (`src/main/modelProvider/modelProvider.service.ts:507`). Thus token refresh writes cannot
   turn the only final request into an unretried `cancelled`, while stale observations across real
   login/logout remain fenced.

# Accepted Evidence

- Provider status is value-free and persisted under the Codex provider key in Core SQLite.
  Persistence reads, malformed records, and failed writes fail closed to `unavailable` or
  `invalidated`; writes receive an immediate bounded retry followed by dirty trailing retries and
  reconciliation (`src/main/modelProvider/modelProvider.service.ts:375`, `:402`, `:532`, `:586`).
- Runtime observations carry a provider epoch. Login/logout or semantic status transitions advance
  it, and `noteRuntimeSuccess()` / `noteRuntimeAuthRequired()` reject genuinely stale observations
  before mutation (`src/main/modelProvider/modelProvider.service.ts:163`, `:321`, `:340`).
- Credential suppression has a trailing reconciliation timer, so file activity during the
  two-second transition window is not dropped
  (`src/main/modelProvider/modelProvider.service.ts:148`, `:495`).
- Runtime auth classification recognizes invalid grant/token, revoked/expired credentials, strong
  `401`, and explicit missing credentials while vetoing ambiguous expiry, generic `403`,
  Cloudflare, timeout, rate limit, blocked, and network-unavailable signals
  (`src/main/codex/codexRuntime.service.ts:198`).
- Translator timeout aborts the shared signal, while Pi session creation and `session.prompt()`
  race that signal. Stream and final-message collection enforce the UTF-8 byte ceiling and stop
  appending after the limit (`src/main/translator/translator.service.ts:193`;
  `src/main/codex/codexRuntime.service.ts:338`, `:366`, `:499`).
- Renderer input clamps by Unicode code point, Arco receives code-point `wordLength`/`wordSlice`
  functions for paste, and Main independently accepts at most 12,000 code points with a 24,000
  UTF-16-unit hard bound (`src/renderer/translator/src/store/translator.store.ts:110`,
  `src/renderer/translator/src/App.vue:44`, `src/shared/translator/translator.schema.ts:15`).
- The VueUse throttle uses both trailing and leading execution at 1,000 ms. Each call reads the
  latest revision, cancels the prior per-client request, fences late responses, and suppresses
  identical submissions (`src/renderer/translator/src/store/translator.store.ts:146`, `:225`).
- Provider/model/effort are Main-controlled constants fixed to
  `openai-codex / gpt-5.5 / low`; request and output Zod schemas are strict, and only the validated
  `translation` string crosses to the renderer
  (`src/shared/modelProvider/modelProvider.contract.ts:1`,
  `src/shared/translator/translator.schema.ts:15`,
  `src/main/translator/translator.service.ts:86`, `:194`, `:208`).
- Home and Translator subscribe to the same XPC snapshot broadcast and both render Login for
  login-required, invalidated, and unavailable states
  (`src/renderer/home/src/views/setting/components/LLMSetting/llmSetting.store.ts:83`,
  `src/renderer/translator/src/store/translator.store.ts:89`,
  `src/renderer/home/src/views/setting/components/LLMSetting/LLMSetting.vue:135`,
  `src/renderer/translator/src/App.vue:124`).
- Mini-app cells create no Omni browser menubar and consume the full cell height. Missing/failed
  local targets never fall back to a remote URL; their failure state is retained and replayed
  (`src/main/windows/omniWindow.helper.ts:622`, `:631`, `:710`, `:731`, `:1032`).
- Translator exists only as an Omni mini-app renderer/preload target. Its renderer has no connector,
  provider selector, model selector, effort selector, or standalone-window action.

# Checks

- `yarn typecheck:node` — PASS.
- `yarn check:renderer-i18n` — PASS.
- Scoped ESLint over the provider, Codex runtime, Translator, Home Model Config, shared Omni parser,
  and Omni touched TypeScript/Vue files — PASS with 0 errors (formatting warnings remain in
  legacy-style files).
- `git diff --check` — PASS.
- `yarn typecheck:web` — FAILS only on the unrelated existing baseline in Connector, Coin, Poker,
  Home Chat/emitter/window types, Maestro bridges, Omni Window, EyesOnAgents, and path-helper files.
  No diagnostic targets Translator, model-provider, shared Omni parser, Omni Control, or Home Model
  Config files reviewed by this task.

# Conclusion

The original two P2 findings are closed, and the previously accepted provider, invalidation,
translation, XPC synchronization, and Omni embedding contracts remain intact. The task passes
independent static verification.

# Verification Boundary

Per Ral's instruction, this review did not launch Electron, a browser, UI/runtime tests, or E2E.
The verdict is based on source inspection and static checks only.
