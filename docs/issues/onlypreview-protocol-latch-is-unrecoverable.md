# The search relay's protocol latch is unrecoverable

Status: **recorded, not fixed** — design ruling pending from Ral. Found while root-causing
[onlypreview-search-failure-payload-latches-protocol-error](onlypreview-search-failure-payload-latches-protocol-error.md),
which fixed the payload mismatch that fired the latch. The latch behaviour itself is untouched.

## What happens

`FileSearchRuntimeRelayService._latchProtocolFailure(active)` stores an `INDEX_PROTOCOL_ERROR` on the
active runtime. From then on:

- every later `call()` rethrows it before doing anything else,
- every later `publish()` rethrows it before validating anything,
- `protocolFailureSignal` rejects every already-pending call in the same tick — which is why three
  in-flight searches died on the same millisecond in the 2026-09-17 log,
- only `attach()` resets it (`protocolFailure: null`). `initialize` cannot, because the rethrow runs
  first.

So one malformed payload disables Project search — both sections, every scope — for the life of the
runtime. The user sees `The Project search index returned an invalid response.` on every subsequent
query, with no retry control, no statement that the subsystem is now disabled, and no way back short
of reopening the workspace.

## Why it is built that way, and why that part is right

The seam is deliberately hostile: preload does the syscalls, Main must not trust what comes back, and
a runtime that emits one structurally invalid message has proven it is not speaking the protocol.
Continuing to serve it would mean validating each message but trusting the sender's state machine,
which is the thing this design refuses. Failing closed is correct.

## What is arguably wrong

**Permanence is a separate decision from failing closed**, and it was never made explicitly:

1. A *shape* mismatch caused by a contract change on one side (exactly what happened on 2026-09-17) is
   not evidence of a compromised runtime — it is evidence of a version skew, and it is recoverable by
   re-attaching.
2. The failure is invisible where triage starts. `publish` lives on the relay handler, so its throw
   never reaches `onlypreview.log`; the only trace is the xpc framework's own line in `main.log`, and
   the sanitizer redacts both identifying strings there (the handler class name and
   `OnlyPreviewContractError` are each ≥24 characters, so both render as `***`). A latched subsystem is
   therefore near-undiagnosable from logs alone.
3. Nothing tells the user the subsystem is disabled rather than momentarily unhappy, so the natural
   response — retry, retype, reopen Global Search — cannot work and gives no new information.

## Options, for the ruling

- **Leave it.** Cheapest, and safe by construction. Cost: any future one-sided contract change bricks
  search in the field again, and the log will not say why.
- **Re-attach once per latch.** On the first latch, tear the runtime down and re-attach it (the one
  existing path that clears the flag), then fail closed for good if it latches again. Recovers version
  skew without granting a misbehaving runtime a second chance to be trusted.
- **Keep the latch, make it legible.** Write the latch to `onlypreview.log` with the operation and the
  failing event name, and give the Shell a distinct message — "Project search is disabled for this
  session" plus a reopen hint — instead of the generic invalid-response sentence.

Recommendation: **the third, and the second only if Ral wants field self-healing.** Legibility is the
defect that actually cost time here; automatic re-attach adds a state transition to the most delicate
lifecycle in the subsystem, and its value drops sharply once the producer↔consumer test from task 180
exists.
