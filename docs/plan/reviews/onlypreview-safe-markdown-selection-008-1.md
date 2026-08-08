---
id: onlypreview-safe-markdown-selection-008-1
status: pass
reviewed_task: onlypreview-safe-markdown-selection-008
target: f09855b1310066a1790717cb950b5e66408ccf91
base: a1b4def545fdbab8bc0c455dfbbcd947024c042c
date: 2026-08-08
review_type: independent-final-static-and-node-no-runtime
---

# Verdict

**PASS. No P1, P2, or P3 finding.** The cumulative implementation and its two follow-up fixes
satisfy the safe Markdown, grapheme selection count, renderer-only revision fencing, native
refresh, and rapid-selection recovery contracts. Runtime visual acceptance remains with Ral.

# Findings

- P1 blocking: none.
- P2 blocking: none.
- P3 non-blocking: none.

# Reviewed File Inventory

- Dependency and shared contract: `package.json`, `yarn.lock`,
  `src/shared/onlypreview/onlyPreview.types.ts`.
- Renderer services and catalogs:
  `src/renderer/onlypreview/common/onlyPreviewCharacterCountGate.service.ts`,
  `src/renderer/onlypreview/common/onlyPreviewI18n.ts`,
  `src/renderer/onlypreview/preview/src/onlyPreviewCharacterCount.service.ts`, and
  `src/renderer/onlypreview/preview/src/onlyPreviewMarkdown.service.ts`.
- Preview renderer:
  `src/renderer/onlypreview/preview/src/onlyPreviewPreview.store.ts`,
  `src/renderer/onlypreview/preview/src/components/PreviewSurface/PreviewSurface.vue`,
  `src/renderer/onlypreview/preview/src/components/MarkdownPreview/MarkdownPreview.vue`,
  `src/renderer/onlypreview/preview/src/components/MarkdownPreview/MarkdownPreview.less`,
  `src/renderer/onlypreview/preview/src/components/MonacoTextPreview/MonacoTextPreview.vue`, and
  `src/renderer/onlypreview/preview/src/components/PdfPreview/PdfPreview.vue`.
- Shell renderer: `src/renderer/onlypreview/shell/src/App.vue`,
  `src/renderer/onlypreview/shell/src/App.less`, and
  `src/renderer/onlypreview/shell/src/onlyPreviewShell.store.ts`.
- Tests and delivery docs: `tests/onlypreview/onlyPreviewCore.test.mjs`,
  `tests/onlypreview/onlyPreviewRendering.test.mjs`, `docs/features/onlypreview.md`,
  `docs/plan/README.md`, and `docs/plan/tasks/onlypreview-safe-markdown-selection-008.md`.

# Per-file Problem Audit

No actionable problem was found in any reviewed file. The focused rule audit also passed:

- `[TS-1]`: every changed TypeScript file is below 800 lines; the largest is
  `onlyPreviewShell.store.ts` at 707 lines.
- `[TS-2]`: module-level functions use `const` arrow style; class behavior remains ordinary class
  methods.
- `[FE-1]`: Markdown compilation/sanitization, grapheme counting, transition gates, and async
  orchestration live in services/stores. Vue files retain rendering and lifecycle wiring.
- `[FE-2]`: no business-component emit path was introduced.

# Contract Evidence

1. Markdown is confined to exact `.md` routing; `.markdown` and `.mdx` continue through Monaco.
   The renderer escapes raw HTML, emits images only as escaped inert alt-text placeholders, removes
   link destinations, and then applies DOMPurify with an XHTML semantic-tag allowlist and
   `ALLOWED_ATTR: []`. The larger of declared size and UTF-8 encoded size enforces the 1 MiB cap
   (`onlyPreviewMarkdown.service.ts:39-58,63-98`; `PreviewSurface.vue:46-62`). Direct dependencies
   resolve to the pinned `marked@18.0.7` and `dompurify@3.4.12` versions.

2. Selection semantics match the task. `Intl.Segmenter` counts grapheme clusters with a code-point
   fallback; Monaco sums all non-empty selections; Markdown and PDF require both DOM selection
   endpoints inside their own preview body. All three surfaces dispose listeners/resources and
   report zero during replacement or unmount (`onlyPreviewCharacterCount.service.ts:3-40`;
   `MarkdownPreview.vue:42-69`; `MonacoTextPreview.vue:28-35,70-82,109-110`;
   `PdfPreview.vue:31-52,123-145`).

