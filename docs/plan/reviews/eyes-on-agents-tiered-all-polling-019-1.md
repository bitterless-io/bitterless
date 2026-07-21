# EyesOnAgents Tiered All-thread Polling Review

Status: accepted

Date: 2026-07-21

## Findings resolved

No open P1, P2, or P3 finding remains.

- A `thread/read` response originally received its evidence time after the response arrived. A
  lifecycle notification could therefore commit while the request was pending and then be replaced
  by the older read carrying a newer local timestamp. Main now captures the evidence time before
  dispatching the read.
- Millisecond timestamps alone cannot order two observations inside the same millisecond. The
  polling repository now accepts a status only when its evidence time is strictly newer than the
  stored value; `NULL` remains the first-write exception, and equal evidence preserves the already
  persisted lifecycle state.
- A repository mutation originally used a cancellation race. Teardown could stop tracking the
  outer operation while the SQLite write continued. Once a page mutation starts, Main now waits for
  it to settle before checking the App Server context. A cancelled batch sends no stale broadcast
  and cannot advance the cold cursor.
- Static regression definitions cover a notification arriving during a pending read, equal-ms
  lifecycle/read evidence, cancellation during a cold read, and cancellation after a cold SQLite
  mutation starts.

## Static contract assessment

- SQLite selects the hot page and current cold page in one transaction, using a fixed size of 40
  and deterministic order by activity, update time, and thread id. Renderer Project/title filters,
  Domain membership, Focus, and attention sorting do not affect selection.
- Every admitted tick processes page 1 before one cold page. The cold cursor cycles from page 2 to
  the last page and back, resets to page 2 whenever total pages shrink, and advances only after the
  cold batch completes.
- Each batch runs at most four row pipelines. Per-row read or parse failures are skipped; repository
  failure and cancellation preserve the cursor. Missing or newly archived rows are ignored during
  the conditional SQLite mutation.
- Title, runtime/session state, monotonic provider activity, and the separately consented latest
  user question share one field-level patch. Semantic no-ops do not update `updated_at` and do not
  broadcast.
- Latest-question recovery remains default-off, bounded to one reverse full-items request and one
  8,192-byte preview. Prompt preference epochs, disable fencing, snapshot redaction, cleanup, and
  the content-free Hook outbox remain intact.
- The renderer retains exactly one ten-second timer and one in-flight silent refresh promise. The
  public Main XPC is parameter-free and returns only `{ changed }`; manual Refresh and activation
  retain full inventory/archive/Project reconciliation.

## Conclusion

**Pass.** Task 019 satisfies the static contract for hot-page plus round-robin cold-page refresh
across every persisted non-archived All thread.

## Verification

Per owner instruction, this review did not run tests, build, typecheck, lint, formatter, or Electron.
The assessment used the task and feature contracts, current source, test definitions, targeted
source searches, and static diff inspection. Ral retains runtime verification.
