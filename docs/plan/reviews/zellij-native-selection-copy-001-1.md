# Review: Zellij native selection copy 001

Date: 2026-09-17. Independent verifier; did not implement production code or regression tests.

Contract: [issue](../../issues/zellij-terminal-cmd-copy-paste.md) and
[task](../tasks/zellij-native-selection-copy-001.md). Scope: native-copy service, protocol/types,
WebBridge, KeyBridge, runtime/surface wiring and their focused tests. Earlier shell/theme work
and unrelated worktree changes are outside this review.

## Findings and result

**PASS. No open blocking findings.** Two P2 blocking findings from the initial candidate were
fixed and independently rechecked:

- Same-target `register()` cleared the healthy attached copy client. The final
  `zellijWebBridge.service.ts:41` is idempotent for that target, preserving the exact peer.
  Socket regression and actual native-renderer acceptance both verify copying after another
  prepare without reconnect. This satisfies the issue's lifecycle/current-client contract.
- Strict UTF-8 decoding stripped a selected leading U+FEFF. The final decoder in
  `zellijNativeCopy.service.ts` uses `ignoreBOM: true`; protocol and KeyBridge tests preserve
  the original BOM, Chinese, emoji and line breaks. This satisfies exact Unicode copying.

## Evidence

- Browser selection remains first; native fallback is injected through the surface's prepared
  session and requires exactly one attached web client. Copy never creates a CLI connection
  or supplies another client ID. Missing/ambiguous, retired and replaced clients resolve empty.
- The page marker follows earlier mouse input over the existing terminal WebSocket. The
  bridge consumes it and sends pinned 0.45.1 actions `QueryTabNames -> Copy -> QueryTabNames`
  on that connection. The screen/server FIFO barriers exclude earlier automatic OSC 52;
  ordinary Render and UnblockInputThread do not complete the request. Raw forwarded protobuf
  bodies preserve fields outside the projection, with bounded framing and backpressure.
- One active request plus the latest queued request is bounded by timeout. Cancelled marker
  and fence traffic drains before reuse; late reserved markers never reach the shell.
  Navigation/destruction cancel Main writes. Timeout disables copying for that peer while
  terminal rendering remains healthy; a new attachment restores eligibility.
- Only one complete, canonical base64, valid UTF-8 OSC 52 payload of at most 1 MiB is accepted
  inside a request. Empty, invalid, incomplete, multiple or oversized results leave the
  clipboard unchanged. Clipboard permissions remain denied, no old selection is cached,
  errors omit terminal text, and Cmd+V/Ctrl+C/non-macOS behavior is preserved.

## Verification

- Independently ran `yarn node --test tests/zellij/zellijKeyBridge.test.mjs
  tests/zellij/zellijNativeCopy.test.mjs tests/zellij/zellijWebBridge.test.mjs`:
  **28/28 pass, zero skips**. Inspected assertions for fragmentation, queue/cancellation,
  peer/session isolation, repeated prepare, timeout health, Unicode and browser copy/paste.
- Inspected the separate renderer's final `tmp/zellij-copy-acceptance/result.json` in the
  workspace root: all six groups pass using production NativeSession, WebBridge and KeyBridge,
  with Electron clipboard replaced by a memory sink. Real native drag has empty xterm
  selection but copies exact Chinese/emoji/multiline text immediately after mouseup. Repeated
  copies, same-target register, clearing selection and the existing xterm path pass.
  Tested implementation bundle SHA-256:
  `f5d518a5f2739e685ece16b3e623b646cd4cac812f43f6005230146062cb41d9`.
- Inspected the parent's full-suite log
  `tmp/zellij-native-copy-release/bl-zellij-tests.log`: **211/211 pass, zero skips**.

## Limits

Pinned Zellij clipboard Render output has no request identifier. A lone program-generated
OSC 52 inside the bounded Copy window is indistinguishable from native selection output;
multiple/malformed payloads are rejected. This documented upstream constraint remains and
does not require a native fork for this repair.

No Electron E2E, installed/packaged-app launch, real user session/configuration or system
clipboard was used. The actual rendering fixture used staged Zellij 0.45.1 and headless Chrome;
its expected browser clipboard denials are recorded, and all fixture processes were cleaned.
Packaged publication and owner runtime acceptance are separate from this source review.
