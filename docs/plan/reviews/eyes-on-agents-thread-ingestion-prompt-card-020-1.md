# EyesOnAgents Thread Ingestion And Prompt Card Review 1

Status: accepted

Date: 2026-07-21

Task: [eyes-on-agents-thread-ingestion-prompt-card-020](../tasks/eyes-on-agents-thread-ingestion-prompt-card-020.md)

## Scope

Two independent read-only reviews inspected the final backend/core and UI/guide implementation
against task 020, the normalized-ingestion issue, the latest-user-prompt privacy contract, and the
existing tiered refresh/runtime concurrency rules.

## Findings resolved during review

- Tiered repair previously cleared an old diagnostic through the current global generation, which
  could suppress a newer in-flight thread's failure. The final implementation clears tiered
  diagnostics by matching thread ID without advancing targeted-operation generation.
- App Server teardown could finish its first work join before a concurrently draining Hook write
  scheduled title enrichment. `shutdown()` now settles both teardown paths, performs a final App
  Server work join after no Hook can schedule more work, and only then rethrows a teardown error.
- Static regression contracts now cover both races and a surrogate pair positioned exactly across
  the 300 UTF-16-code-unit title boundary.
- The task Path inventory was corrected to include the shared type and Connection-panel stylesheet.

## Accepted evidence

- A valid UUID is admitted independently of optional title, preview, cwd, status, or activity
  fields. A valid name short-circuits preview access; preview fallback folds whitespace and safely
  truncates without retaining half a surrogate pair.
- Full Refresh, `thread/read`, and raw-snapshot recovery use one name-first title rule. A malformed
  raw snapshot cannot roll back lifecycle persistence, and tiered reads cannot clear a valid title
  with a null projection.
- Missing-title reads start after lifecycle/receipt persistence, are same-thread single-flight,
  never auto-connect or list turns, and write through a non-archived NULL-title compare-and-set.
  The public Hook acknowledgement still exposes only `{ duplicate }`.
- Title-enrichment diagnostics are Main-memory, enum-bounded, content-free, drawer-only, and do not
  change App Server connection state. Success and full Refresh clear them without stale-result races.
- ThreadCard renders one quiet single-line question echo only for available/pending state. Default-
  off/unavailable adds no height; stored bounded content remains unchanged and truncation is exposed
  through localized tooltip/accessibility text.
- The always-visible Codex observation guide contains four steps and explicitly states that latest-
  question retention is independent from Hook trust, off by default, locally bounded, cleared when
  disabled, and excludes replies, reasoning, tools, attachments, earlier questions, and history.

## Verification boundary

The reviews used static source inspection only. Per Ral's instruction, this delivery did not run
Electron, tests, builds, typecheck, lint, or formatter. Runtime verification, commit, and push remain
with Ral.
