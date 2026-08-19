# EyesOnAgents Claude Deletion Sync — Independent Acceptance

Status: accepted for non-Electron scope; owner packaged Claude Desktop deletion E2E pending

Date: 2026-08-18

## Verdict

**Implementation: PASS.** There are zero open P1, P2, or P3 findings. The frozen implementation
matches the deletion contract in `docs/features/eyes-on-agents-claude-observation.md:291-304` and
`:441-453`: exact provider tombstones are positive evidence, deletion wins before all row input,
deleted sessions lose every projection/action/alert capability, and only a newer healthy complete
Desktop identity pair can restore a row.

The implementation is accepted for the non-Electron scope. Ral still owns the packaged Claude
Desktop delete/re-import E2E required by task 051.

## Findings

- **P1 · blocking:** None.
- **P2 · blocking:** None.
- **P3 · non-blocking:** None.

## Real provider evidence

Read-only inspection of the locally installed Claude Desktop implementation and its live metadata
confirmed the provider assumptions used by this contract:

- the current metadata tree contains seven direct files whose basenames exactly match
  `deleted_<UUID>` and no non-exact match in that result set;
- Claude Desktop's packaged deletion path builds tombstones from the Desktop session ID with the
  `local_` prefix removed, `cliSessionId`, and `unarchivedCliSessionId`, deduplicates that list, and
  writes the markers before removing the local session metadata;
- its import/unarchive path removes the corresponding tombstones across organization scopes.

This establishes the real Desktop/CLI identity-pair evidence needed for tombstone-before-row Hook
suppression; it is not inferred from JSONL contents or from file absence.

## Contract matrix

| Contract | Independent result | Evidence |
|---|---|---|
| Exact filename and scope | PASS | `claudeDesktopInventory.adapter.ts:15-18,105-223` accepts only direct regular non-symlink exact UUID metadata/tombstone basenames under canonical account/org scopes and never reads tombstone contents |
| Filesystem TOCTOU | PASS | Tombstones require stable realpath, lstat, open/fstat device, inode, size, and mtime evidence; metadata reads repeat identity checks before and after a bounded descriptor read |
| No omission delete | PASS | Failed/partial/inaccessible/symlink/overflow discovery revokes deletion authority; poll may not clear an absent marker, and only a healthy complete full snapshot clears source-qualified active markers |
| Tombstone before row | PASS | `eyesOnAgents.dao.ts:624-756,2019-2232` persists/reconciles tombstones first in the same SQLite transaction, then blocks or creates a hidden stub before stale Desktop/JSONL rows can mutate projection state |
| CLI/Desktop matching | PASS | Canonical Claude `thread_id` matches directly; `local_<uuid>` matching requires non-ambiguous unique ownership, and the real provider writes both Desktop and CLI identities |
| Soft-delete preservation | PASS | The row keeps provider/thread/Desktop identity, Domain, archive state, and receipt tables while runtime, turn, unread, Open/Preview, project/title, prompt, and activity fields are cleared |
| Active/history barrier | PASS | Active tombstones and prior deletion history suppress JSONL, Agent View, direct runtime, and Hook mutation; removal of a marker alone cannot resurrect a row |
| Verified restore | PASS | Restore requires complete Desktop evidence, a non-null unchanged unique Desktop/CLI pair, no active tombstone in any source, and metadata mtime strictly newer than deletion; Domain remains and unread/prompt stay cleared |
| Hook receipt-first ACK-drop | PASS | `applyRuntimeEventDelivery()` inserts the content-free receipt first, marks a deleted delivery observation-ineligible, and returns duplicate-style committed output without row or completion intent |
| Outbox/observation proof | PASS | The bridge ACKs that committed duplicate so live/replayed outbox entries drain; duplicate deliveries do not advance `lastEventAt` or live receipt proof |
| Notification and sound | PASS | Deleted delivery returns no completion intent and `commitClaudeHookDelivery()` neither broadcasts nor calls completion notification for the duplicate result; the notification helper is therefore not reached |
| Projections and actions | PASS | Snapshot, Open/Preview target, move, mark-opened, Read all, Agent View reconcile/expiry, and completion claim all exclude `is_deleted = 1`; title repair and refresh pages remain Codex-only |
| Watch/recovery paths | PASS | Watcher invalidation schedules prompt poll reconciliation; startup, activation, manual Refresh, and retry retain full-scan recovery paths |
| Migration | PASS | Fresh schema plus migration `260818190001` add thread soft-delete state, observation-eligible receipts, and the source-qualified tombstone table; finalization is idempotent and the migration audit covers maintained baselines |
| Codex isolation | PASS | All tombstone queries and deletion mutations are provider-qualified to Claude; a same-UUID Codex fixture preserves runtime, archive, unread, Open, alert, and notification behavior |

## Independent verification

| Check | Result |
|---|---|
| `node scripts/eyes-on-agents/claude-inventory.test.mjs` | PASS |
| `yarn test:eyes-on-agents:repository` | PASS |
| `node scripts/eyes-on-agents/claude-hook.test.mjs` | PASS |
| `yarn typecheck:eyes-on-agents:core` | PASS |
| `yarn typecheck:eyes-on-agents:ui` | PASS |
| `yarn audit:sqlite-migrations` | PASS |
| `yarn check:renderer-i18n` | PASS |
| `node scripts/environment/runWithRuntimeProfile.cjs release_prod -- yarn _build:release` | PASS |
| `git diff --check` | PASS |

`yarn test:eyes-on-agents` independently reached the known unrelated task-045 stale UI-source
assertion requiring the removed `eyesOnAgentsStore.reviewCodexBridge(...)` call. Every Core,
repository, App Server, bridge, project-filter, Claude, and preceding UI case passed; this is not a
051 implementation finding and the same exception is recorded in the frozen task evidence.

No Electron process, browser E2E, packaged app, Claude configuration mutation, commit, or sync was
run. This review changes only this acceptance file and intentionally leaves task 051 status
unchanged.

## Owner acceptance remaining

In the newly packaged app, delete a Claude Desktop Code session whose JSONL still exists and confirm
its Bitterless card disappears without a late Stop alert or sound. Then re-import the same session
through Claude Desktop and confirm only newer live Desktop metadata restores it in its original
Domain, read, with no old latest-question preview.

## Conclusion

**PASS / accepted for the verified scope.** The implementation is positive-evidence-only,
transactionally tombstone-first, race-hardened at the filesystem boundary, restore-conservative,
and isolated from Codex. There are zero open findings.
