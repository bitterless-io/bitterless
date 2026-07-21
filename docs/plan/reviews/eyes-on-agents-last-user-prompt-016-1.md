# EyesOnAgents Last User Prompt Review

Status: accepted

Date: 2026-07-21

## Findings resolved

No open P1, P2, or P3 finding remains.

- Same-turn App Server recovery now preserves an already available Hook-owned preview even when the
  provider reports a later completion time. Its content-free checked watermark may still advance.
- The shared persistence contract rejects unpaired Unicode surrogate values in addition to NUL and
  the 8,192-byte UTF-8 bound.
- The feature and task documents now assign the preference UI, migration, normalized snapshot, and
  Focus recovery to task 018, while task 016 owns only trusted live Hook capture, offline stripping,
  preference-epoch fencing, and atomic Hook persistence.
- Invalid Hook prompt content is documented as a silent metadata-only degradation because the live
  protocol intentionally exposes no content-error discriminator.

## Static contract assessment

- V1 deliveries remain replayable. V2 prompt fields are an exact, paired allowlist accepted only for
  `UserPromptSubmit`; `Stop.last_assistant_message` and every other content field remain excluded.
- The helper checks the sibling capability marker before deriving a Unicode-safe bounded preview,
  and Main checks the current marker plus preference epoch again immediately before persistence.
- Failed sends and lost acknowledgements retain delivery identity but project to metadata-only form
  before any pending or temporary file write. Outbox reads reject content-bearing entries, and
  quarantine stores only a content-free descriptor.
- Trust admission and prompt-preference epochs remain independent. Disable waits for the admitted
  Focus and Hook write tails before clearing all six columns, while older queued deliveries retain
  lifecycle/receipt behavior without regaining prompt authority after re-enable.
- Hook delivery receipt insertion, lifecycle mutation, and latest-prompt mutation share one SQLite
  transaction. Duplicate, rollback, monotonic Hook ordering, App Server recovery, archive, unread,
  Domain, title, and connection behavior retain their existing contracts.
- No renderer operation accepts prompt content or arbitrary thread IDs for recovery, and no prompt
  text was added to the compact ThreadCard or Connections drawer.

## Conclusion

**Pass.** Task 016 satisfies the documented static privacy, compatibility, atomicity, and ordering
contract.

## Verification

Per owner instruction, this review ran no tests, build, typecheck, formatter, migration audit, or
Electron process. The assessment used current documents, source, focused regression-test changes,
and independent static diff inspection. Ral retains runtime and command verification.
