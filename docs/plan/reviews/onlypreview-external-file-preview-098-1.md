---
task: onlypreview-external-file-preview-098
round: 1
result: PASS
reviewer: independent Codex explorer
date: 2026-09-01
verification: 49 focused non-Electron tests, typecheck:node, directed ESLint, build, targeted git diff check, and source review; no Electron/Playwright/E2E
---

# Task 098 independent review 1

## Result

**PASS** after three first-pass findings and one closure finding were corrected and rechecked. No
P0–P3 finding remains.

## Findings and closure

1. The first pass found that simultaneous MCP explicit opens could overlap registry and reader
   mutation; generation checks discarded old results without serializing the work. A shared,
   failure-tolerant FIFO now returns each caller's own operation and continues after rejection.
2. The first pass found that workspace replacement revoked Asset/Document authority but did not
   immediately fence active Preview/Office streams. Workspace revoke now synchronously clears only
   the matching presentation and broker grants, then best-effort revokes the exact hidden
   PreviewReader workspace ID/generation. Slow or failed replacement binding cannot retain the old
   presentation authority.
3. The first pass found that an external-preview reader capability accepted a forged sibling
   relative path under the same private root. Preview and Office bootstrap now require the exact
   current external workspace and original basename, matching the native-action boundary.
4. The closure pass found that the native folder chooser still mutated Project state outside the
   new FIFO and could race an MCP/OS file open. The dialog remains outside the queue, while its
   returned target mutation now shares the same FIFO as OS, MCP, and internal file opens. A mixed
   folder/file gated test proves the ordering and result boundary.

## Verified invariants

- A contained file reuses and selects the current Project; an outside file preserves the Project,
  clears its selected row, and uses a transient non-persisted external-preview authority.
- With no Project, the outside file previews while the Project surface remains empty. Restore
  returns only a Project and cannot overwrite a live external presentation.
- Visible renderers receive opaque workspace/file identity and bounded metadata only. Canonical
  roots stay in Main and the hidden file-search preload.
- External reader authority is one exact file, not its parent directory. Project APIs and forged
  sibling Preview/Office/native-action references fail closed.
- Workspace and host revocation fence presentation revision, Preview/Office brokers, hidden reader
  authority, media/document grants, and late pending preparation.
- Folder chooser, OS events, MCP `preview.open`, and internal callers serialize target mutations.
  MCP `{ opened: true }` confirms Main acceptance/processing, never renderer readiness.
- Packaged macOS/Windows accept only the explicit absolute-path switch; packaged Windows also keeps
  ordinary file-argument routing.

## Evidence

- Final focused pass: 49/49 App wiring, workspace, external Preview, FIFO serialization, and Preview
  Region Node tests passed.
- Directed line-cap, portable Preview skill, and local MCP `preview.open` tests passed.
- `yarn typecheck:node` and `yarn build` passed. Directed ESLint reported zero errors; 43 existing
  Prettier warnings remain in an untouched handler region.
- Mirrored Preview/WebStorm skills are byte-identical across their required destinations; targeted
  YAML/frontmatter and `git diff --check` validation passed.
- Full web typecheck, renderer-i18n, and unrelated full-glob failures remain outside Task 098 and
  are recorded in the task delivery evidence.
- Electron, Playwright, packaged smoke, app launch, and E2E were not run. Ral owns live acceptance.
