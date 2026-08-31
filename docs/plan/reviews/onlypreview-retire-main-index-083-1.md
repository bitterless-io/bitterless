---
id: onlypreview-retire-main-index-083-1
target: working-tree-2026-08-31
compared_with: onlypreview-retire-main-index-083
---

# Verdict

**PASS. No P1, P2, or P3 finding.** The obsolete Main traversal and only its direct historical
tests are removed, the narrow regression guard covers every production module below
`src/main/onlypreview` plus the public handler, and current hidden-preload browse/search coverage
remains green.

# Findings

## P1 — blocking

None.

## P2 — blocking

None.

## P3 — non-blocking

None.

# Requirements evidence

| Requirement | Evidence | Result |
| --- | --- | --- |
| Dead Main index is absent | `src/main/onlypreview/onlyPreviewIndex.service.ts` is deleted; a worktree-wide production/test source search finds no remaining retired service reference outside the dedicated guard. | pass |
| Only obsolete index tests were removed | The removed `onlyPreviewWorkspaceCore` cases all instantiate `OnlyPreviewIndexService` directly: root replacement, natural ordering/exclusions, entry/depth truncation, and index-specific permission mapping. The remaining 11 host/workspace/asset/classifier/range tests stay present and pass. | pass |
| Current preload browse/search ownership remains | `src/preload/fileSearch/fileSearch.preload.ts` still exposes initialize, refresh, prioritize, browse, search, preview, cancel, and shutdown. Direct browse-index coverage passes 5/5, while the utility/RPC coverage passes 8/8. Its immediate and deferred registration cases now supply independent valid 43-character Search/Office capabilities and assert both exact handler names. | pass |
| Guard covers production Main OnlyPreview modules plus handler | The new guard recursively enumerates every `.ts` file below `src/main/onlypreview`, adds `src/main/xpc/onlyPreview.handler.ts`, proves the retired file does not exist, and rejects class, singleton, or module-path references. | pass |
| Guard stays narrowly truthful | Its name and regex cover only the retired traversal; its comment explicitly delegates remaining reachable Main filesystem paths to Tasks 084–087. It does not assert that all OnlyPreview or application Main filesystem I/O is gone. | pass |

# Verification

| Check | Result |
| --- | --- |
| Boundary + app wiring + remaining workspace core + preload browse/search | PASS, 35/35 |
| Hidden-preload Search/Office registration remediation | PASS; distinct valid capabilities and exact two-handler assertions cover immediate and `DOMContentLoaded` registration |
| Task-scoped ESLint (`--no-cache`) | PASS, 0 errors; eight existing Prettier warnings occur outside the Task 083/remediation lines |
| Task-scoped `git diff --check` | PASS |
| Electron / Playwright / packaged smoke / E2E | Not run, as required |

# Conclusion

**Approved.** The deleted module was production-unwired, its test-runtime export is gone, and only
its direct historical tests were retired. The surviving workspace, host, Preview and preload-owned
browse/search paths remain covered. The guard truthfully prevents only this retired traversal from
returning and leaves the broader reachable Main filesystem migration to Tasks 084–087.