3. The initial stale-count race is closed by a Shell-authoritative opaque revision. A transition
   synchronously clears and suspends the Shell, disarms the old Preview source, and reports zero.
   A replacement surface arms and sends READY only after it is live. The Shell accepts or buffers a
   positive count only for the current ready revision, while stale zero/non-zero reports, READY,
   resume, async restore, and rapid A to B to C completions fail their revision/generation fences
   (`onlyPreviewCharacterCountGate.service.ts:1-82`;
   `onlyPreviewPreview.store.ts:69-125,142-163,173-234`;
   `onlyPreviewShell.store.ts:372-418,663-704`).

4. The final target closes both follow-up transition gaps. Main's native refresh event now begins
   a transition before rebuilding the index and resumes only that captured revision; the direct
   Shell refresh follows the same path without broadcasting a raw refresh echo
   (`onlyPreviewShell.store.ts:200-207,420-426`). A local click invalidates an older restore and
   rotates an unannounced pending revision before the optimistic path changes. Therefore an older
   selection completion cannot resume during the Main-event gap. A failed click synchronizes the
   actual selection, rechecks its generation, then broadcasts and resumes a fresh recovery
   revision (`onlyPreviewShell.store.ts:628-650,675-689`).

5. Reload recovery is two-sided and host-scoped. Preview subscribes before requesting an exact
   `{ hostId }` resync. A live Shell rotates to a fresh revision; an already-suspended Shell replays
   its active revision so it does not invalidate the in-flight owner. Shell initialization starts
   a fresh transition (`onlyPreviewPreview.store.ts:54-67`;
   `onlyPreviewShell.store.ts:165-179,691-704`).

6. The selected-count payload remains exactly `{ hostId, characterCount }`. Renderer lifecycle
   payloads validate exact `{ hostId, revision }` or `{ hostId }` shapes and carry no path, selected
   text, file content, or capability. `OnlyPreviewApi` has no new method, and cumulative diff audit
   found no lifecycle use or other change in Main/preload (`onlyPreview.types.ts:118-142,144-185`;
   `onlyPreviewPreview.store.ts:26-36,227-233`; `onlyPreviewShell.store.ts:38-70,389-418`).

7. Shell displays a localized positive selection count before type and size in the existing status
   rail, while zero remains hidden. The rail geometry remains fixed and no visible read-only badge
   is reintroduced (`App.vue:270-293`; `onlyPreviewI18n.ts:21-40,124-143`).

8. The retained 007 launch fixture, Main fail-fast, safe-storage helper, Playwright configuration,
   and E2E spec paths are byte-unchanged from the task base. No E2E file, production safe-storage
   behavior, or mock-Keychain launch boundary was weakened.

# Adversarial State-Probe Evidence

A pure Node harness bundled the actual Shell and Preview stores with identity Vue and virtual
renderer/XPC clients. It verified all of the following against `f09855b`:

- native Main refresh broadcasts a transition before deferred index work, reloads the Preview, and
  exposes the new count only after revision-safe resume;
- old non-zero and old zero then non-zero delivery cannot cross a new transition;
- while B's restore is deferred, a local C click rotates the pending revision, B's `finally`
  cannot resume it, and B's count remains rejected;
- Main confirmation for C establishes a fresh live surface and accepts only C's count;
- a failed later selection restores the actual path and accepts a count only after the fresh
  recovery revision;
- rapid transitions, stale READY/resume, and both Shell and Preview reload-resync paths retain the
  current owner.

Result: `PASS: native refresh reload, rapid B→C fence, and failed-selection recovery`.

# Verification

| Check | Result |
|---|---|
| `node --test tests/onlypreview/*.test.mjs` | PASS — 57/57 |
| `yarn typecheck:node` | PASS |
| `yarn check:renderer-i18n` | PASS |
| Focused error-level ESLint over cumulative changed TS/Vue/MJS files | PASS |
| `git diff --check a1b4def545fdbab8bc0c455dfbbcd947024c042c..f09855b1310066a1790717cb950b5e66408ccf91` | PASS |
| Exact real-store adversarial probe described above | PASS |
| Cumulative Main/preload and retained-007 path diff audit | PASS — no output |
| `yarn typecheck:web` | Baseline-only failure; no OnlyPreview diagnostic |

The full web typecheck still reports the established unrelated connector, poker-test, Home,
Maestro/Omni, eyes-on-agents, and shared path-helper baseline. It does not identify an
OnlyPreview regression.

# Runtime and Scope Boundary

This review did not launch Electron, Playwright, E2E, the full Bitterless application, or a build,
and it did not access Keychain. The implementation diff is limited to the declared renderer,
shared type, dependency, test, and delivery-doc paths; this review adds only this file. Ral retains
the task's manual normal/hostile Markdown and Markdown/Monaco/PDF selection acceptance.

# Conclusion

**pass — owner verification pending**
