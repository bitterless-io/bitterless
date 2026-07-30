---
id: model-provider-fresh-login-callback-009-1
target: deb2e2bb83824e751f351838c804667a6804140e
compared_with: model-provider-fresh-login-callback-009
status: pass
---

# Verdict

**PASS. No P1, P2, or P3 blocking or non-blocking finding was identified.**

# Findings

None.

# Contract evidence

- The installed and manifest-pinned `@earendil-works/pi-coding-agent` is 0.80.10. Its public
  `dist/index.d.ts` exports `ModelRuntime` but not `AuthStorage`; a live package import confirmed
  `AuthStorage` is absent and an `allowModelNetwork: false` runtime exposes
  `openai-codex/gpt-5.5`.
- `codexCredential.service.ts:201-214` centralizes authentication/status runtime creation and always
  passes `allowModelNetwork: false`. Status probes the retained GPT-5.5 target through this path at
  lines 236-252, and logout does the same at lines 339-359.
- A fresh attempt creates an isolated memory store, creates the app-owned persistent store, and
  deletes the old `openai-codex` credential before runtime construction or the auth URL at
  `codexCredential.service.ts:385-400`.
- The modern runtime is detected and created before any companion callback capture. The capture is
  created only when no `ModelRuntime` exists at `codexCredential.service.ts:395-408`, leaving Pi
  0.80.10 as the sole owner of `localhost:1455`.
- The modern manual-code prompt waits on both Pi's prompt signal and the attempt abort signal at
  `codexCredential.service.ts:424-449`. This lets Pi's internal callback win normally while Cancel
  rejects the prompt and releases the internal server.
- Promotion reads only the attempt store and writes only after the current-generation assertions
  at `codexCredential.service.ts:451-483`. Cancel increments the generation, aborts the attempt,
  closes any legacy capture, and serially deletes a promoted credential at lines 320-336; the final
  fence repeats cleanup for a late promotion at lines 493-505.
- `CodexFileCredentialStore` uses Pi's object-shaped `auth.json`, mode 0600, `${authPath}.lock`
  directory, 30-second stale threshold, and bounded retry at
  `codexCredential.store.ts:22-25, 50-55, 97-153`. Its instance operation queue serializes
  promotion and cancel cleanup at lines 156-163. The in-memory store serializes per-provider
  writes at lines 166-208.
- Focused tests cover the real file shape/mode, promotion-versus-delete ordering, legacy callback
  capture, modern sole callback ownership, old-credential deletion before login, empty isolated
  storage, disabled model network, timeout cleanup, Cancel, and late-result replacement fencing.

# Verification

- `yarn test:model-provider` — pass, 16/16 tests.
- `yarn typecheck:node` — pass.
- Live Pi 0.80.10 runtime smoke — pass: no public `AuthStorage`, GPT-5.5 present, and
  `ModelRuntime.create({ allowModelNetwork: false })` completed without model-network discovery.
- `git diff --check 10da844^..deb2e2b` — pass.
- An additional non-contract full semantic Node TypeScript invocation exceeded the 4 GiB Node heap
  before producing diagnostics; the repository's authoritative `yarn typecheck:node` gate passed.

