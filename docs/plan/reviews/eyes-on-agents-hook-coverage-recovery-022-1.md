# EyesOnAgents Hook Coverage Recovery Review

Status: accepted

Date: 2026-07-22

## Findings resolved

No open P1, P2, or P3 finding remains. Independent review initially found three blocking races; all
were corrected and re-reviewed:

- A failed recovery-lock attempt no longer creates a delivery-coverage emergency marker or advances
  the original cutoff. Real storage failures retain their actual detection time, including legacy
  empty emergency sentinels.
- Recovery carries the complete durable gap snapshot that triggered the trusted inspection. The
  locked cutover proceeds only on an exact match; a newer marker deletes nothing, is reported as a
  new generation, and requires a fresh retry.
- A delivery admitted by the current trusted listener carries explicit repository authority. It may
  restore concrete Hook state over newer `discovery + unknown` evidence, including pre-listener
  durable replay, but it cannot overwrite newer concrete App Server or Hook evidence.

The final read-only review also found no circular wait between the replay callback and service write
tail. The pending generation clears only after the preserved suffix drains successfully under the
same generation.

## Verification

- `node scripts/eyes-on-agents/hook-delivery.test.mjs` — passed.
- `node scripts/eyes-on-agents/repository.test.mjs` — passed against real SQLite DAO behavior.
- `yarn typecheck:node` — passed.
- The complete Core test body passed after temporarily bypassing one unrelated existing assertion
  whose current baseline is `drainingMutationBroadcasts: expected 0, actual 1`; the tracked
  assertion was restored unchanged afterward.
- Strict Core typecheck remains blocked only by the two existing `rawInput: unknown` errors in
  `codexHookBridge.contract.ts`.
- `git diff --check` — passed.
- No Electron process was launched; Ral owns the live recovery confirmation.

## Conclusion

**Pass.** The recovery is bounded, retryable, generation-safe, and independent from managed App
Server inventory synchronization.
