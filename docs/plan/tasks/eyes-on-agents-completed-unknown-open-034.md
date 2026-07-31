---
id: eyes-on-agents-completed-unknown-open-034
scope: settle completed unknown recovery candidates and acknowledge them in one Open
status: implemented; owner verification pending
depends-on: [eyes-on-agents-working-recovery-027, eyes-on-agents-open-status-sync-029]
---

# EyesOnAgents Completed Unknown Open

## Objective

Prevent a completed `discovery + unknown + unread` task from remaining invisibly unread in Focus,
and make one successful `Open` both refresh and acknowledge that task without weakening protection
for genuinely active or unavailable tasks.

## Context

- [Completed unknown Focus issue](../../issues/eyes-on-agents-completed-unknown-stuck-focus.md)
- [EyesOnAgents integration](../../integrations/eyes-on-agents.md)
- [Codex observation feature](../../features/eyes-on-agents-codex-observation.md)
- [Open status sync](eyes-on-agents-open-status-sync-029.md)

## Required behavior

- Extend the existing recovery-candidate latest-turn projection with one explicit terminal
  settlement transition for `completed`, `interrupted`, and `failed`.
- Require a real turn ID, a persisted completion time no later than the poll, and the exact selected
  recovery watermark. Do not infer from elapsed time, `thread/read.status`, transcript content, or
  the absence of an active item.
- Persist the settlement only when SQLite still contains the same non-archived, unread,
  `discovery + unknown` row with no active turn. Map outcomes to `idle`, `ended`, and `failed`;
  record completion identity/time, clear active evidence, retain unread, and advance activity
  monotonically. Do not reject an equal existing `last_completed_turn_id`: the reproduced row
  already had the correct completion marker while its runtime state remained stale.
- Keep terminal settlement, active recovery, active reconciliation, and authority reclaim mutually
  exclusive in the shared refresh-patch parser.
- Route successful completed settlement through the existing durable notification claim.
- Reorder successful Open to deep-link first, run the best-effort one-thread sync second, and call
  `markOpened` last. A terminal settlement is cleared by that same Open; active and unresolved
  unknown rows retain unread.
- Keep Open successful when status sync is disconnected, cancelled, rejected, malformed, or loses
  its compare-and-set race.
- Do not change archive filtering or clear unread merely because a row is unknown or archived.

## Expected paths

- `docs/issues/eyes-on-agents-completed-unknown-stuck-focus.md`
- `docs/INDEX.md`
- `docs/integrations/eyes-on-agents.md`
- `docs/features/eyes-on-agents-codex-observation.md`
- `docs/plan/analysis/eyes-on-agents.md`
- `docs/plan/README.md`
- `src/shared/eyesOnAgents/eyesOnAgents.type.ts`
- `src/shared/eyesOnAgents/eyesOnAgents.contract.ts`
- `src/main/eyesOnAgents/eyesOnAgents.service.ts`
- `src/preload/sqlite/dao/eyesOnAgents.dao.ts`
- `scripts/eyes-on-agents/core.test.mjs`
- `scripts/eyes-on-agents/repository.test.mjs`

## Verification

- Core coverage proves a recovery candidate projects each supported terminal outcome, rejects
  malformed/missing/future completion evidence, and remains mutually exclusive with active
  recovery.
- Core Open coverage proves status sync precedes `markOpened`, one click acknowledges a newly
  settled terminal row, and status-sync failure still records Open.
- Repository coverage proves the exact settlement compare-and-set, outcome mapping, unread
  preservation before acknowledgement, settlement with an equal existing completion ID,
  completion-alert dedupe, and rejection of archived or concurrently changed rows.
- Existing archive coverage continues to prove archived rows disappear from fresh snapshots while
  durable annotations survive unarchive.
- Run the EyesOnAgents non-Electron suites, Node typecheck, and `git diff --check`. Do not launch
  Electron; Ral owns runtime verification.

## Review

- [eyes-on-agents-completed-unknown-open-034-1](../reviews/eyes-on-agents-completed-unknown-open-034-1.md)
  passed with no P1, P2, or P3 finding.

## Delivery evidence

- Added the strict `settledTurn` shared transition and exact SQLite compare-and-set for all three
  supported terminal outcomes, including the reproduced equal-`last_completed_turn_id` shape.
- Reordered Open to deep-link, best-effort status sync, final acknowledgement, notification, and
  snapshot without weakening active/unknown unread protection or archive history.
- `yarn test:eyes-on-agents`, `yarn typecheck:node`, and `git diff --check` pass without launching
  Electron.
- The stricter `yarn typecheck:eyes-on-agents:core` remains blocked only by pre-existing
  `rawInput: unknown` diagnostics in unchanged `codexHookBridge.contract.ts`; no task-034 file is
  reported.
- Ral owns the final live check for one-click removal of a settled task and retention of a genuine
  `inProgress` task in Focus.
