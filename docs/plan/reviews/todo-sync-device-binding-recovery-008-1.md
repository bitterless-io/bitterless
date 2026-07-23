---
id: todo-sync-device-binding-recovery-008-1
task: todo-sync-device-binding-recovery-008
round: 1
result: pass
---

# Todo sync device-binding recovery review — round 1

## Findings

Final P1, P2, and P3 findings: none.

The first pass identified one non-blocking P3 coverage gap: repository tests proved the reset state,
but did not instantiate the coordinator to prove an immediate second HTTP request. The follow-up
test closes it by resolving a conflicting node response and asserting that the same single-flight
run loop sends `sync_token='*'` with no commands before any timer exists. It also proves the
conflicting payload was not applied and that the next full bootstrap installs the new node, token,
and projection before normal scheduling resumes.

## Safety evidence

- Initialization reads the state and runs the clean guard before an identity write or in-flight
  crash recovery. Same-identity activation retains node, cursor, sequence, and error state.
- The clean guard rejects `rejected_batch_id`, every outbox state except `superseded`/`discarded`,
  and `sync_revision='0'` in each projection table.
- Legacy response recovery runs before normal node assignment and response materialization. Its
  compare-and-set update and generation fence commit before the exact expected in-memory node is
  cleared.
- Unsafe identity and node conflicts keep state, outbox, projections, and the in-memory node
  unchanged. A generation-fence failure rolls the transaction back.
- The coordinator-level test proves the second request is immediate, single-flight, uses `*`, and
  completes through the normal full-bootstrap path.

## Verification

- `yarn typecheck:todoist-sync` — pass.
- `yarn test:todoist-sync` — pass, 37/37.
- `git diff --check` — pass.

Electron, packaging, publishing, deployment, and the live DEBUG database were not exercised. The
owner should run production and `dev:prod` together and click DEBUG Todo Refresh. Continuing to
fail closed is expected if that real database contains pending, failed, rejected, or local-only
work; such data needs an explicit recovery decision rather than automatic overwrite.
