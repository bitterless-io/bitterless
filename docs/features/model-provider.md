# Shared Model Providers

Status: Accepted

## Purpose

Main owns one model-provider registry for every first-party renderer. Provider configuration and a
safe status snapshot are persisted in Core SQLite, while credentials remain in their existing
private stores. Home, Translator, and future processes reuse the registry only through XPC.

The current registry contains exactly one provider and one Translator target:

| Provider | Authentication | Model | Effort |
|---|---|---|---|
| `openai-codex` | Codex OAuth through the shared Pi credential service | `gpt-5.5` | `low` |

API-key and Micromeet-session relay authentication are represented as future provider source types,
but no such provider appears until a real runtime adapter, configured credential, and compatible
model exist. In particular, the current Micromeet relay exposes Qwen rather than GPT-5.5 and must
not be mislabeled as the fixed Translator target.

## Persisted State

Core SQLite stores a value-free provider record under `key=model_provider`,
`sub_key=openai-codex`:

```text
schemaVersion · provider · configured models · fixed/default target
auth state · invalidation reason · last observed time · last successful runtime time
```

Allowed auth states are `login_required`, `authenticating`, `ready`, `invalidated`, and
`unavailable`. The record never contains an access token, refresh token, API key, authorization
header, login URL, device code, or provider response body.

Local Pi `hasConfiguredAuth()` can establish initial `ready` versus `login_required`, but it cannot
clear a persisted `invalidated` state because it only proves credential presence. `invalidated`
clears only after a completed login or a real successful provider request.

SQLite read failures and records that fail the strict schema are fail-closed: Main exposes
`unavailable` and publishes no selectable target. Normal state changes are persisted before they
are broadcast. If a write fails, Main immediately exposes the safe `unavailable` or `invalidated`
fallback, retries once, and continues bounded trailing persistence retries; once persistence
recovers, credential status is reconciled again instead of leaving a valid login stuck as
unavailable.

## XPC Contract

```text
Core SQLite SettingDao
       ▲
       │ safe persisted record
ModelProviderService ── shared CodexCredentialService
       │
       ├─ getSnapshot()
       ├─ connect({ method }) / disconnect()
       ├─ noteRuntimeAuthRequired(reason)
       └─ noteRuntimeSuccess()
       │
       └──── broadcast provider snapshot ────► Home Model Config
                                          └─► every Translator cell
```

Each snapshot includes the provider records and an `availableTargets` list. A target is available
only while its provider is `ready`; a provider that merely has a configured record or an on-disk
credential is not selectable while login is required or invalidated.

Every runtime request captures the provider credential epoch. Runtime success or authentication
failure may update provider state only while that epoch is still current, so an old request cannot
overwrite a later login, logout, or semantic credential-state change. Snapshot timestamps are
strictly monotonic inside Main so a late initial fetch cannot replace a newer broadcast in a
renderer.

Login may start from Home or Translator. State transitions are persisted and broadcast, so both
surfaces show `authenticating` and the final `ready` or failure state without polling each other.
The shared Codex credential service also emits value-free `login-succeeded` and
`logout-succeeded` transitions. Existing Main-process consumers that use the same credential
singleton therefore update this registry without exposing credentials to a renderer.

Every explicit Login is a fresh credential replacement. Main removes the previous persisted Codex
credential, authenticates into an isolated in-memory store, and promotes only the current attempt
after success. Pi `ModelRuntime` owns the browser flow and IPv4 callback listener. On macOS an
attempt-local Bitterless companion covers `::1:1455` and can return the redirect only through the
same Pi login's `manual_code` prompt; it never exchanges or stores credentials. The companion also
remains the callback owner for the legacy storage API. Authentication-only runtime instances
disable model-network catalog refresh so OAuth completion is not held behind unrelated discovery.
The app-owned memory and locked-file credential stores implement Pi's current `CredentialStore`
contract and keep its `auth.json`/`.lock` interoperability after Pi removed the public
`AuthStorage` export. Cancel and replacement generations still fence every promotion and late
completion.

For browser login, an authorization URL opens only after Main proves current-process coverage for
the actual `localhost:1455` redirect. Pi's IPv4 listener is checked by a private 404 probe
correlated through process-local Node HTTP diagnostics; macOS additionally requires the
attempt-local IPv6 companion to be listening. A missing or foreign listener, an unavailable
required companion, or an unexpected probe response fails before opening the browser.

Main watches the shared Pi auth file for creation, deletion, and modification so external logout
and ordinary credential changes are observed. File presence or modification alone never clears a
persisted `invalidated` state; that requires an explicit successful-login transition or a real
successful provider request. Watch suppression always schedules a trailing reconciliation. An
ordinary token-file refresh advances the credential epoch only when the effective auth state
changes; a healthy `ready` to `ready` refresh therefore cannot cancel the final Translator result.

## Credential Invalidation

A real provider response containing a deterministic authentication signal (`401`, unauthorized,
invalid/expired/revoked token, invalid grant, or explicit sign-in-required error) becomes a typed
auth-required reason before generic runtime error mapping. Main persists `invalidated`, broadcasts
the new snapshot, and every renderer replaces model actions with the Codex login entry.

Generic `403`, rate limit, timeout, connectivity, blocked, or Cloudflare errors do not invalidate a
credential.

## Home Model Config Layout

```text
┌──────────────────────── Model Config ───────────────────────────────┐
│ ACTIVE MODEL   Provider Codex   Model GPT-5.5   Effort low         │
├───────────────┬─────────────────────────────────────────────────────┤
│ PROVIDERS     │ ✓ Codex connected                       [Logout]   │
│ • Codex       │ Model  GPT-5.5 (fixed)                              │
│               │ Effort low (fixed)                                 │
└───────────────┴─────────────────────────────────────────────────────┘
```

The supplied Workbench image defines the provider-first hierarchy. With one provider, the left
column remains intentionally small and makes the future registry boundary visible. Login-required,
authenticating, ready, invalidated, and unavailable states have localized, actionable copy.

## Entry Points

- `src/shared/modelProvider/`
- `src/main/modelProvider/`
- `src/main/xpc/modelProvider.handler.ts`
- `src/renderer/home/src/views/setting/components/LLMSetting/`
