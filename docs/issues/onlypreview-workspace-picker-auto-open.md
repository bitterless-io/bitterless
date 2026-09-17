# Workspace selection opens OnlyPreview from every picker entry

Status: implemented; code verification complete — 2026-09-17. Paired scope: Bitterless and Micromeet Cowork.

Ral's resumed request: “设置 workspace 自动打开 onlypreview，降低 onlypreview 触达门槛”.
Task 179 (error-detail operation/cause) is already committed in both repositories and is not reopened.

## Current behavior and cause

The Chat renderer's `chooseWorkspace` already opens OnlyPreview, but only after awaiting its
session-save queue. A pending save therefore delays the preview. The agent's
`workspace_context` choose/switch/set path opens the same native directory picker directly in
`WorkspaceFileService`; it never calls the renderer method and does not open a preview at all.
The renderer also discards a failed preview result, so selection can appear to do nothing.

## Repair contract

- After a successful **native directory choice and workspace binding**, Main's
  `WorkspaceFileService.chooseWorkspaceDirectory` opens that directory exactly once through the
  existing host adapter. BL uses the registered Maestro preview opener; Cowork uses
  `openOnlyPreviewTarget`. Retain each adapter's live-tab/window reuse and remembered mount behavior.
- Remove the renderer's duplicate preview call. Preview opening must not wait for the renderer's
  session-save queue. Both Chat and an agent-requested native picker use this path.
- Cancellation, binding failure, or an empty result never opens Preview.
- Preview failure does not roll back a successful workspace binding. Return a separate optional
  `previewError` status (`unavailable` or `open-failed`) alongside the successful result; Chat shows
  a localized warning and the existing workspace name remains the retry action. Tool callers
  receive the same status. Do not expose raw exception messages in the status.
- Keep `setWorkspaceDirectory`, startup/default restoration, per-turn refresh, broadcasts and
  historical-session switching free of auto-open side effects. This preserves the existing
  human-action boundary in [workspace binding](../features/onlypreview-workspace-binding.md).
- Keep clear/reselection and workspace persistence semantics unchanged. No reverse binding from
  OnlyPreview's own Project picker into Chat, new index policy, new button or new preference.

The only UI change is an existing toast on failure: workspace stays selected → warning suggests
clicking its name → the existing chip retries preview. Successful selection uses the existing UI.

## Verification

Run actual-method unit tests with native dialog, storage and preview adapters stubbed; no Electron
launch. Cover Chat and tool choose/switch/set, cancellation, binding failure, no duplicate open,
preview failure with retained workspace, and a blocked renderer save queue. Assert refresh/set and
restore do not open previews. Run affected workspace-binding tests and proportionate type checks
in each repository; preserve unrelated concurrent changes.

Human acceptance: in a build containing the change, choose or replace a workspace from Chat and
from an agent-requested native picker. Both should foreground the existing OnlyPreview host and
show the chosen directory; cancel does nothing. Then switch/send in an existing Chat and confirm
Preview does not reopen. Repeat with a detached preview window and after clearing/reselecting.

Verification results (2026-09-17):

- `node --test tests/onlypreview/onlyPreviewWorkspacePicker.test.mjs`: 14/14, exit 0.
  Actual Main/renderer methods cover both callers, replacement, pending and failed saves,
  cancellation, binding failure, sanitized preview failure and unavailable adapter, silent
  restoration/broadcasts, and localized warning delivery.
- `node --test tests/onlypreview/onlyPreviewWorkspaceBinding.test.mjs`: 12/12, exit 0.
- Targeted `vue-tsc --noEmit`: exit 0, zero diagnostics. Roots: `ChatPanel.vue`,
  `store/message.store.ts`, `src/shared/maestro/coach.api.ts`, with `src/env.d.ts` and
  `src/renderer/maestro/env.d.ts`, extending `tsconfig.web.json`.
- Targeted TypeScript node check: exit 2. Roots: `WorkspaceFileService`,
  `src/shared/maestro/coach.api.ts`, and `src/main/env.d.ts`, using `tsconfig.node.json` options.
  One existing dependency diagnostic remains in `artifactWriter.service.ts` (TS2339, union
  `error` property). Rechecking with only the two changed roots read from HEAD in memory produces
  the identical diagnostic; this change introduces none. This is not a clean whole-project check.
- Scoped `git diff --check`: exit 0.

No Electron/E2E, package, install or release. Human acceptance above remains to be performed.
