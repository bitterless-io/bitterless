---
id: onlypreview-main-fs-boundary-audit-087-1
target: working-tree-2026-08-31
compared_with: onlypreview-main-fs-boundary-audit-087
---

# Verdict

**PASS. No P1, P2, or P3 finding.** The current task-scoped worktree keeps potentially large
OnlyPreview project-content filesystem work inside the trusted hidden `fileSearch` preload. Main
retains capability, generation, native-view, protocol and OS-action coordination while relaying
only bounded frames. The clarified boundary correctly retains small window-state/settings,
Agent Skill/shim and diagnostic persistence in Main.

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
| Project target, native actions and Delete cross real preload authority | `src/main/xpc/onlyPreview.handler.ts` binds Project, Preview Read and Office authorities before exposing a workspace. `src/main/onlypreview/onlyPreviewProjectNativeAction.service.ts` reauthorizes immediately before clipboard/open/reveal and uses preload `prepareProjectDelete` / `commitProjectDelete` / `cancelProjectDelete`. `src/preload/fileSearch/fileSearchProjectAuthority.service.ts` owns target/root/item identity, containment, pinned Delete handles, same-parent quarantine and the final unlink. | pass |
| Legacy Main traversal cannot return | `src/main/onlypreview/onlyPreviewIndex.service.ts` is absent. `tests/onlypreview/onlyPreviewMainFilesystemBoundary.test.mjs` recursively guards production OnlyPreview Main sources and the public handler against the retired service. | pass |
| Generic non-Office Preview Read is preload-owned | `src/preload/fileSearch/fileSearchPreviewReader.service.ts` owns `lstat`/`realpath`/`stat`/`open`, descriptor sampling, text source reads, asset/PDF/media ranges and contained HTML resources. `src/main/onlypreview/onlyPreviewAsset.registry.ts` and `onlyPreviewDocument.registry.ts` retain only tokens, request/range policy and pull-driven `ReadableStream` routing. | pass |
| Office reads are preload-owned and frame-bounded | `src/preload/fileSearch/fileSearchOfficeReader.service.ts` owns containment, identity, `O_NOFOLLOW` open and serial file-handle reads. `src/main/fileSearch/fileSearchOfficeReadClient.service.ts` exact-validates prepare/open/frame echoes, caps total bytes at 25 MiB and each frame at 512 KiB, permits one frame in flight, and fences cancel/rebind/stop plus late prepare/open/read responses. | pass |
| Main validates private envelopes and does not assemble whole files | Project operations use `fileSearchProjectAuthorityResponse.service.ts`; Preview Read and Office use their strict response helpers plus exact result-key/echo checks in their clients. The audited Main content path has no `node:fs` content import, `readFile`, stream creation, unlink, `Buffer.concat`, total-size allocation or whole-response `arrayBuffer()` call. Main converts only one accepted frame to a `Uint8Array` when enqueueing a protocol response. | pass |
| Limits and cancellation remain integrated | Shared contracts pin Office and generic frames to 512 KiB, Office to 25 MiB, text to 8 MiB, HTML entry to 1 MiB, each HTML resource to 25 MiB and an HTML revision to 100 MiB. Preload sessions enforce continuous offsets, one pending read, bounded session/resource counts, identity revalidation at EOF, non-refundable HTML body reservations and deterministic revoke/close behavior. | pass |
| Visible surfaces receive no filesystem capability | Shell/Vue visible preloads remain sandboxed and path-free. The Vue content preload exposes only current-revision Office/text read bridges; raw HTML/PDF receives no preload or application token. Absolute roots and canonical native-action paths stay inside the private Main↔hidden-preload channel. | pass |
| Clarified allowed Main I/O remains unchanged | `src/main/onlypreview/onlyPreviewAgentSkill.service.ts` retains bounded `accessSync`/`lstatSync`; `src/main/windows/onlyPreviewWindow.helper.ts` retains `windowStateService`; existing settings and `electron-log` persistence remain in place. The boundary guard explicitly proves these are allowed instead of applying a blanket `fs`-import ban. | pass |

# Verification

| Check | Result |
| --- | --- |
| Independent focused boundary/Office/Preview/Project suite | PASS, 46/46: `node --test --test-concurrency=1 tests/onlypreview/onlyPreviewMainFilesystemBoundary.test.mjs tests/onlypreview/onlyPreviewOfficeReadClient.test.mjs tests/onlypreview/onlyPreviewPreviewGuards.test.mjs tests/onlypreview/onlyPreviewProjectAuthority.test.mjs tests/onlypreview/onlyPreviewPreviewReadClient.test.mjs tests/onlypreview/onlyPreviewPreviewReader.test.mjs` |
| Complete non-E2E OnlyPreview suite | PASS, 532/532 in the current orchestration run |
| Targeted ESLint | PASS, 0 errors |
| `yarn typecheck:node` | PASS |
| `yarn typecheck:web` | BLOCKED outside Task 087: current errors are in pre-existing Poker test globals and unrelated Connector/Home/Maestro/Omni/shared paths; no OnlyPreview error was emitted |
| `yarn build` | PASS in the current orchestration run |
| Task-scoped `git diff --check` | PASS |
| Static project-content reachability audit | PASS: Main has no potentially large project-content filesystem owner or whole-file relay; filesystem opens/reads/unlink remain in `src/preload/fileSearch/**` |
| Electron / Playwright / packaged smoke / E2E | Not run, as required |

# Conclusion

**Approved.** Tasks 083–085 plus the Office relay hardening satisfy the clarified performance
boundary: potentially large project-content traversal, mutation, open and byte delivery are owned by
the hidden preload, while Main coordinates opaque authority and bounded frames. Task 086 remains
correctly superseded; small bounded configuration, window-state, Agent Skill/shim and logging I/O
must not be migrated merely to remove Main `fs` imports. Final normal-application runtime acceptance
remains with Ral.
