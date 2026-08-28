---
id: onlypreview-search-exclusion-markers-039-2
status: pass
reviewed_task: onlypreview-search-exclusion-markers-039
target: working-tree
base: dev/next
date: 2026-08-27
review_type: independent-blocker-fix-rereview
supersedes: onlypreview-search-exclusion-markers-039-1
---

# onlypreview-search-exclusion-markers-039 — Review 2

- Result: **PASS**
- Scope: Review 1's exact configured-directory descendant blocker, ordered `!` re-inclusion,
  opaque capability state/reset, refresh rollback, symlink neutrality, I/O/performance boundaries,
  and the previously accepted Browse-only/UI contracts. Unrelated dirty-worktree changes were
  preserved and excluded.
- E2E/live app: intentionally not run. Electron, Playwright, E2E, and the real application remain
  excluded by the task contract.

## Findings

No P1, P2, or P3 finding remains.

## Review 1 blocker closure

### Exact configured-directory exclusions now propagate through opaque capabilities

- `src/preload/onlypreview/search/core/browse-index.mjs:101-180` reads the directory capability's
  bounded `ancestorBlocked` state once and combines it with the current entry's traversal-policy
  result while the existing listing is built. An exact `exclude: ['excluded']` therefore marks the
  directory, `excluded/child.txt`, and deeper loaded descendants without a Renderer path scan.
- `browse-index.mjs:153-191` distinguishes a directly excluded directory from one whose descendants
  are physically blocked. It stores the next ancestor bit only when the directory does not need to
  remain traversable for a later ordered `!` rule.
- `browse-index.mjs:271-277` binds `{ relativePath, ancestorBlocked }` to the existing random opaque
  directory token. The renderer still receives no path-derived authority or separate policy state.
- The new exact-directory regression covers both a direct file and a deeper directory/file. The
  previous failing reproduction now returns `true` for the excluded directory, child, and deep
  descendant.

### Ordered re-inclusion, token lifecycle, and rollback remain truthful

- The `generated/**` plus `!generated/keep/**` regression proves `generated/drop.txt` remains
  excluded while `generated/keep` and `generated/keep/readme.txt` return to normal.
- Reset clears both token maps and mints a new root token, so stale tokens cannot carry an old
  ancestor bit into a replacement policy. Symlinks remain leaf-only with
  `searchExcluded: false`.
- Refresh installs the candidate policy before resetting BrowseIndex. On candidate failure,
  `search-engine.mjs:445-455` restores the prior config, traversal policy, identity, and ready
  state, resets every candidate token, and republishes a fresh root listing under the restored
  policy. The rollback regression confirms the replacement root token and restored child marker.

## Preserved contracts

- `searchExcluded` remains exclusive to `OnlyPreviewBrowseEntry`; Global Search result/index and
  directory-preview entry shapes remain exact and marker-free.
- Main and Renderer validators require the exact boolean on browse listings and reject a marked
  symlink. The Shell-owned synthetic root remains neutral.
- Renderer projection builds one excluded-path `Set` during the existing listing-to-index pass;
  row construction performs only `Set.has()`. No recursive or per-render ancestor scan exists.
- The preload adds only one boolean to each already-required directory-token record and performs no
  additional `stat`, `opendir`, body read, SQLite query, or Main-process filesystem work.
- Pale-orange base, hover, and selected row states remain present; both directory icon states use
  canonical `#C2410C`, while excluded file icons and symlink treatment remain unchanged.

## Verification

| Command / evidence | Result |
| --- | --- |
| Complete task-focused evidence | **PASS, 40/40** |
| Fix-focused evidence | **PASS, 13/13** |
| Independent BrowseIndex + Search-engine boundary run | **PASS, 20/20** |
| Source/contract inspection | **PASS:** exact/deep inheritance, ordered re-inclusion, reset/rollback, no extra I/O or Renderer scan |
| Electron / Playwright / E2E / real app | Not run, as required |

## Conclusion

**PASS — Review 1's descendant-marker blocker is closed.** Exact configured-directory exclusions
now remain visible through arbitrarily deep demand-loaded browsing, ordered re-inclusions stay
normal, token and refresh rollback state is fenced, and the existing search, preview, validation,
UI, and performance boundaries remain intact. The task is ready for Ral's live visual acceptance.
