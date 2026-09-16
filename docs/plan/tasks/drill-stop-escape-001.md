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
