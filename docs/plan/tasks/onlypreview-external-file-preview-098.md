---
id: onlypreview-external-file-preview-098
scope: Preserve the current OnlyPreview Project while previewing an explicitly opened file outside it
status: implemented; owner verification pending
depends-on:
  - onlypreview-agent-skill-guide-009
  - onlypreview-main-fs-boundary-audit-087
verify: focused OnlyPreview Node tests, node/web typechecks, renderer i18n, lint, build, skill validation, and git diff check; no Electron/Playwright/E2E
---

# Preview an explicit file outside the current Project

## Objective

Make every Main-owned explicit-file route open the requested file in the singleton OnlyPreview
window without forcing its parent directory to become the visible Project. Install Bitterless's
canonical Preview skill as overmind's default artifact-preview route.

## Context

- [External file open replaces the current Project](../../issues/onlypreview-external-file-replaces-project.md)
- [OnlyPreview feature contract](../../features/onlypreview.md)
- [Portable Preview skill and Guide](onlypreview-agent-skill-guide-009.md)
- [Main filesystem boundary audit](onlypreview-main-fs-boundary-audit-087.md)

## Paths

- `src/main/onlypreview/onlyPreviewWorkspace.registry.ts`
- `src/main/onlypreview/views/onlyPreviewPreviewRegion.service.ts`
- `src/main/onlypreview/onlyPreviewOpenRouter.service.ts`
- `src/main/xpc/onlyPreview.handler.ts`
- `src/shared/onlypreview/onlyPreviewAgentSkillVersion.shared.ts`
- `skills/bitterless-preview/`
- focused `tests/onlypreview/`, including external authority and FIFO serialization suites
- `docs/features/onlypreview.md`
- `docs/issues/onlypreview-external-file-replaces-project.md`
- `docs/plan/README.md`
- overmind `AGENTS.md`, `CLAUDE.md`, and mirrored skill directories

## Contract

1. Inspect an explicit target in the existing hidden `fileSearch` preload. A directory continues
   through the recent-Project workflow and becomes the visible Project.
2. Resolve a regular file against the current canonical Project root in Main. If it is contained,
   reuse the Project workspace, select the normalized relative path, and present it normally.
3. If the file is outside the Project (or no Project exists), register a distinct host-bound
   external-preview workspace. Preserve the current Project workspace, clear its selected item,
   and present the external file without publishing the external root as Shell workspace state.
4. Project browse/search/native-action APIs must reject external-preview workspace references.
   Preview and Office readers may consume them through their existing bounded, capability-scoped
   lanes. Visible renderers continue to receive only opaque IDs, relative identity, and bounded
   descriptor metadata.
5. `restoreWorkspace` returns only the Project workspace and must not clear a live external
   presentation. Selecting a Project item or opening another target supersedes the external
   authority; directory replacement and host teardown revoke it.
6. External Preview reader authority is exact-file capability, not parent-directory capability.
   Forged sibling relative paths are rejected for both Preview and Office lanes. Workspace revoke
   synchronously fences the active presentation and broker grants before best-effort hidden-reader
   root revocation, including slow or failed directory replacement.
7. Accept the explicit `--onlypreview-open=<absolute-path>` switch on packaged macOS/Windows as well
   as development, while retaining packaged Windows ordinary file-argument parsing and rejecting
   relative explicit-switch values.
8. Serialize every folder-chooser target mutation and OS, MCP, or internal explicit-file request
   through one shared FIFO. The user dialog stays outside the queue; after it returns a target, its
   Project replacement runs atomically against file opens. Each caller awaits its own operation,
   one failure does not poison later requests, and `{ opened: true }` means Main
   accepted/processed that request rather than renderer-ready.
9. Copy the canonical `skills/bitterless-preview/` package additively into overmind's `.agents`,
   `.claude`, and user Codex skill trees. Make `$bitterless-preview` the default workspace preview
   route; retain `$open-in-webstorm` only for an explicit WebStorm request and narrow its trigger
   text so the two skills do not overlap.

## Verification

- Pure Node coverage for inside-Project, outside-Project, no-Project, replacement/revocation,
  restore, host isolation, and renderer capability rejection.
- Router coverage for packaged/development explicit switches plus packaged Windows ordinary args.
- Existing focused OnlyPreview suites, relevant Node/web typechecks, renderer i18n check, focused
  lint, `yarn build`, mirrored skill diff/frontmatter validation, and `git diff --check`.
- Do not launch Electron, Playwright, packaged smoke, or E2E. Ral owns live verification after
  installing/running the updated Bitterless build.

## Delivery

Implemented on 2026-09-01. Main now keeps Project and transient external-preview workspaces
separate, dynamically binds the Preview/Office readers to the exact active authority, preserves or
clears Project selection according to containment, and handles packaged explicit-file switches.
Folder-chooser mutations and all explicit entry points share one failure-tolerant FIFO boundary.
Workspace revocation
synchronously empties a matching presentation, cancels Preview/Office broker access, and
best-effort revokes the exact hidden PreviewReader workspace; external reader references are
restricted to their one canonical basename.

The canonical Preview skill was bumped to `260901150707`, copied to overmind's authored, agent,
Claude, and user-Codex skill trees, and documented as accepted-not-ready. The overmind rules now use
`$bitterless-preview` with production `bitterless` as the default local-artifact preview route;
`$open-in-webstorm` is explicit-only.

[Independent review 1](../reviews/onlypreview-external-file-preview-098-1.md) passed after three P1
and one P2 findings were corrected. Verification passed 49/49 focused external/Project/FIFO/Preview
Node tests, the directed line-cap test, 2/2 portable-skill tests, the MCP `preview.open` test,
`yarn typecheck:node`, directed ESLint with zero errors, `yarn build`, mirrored-skill diff and YAML
validation, and `git diff --check`. The full web typecheck, renderer-i18n check, and full
OnlyPreview glob remain blocked by pre-existing unrelated Poker/Home/Connector/Maestro, Tray-order,
Guide-inventory, Draw.io-timeout, and Search-RPC failures in the shared dirty worktree; Task 098
changed paths do not appear in those failures. Electron, Playwright, packaged smoke, and E2E were
not run; Ral owns live verification.
