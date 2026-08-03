---
id: codex-production-login-recovery-012-1
status: pass
reviewed_task: codex-production-login-recovery-012
date: 2026-08-03
review_type: independent-source-and-test
---

# Codex Production Login Recovery Review 1

## 1. Findings

- None. No P1/P2/P3 blocking or non-blocking finding was identified in the scoped Codex browser
  login recovery.

The implementation matches the task and model-provider contracts:

- Pi 0.80.10 remains the IPv4 callback, token-exchange, and credential owner. Its local source
  advertises `http://localhost:1455/auth/callback`, binds `127.0.0.1:1455`, emits `auth_url` only
  after that listener starts, and races its callback with the `manual_code` prompt
  (`node_modules/@earendil-works/pi-ai/dist/auth/oauth/openai-codex.js:26`, `:244`, `:353`).
- On macOS the attempt creates the `::1:1455` companion before starting Pi login, then forwards an
  IPv6 redirect only through that same Pi login's `manual_code` prompt; Pi still performs state
  validation, code exchange, and credential writes
  (`src/main/codex/codexCredential.service.ts:471`, `:593`, `:612`).
- Before opening the browser, the process-local HTTP diagnostics observer requires private 404
  probe evidence for the actual `localhost` route, Pi IPv4, and the macOS IPv6 companion. A missing,
  foreign, timed-out, or unexpected listener aborts the attempt before `openExternal`
  (`src/main/codex/codexLoopbackObserver.service.ts:129`, `:241`, `:285`;
  `src/main/codex/codexCredential.service.ts:636`).
- IPv4 callback acceptance closes and then cancels the unused IPv6 wait; IPv6 completion feeds Pi
  without taking ownership of exchange or storage. Timeout, cancellation, completion, and a
  capture that resolves after cancellation all cancel and close their resources
  (`src/main/codex/codexCredential.service.ts:530`, `:564`, `:783`;
  `src/main/codex/codexCallbackCapture.ts:73`).
- Attempt identity and abort state fence every read, promotion, verification, and late cleanup. A
  cancelled or replaced attempt cannot promote its credential or remove a newer successful
  attempt's credential (`src/main/codex/codexCredential.service.ts:374`, `:741`, `:773`, `:885`).
- The installed production ASAR still contains only the old `callback-listener-ready owner=pi`
  flow and no companion/ownership-probe stages, consistent with the production-log diagnosis and
  confirming this patch restores behavior absent from release `0.0.64`.

## 2. Verification

- `yarn test:model-provider` — passed, 17/17.
- `yarn typecheck:node` — passed.
- `git diff --check origin/release/2608..HEAD` and `git diff --check` — passed.
- Inspected Pi 0.80.10 source and `/Applications/Bitterless.app/Contents/Resources/app.asar` for the
  current callback bind and previously shipped behavior.

## 3. Conclusion

**pass**

Commit `3d28ffd` satisfies the scoped production Codex login recovery contract and is ready for the
release step. Signed packaging/publication remains the task orchestrator's post-review action.
