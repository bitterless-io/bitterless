---
id: onlypreview-project-authority-preload-084-1
target: working-tree-2026-08-31
compared_with: onlypreview-project-authority-preload-084
---

# Verdict

**PASS. No P1, P2, or P3 finding remains.** The first review found one P1, three P2 and two P3
issues. The repair round closed every finding and the independent re-review found no replacement
finding.

# Findings

## P1 — blocking

None after repair. Permanent Delete no longer performs a checked-path `unlink`: it pins the approved
handle, atomically moves the current directory entry into a high-entropy same-parent private
quarantine, rechecks the isolated entry and active generation, and unlinks only that matching
isolated entry.

## P2 — blocking

None after repair. Item authorization has a final operation fence; Main revalidates the exact
host/workspace/generation after private XPC and before each native effect; Project plus Office bind
commits atomically or rolls Project authority back; private success/failure envelopes are exact,
bounded and path-free.

## P3 — non-blocking

None after repair. The Task 084 boundary guard follows the native-action call graph, and Project
native actions were extracted so `onlyPreview.handler.ts` is 646 lines.

# Requirements evidence

| Requirement | Evidence | Result |
| --- | --- | --- |
| Independent authority | Search, Office and Project capabilities are pairwise distinct and bound to the same exact hidden runtime instance. | pass |
| Project containment and stale-result fence | The preload owns root/item metadata and identity; rebind/dispose invalidates late operations and Main revalidates the current ref before shell/clipboard effects. | pass |
| Identity-fenced Delete | Prepared grants hold an `O_NOFOLLOW`-when-supported handle, expire actively, use same-parent atomic quarantine, never copy a raced large file, and recover only with a no-overwrite hard link. | pass |
| Atomic workspace bind | Main exposes no pending workspace; Office/final-bind failure executes exact-generation Project rollback. | pass |
| Private protocol safety | Response envelopes, payload echoes, error codes and bounded path-free messages are strictly validated; malformed responses stop the privileged runtime. | pass |
| Main boundary | Main owns confirmation and native OS effects only; the Task 084 call graph contains no filesystem import, target open or unlink. | pass |

# Verification

| Check | Result |
| --- | --- |
| Developer combined focused suite | PASS, 64/64 |
| Independent re-review focused suite | PASS, 39/39 |
| `yarn typecheck:node` | PASS |
| Targeted ESLint `--quiet` | PASS, 0 errors |
| `yarn build` | PASS |
| Task-scoped `git diff --check` | PASS |
| Electron / Playwright / packaged smoke / E2E | Not run, as required |

# Portable-delete boundary

Portable Node exposes name-based `unlink`, not unlink-by-handle. The private UUID quarantine and
post-isolation identity checks protect against ordinary replacement races and an untrusted renderer.
They do not claim absolute protection from a hostile same-UID local process that discovers and
actively swaps the private quarantine entry. On any detected mismatch or recovery failure the code
preserves a recovery entry instead of deleting or copying the wrong file.

# Conclusion

**Approved.** Project path authority and the one explicit Delete mutation now belong to the hidden
preload; Main retains only lifecycle validation, parented confirmation and native shell/clipboard
effects. Task 085 may consume the exact runtime/workspace-generation boundary.
