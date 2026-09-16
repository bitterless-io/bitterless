---
id: drill-stop-escape-001
scope: Maestro chat Escape stop parity
status: in-progress
depends-on: []
verify: behavioral regressions, focused types, build, independent review
---

## objective

Implement the contract in [the issue](../../issues/drill-target-close-and-chat-escape.md), then merge into the original attached release/2608 branch and synchronize Git.

## context

- docs/INDEX.md
- docs/issues/drill-target-close-and-chat-escape.md

## path

- src/renderer/maestro/control/ chat and stop handling
- Focused chat interaction tests

## verification

Actual implementation regression coverage for the issue contract. Record commands, results and limitations below.

## evidence

- Implementation: `ChatPanel.vue` shares `stopEnabled` and the existing `stop()` action between the button and plain Escape. The listener lives only for the mounted panel, checks the current channel/session and focused, visible chat surface, and leaves overlays, modified/repeated keys and IME composition untouched. Body focus is supported because the composer becomes disabled during generation. No runtime, model, saved-message, or browser-tab behavior was changed.
- `yarn test:chat-escape` — PASS, 8 behavior tests compiling and mounting the actual ChatPanel, Arco controls, MessageList and message/channel stores. Tests compare real Stop clicks and DOM Escape dispatch through the stubbed XPC abort boundary, retained/persisted partial replies, busy/aborting state, another session, focus/visibility, modifiers/repeat/IME, the real history Drawer, modal/menu/model popups, tooltips and listener teardown.
- Regression confirmed against `ad114af0`'s original ChatPanel with the same mounted-component test: Escape from body after the composer disables fails because Stop is not invoked. The implemented component passes.
- `yarn typecheck:chat` — PASS; focused Vue/TypeScript compilation of ChatPanel and its transitive dependencies using the existing Maestro bridge declarations.
- `yarn check:chat-composer` — PASS; existing composer, attachment, voice and shared-control checks retained.
- Test limits: JSDOM supplies focus/visibility/layout boundaries; Electron XPC and message rendering are stubbed. No model/network calls or production data were used. This verifies renderer action parity and existing store persistence, not native model cancellation timing. The unchanged Stop runtime chain already calls `BaseAgent.abort()`.
- Independent review PASS at `89efa8e7`: all eight behavioral tests, focused types and existing composer guards passed. Root `yarn build` passed for the complete Electron application. Merged into the original attached `release/2608` branch; regression checks rerun on the identical merged source tree in the isolated dependency environment.

## Native parity follow-up

Verify and fix the same early normal Stop receipt in Maestro BaseAgent under the issue contract. Add actual BaseAgent cancellation regressions, preserve existing ACP runtime/socket integration, rerun focused chat types/tests and full build, then independent review and sync `release/2608` again.

- Original failure reproduced with the actual `BaseAgent` module before source edits: while its raw model promise was deferred, Stop acknowledged, a replacement was admitted, two runtime sessions existed, and the old turn still delivered text/tool activity (`events: 3`, `streams: 1`, `activity: 1`). The same regression now passes.
- Native implementation reuses the cancellation generation and prompt/disposal ownership. Stop invalidates synchronously, shares concurrent cleanup, waits for actual initialization, raw model promises and already-started host tools, then drops the old session. Late events/results and subsequent tool dispatch are suppressed. Native abort errors remain errors after the model drains. Existing timeout wrappers cannot serve as proof that the underlying work ended.
- `yarn test:agent-stop` — PASS, 8 behavior tests executing the complete actual BaseAgent class. Cases cover the reproduced failure, 500 ms/1500 ms former cutoffs, repeated/idle Stop, cleanup failure, model/startup timeout races, late tool rejection, active tool drain, fresh turns and disposal.
- `yarn typecheck:agent-stop` — PASS, strict TypeScript (`noCheck: false`) over actual BaseAgent and transitive runtime dependencies.
- `yarn typecheck:acp && yarn test:acp` — PASS, strict host/core types, 13 real protocol/socket/helper subprocess regressions and the actual native Maestro/SQLite/shipping-helper integration.
- `yarn typecheck:chat && yarn test:chat-escape && yarn check:chat-composer` — PASS, focused chat types, 8 mounted chat behaviors and existing composer checks.
- `yarn build` — PASS, complete Electron main/preload/renderer build (22.20 s). No packaging/signing/upload performed.
- Limits: model/network adapter and Electron boundaries are synthetic. Native Stop tests use real timers and module code, without a live model or GUI session. They prove that already-started effects are drained, not rolled back. Independent review and the follow-up merge/Git synchronization remain pending.

## Review follow-up: renderer receipt and failed cleanup retry

- Independent review found that the renderer still raced native Stop against 900 ms and that ordinary `send()` completion could also clear the stopping state before native cleanup. Actual mounted-store regressions reproduced both failures plus swallowed cleanup rejection before repair.
- The store now keeps the original turn busy until the native Stop receipt. That ownership survives a model reply, a session switch and a failed Stop; failure exposes a diagnostic through the existing chat notification and retains a working retry. The partial reply is preserved and persisted after successful cleanup.
- Native Stop consumes the raw model's cancellation result while still waiting for it to settle; a normal fetch `AbortError` no longer masquerades as cleanup failure. Actual cleanup failures retain the concrete runtime sessions and block replacement until retry succeeds, including a prior reset session whose cleanup failed while a fresh turn drained.
- `yarn test:agent-stop` — PASS, 13 actual-module tests; the added AbortError, failed-cleanup retry, failed-reset-session ownership and shared GUI/ACP ownership cases were each RED before repair. The original native prompt retains the existing shared turn owner until its accepted Stop cleanup settles, while first signalling its own drain to avoid a cancellation deadlock. This also covers Stop accepted after the model finished while a host tool still runs: the managed prompt joins its actual tools before releasing ownership. `yarn typecheck:agent-stop` — PASS with strict actual runtime dependencies.
- `yarn test:chat-escape` — PASS, 13 mounted SFC/store tests. Added cases cover waits beyond 900 ms, native rejection and retry, both real `send()`/Stop-receipt settlement orders, late `send()` completion after failed Stop, original-session identity and retained partial replies. `yarn typecheck:chat` and `yarn check:chat-composer` — PASS.
- ACP strict types, 13 protocol/helper tests and the native Maestro/SQLite/helper integration pass. Verification still substitutes the model/network and Electron boundaries; independent review and merge/sync remain pending.
- Final follow-up `yarn build` — PASS on the final executable source (19.48 s); the native Maestro/SQLite/helper integration was rerun after the final managed-tool ownership change and passed.
