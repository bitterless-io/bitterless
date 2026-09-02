---
id: onlypreview-preview-stream-preload-085-1
target: working-tree-2026-08-31
compared_with: onlypreview-preview-stream-preload-085
---

# Verdict

**PASS. No P1, P2, or P3 finding remains.** The first review found a pending-open revoke race and
an under-validated private readiness envelope. The repair round closed both findings, and the
independent re-review found no replacement issue.

# Findings

## P1 — blocking

None after repair. Asset and document sessions are registered before the first asynchronous open;
request abort, token/host/workspace revoke and selection replacement synchronously invalidate that
session. Late open and frame responses must pass both Main and preload liveness fences before they
can publish.

## P2 — blocking

None after repair. Preview Read readiness accepts only exact typed envelopes with bounded,
path-free failure text. Main pending-open tombstones cover exact cancel, rebind, workspace revoke,
timeout and runtime stop.

## P3 — non-blocking

None.

# Requirements evidence

| Requirement | Evidence | Result |
| --- | --- | --- |
| Hidden-preload ownership | Descriptor/signature/text/asset/document file work is owned by the hidden preload; Main asset/document registries contain no filesystem or `net.fetch` fallback. | pass |
| Bounded streaming | Sessions deliver continuous frames of at most 512 KiB; the visible preload assembles admitted text only, capped at 8 MiB. | pass |
| Range and concurrency | Full, HEAD and Range responses preserve exact lengths; concurrent PDF/media sessions advance independently. | pass |
| HTML containment and budgets | Document resources remain entry-directory scoped, identity pinned and bounded by per-resource/revision ceilings. | pass |
| Cancellation and replacement | Abort, token/host/workspace revoke, selection replacement, timeout and EOF clean the exact pending or active session without resurrection. | pass |
| Private protocol safety | Runtime identity, echoes, offsets, result envelopes and readiness envelopes are exact-validated; error text is bounded and path-free. | pass |

# Verification

| Check | Result |
| --- | --- |
| Developer focused Preview Read suite | PASS, 30/30 |
| Updated view/search/adapter suite | PASS, 48/48 |
| Independent re-review focused suite | PASS, 90/90 |
| `yarn typecheck:node` | PASS |
| Targeted ESLint | PASS, 0 errors |
| `yarn build` | PASS |
| Task-scoped `git diff --check` | PASS |
| Electron / Playwright / packaged smoke / E2E | Not run, as required |

# Conclusion

**Approved.** Task 086 may now move OnlyPreview auxiliary persistence, Agent Guide/shim work and
diagnostic file writes out of Main without reopening the preview byte path.

## Post-review scope clarification — 2026-08-31

Ral subsequently clarified that the performance boundary applies only to potentially large
project-content I/O. Task 086 was therefore superseded before implementation, and the bounded
window-state, settings, Agent Skill/shim and logging persistence named in the historical conclusion
remains in Main. Task 087 verified that clarified boundary independently.
