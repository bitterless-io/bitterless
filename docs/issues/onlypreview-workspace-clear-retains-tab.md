# Clearing a workspace must retain the OnlyPreview host

Status: Implemented; code verification complete; human testing pending — 2026-09-14.

Ral reports that clearing Chat's workspace while OnlyPreview occupies the fixed tab destroys the
preview host. Choosing a workspace again opens a separate window. His current instruction replaces
the 2026-09-10 close-on-stop behavior in the workspace-binding contract.

## Evidence and root cause

Both Chat stores capture the old directory, clear the session workspace and call
`coach.closeWorkspacePreview`. BL's registered `closeForPath` and COWORK's
`closeOnlyPreviewForPath` compare the real project root, then call
`onlyPreviewWindowHelper.destroyStandalone()`. This explicitly tears down the mounted
OnlyPreview surface, including its tab. The old workspace-binding tests assert this teardown.
Subsequent opens therefore no longer have the original host to reuse.
For a pinned or sole tab, tab closing can be refused after the internal host has already been
destroyed. Its surviving composite registry entry is then focused as an existing tab; explicit
open sees no live host and creates a standalone window. Retaining the original host avoids this
path without changing the normal singleton tab-open route.

Simply removing that call leaves the old Project bound. Revoking only the Project without handling
the remembered directory allows Shell's workspace-change restore to immediately bind it again.

## Current contract

This fixes workspace clearing in both BL and COWORK for ordinary tabs, fixed/pinned tabs and
standalone windows. Pinning is not the cause; the teardown operation is. No tab-kind special case
should retain the old destroy-on-clear behavior.

- Stop using the matching workspace unbinds Project and invalidates its pending selection/search
  authority. Keep the tab, mount, Shell/Preview views and live host process. Existing independent
  external-file previews remain independent of Project.
- The empty Project shows the existing Choose workspace button and guide, including on Recents.
  Old async restore/index/selection responses must not bring the cleared directory back.
- Stop also removes that automatic last-directory binding. This does not delete files, bookmarks,
  Recents or reusable per-directory index data.
- Choosing a workspace in Chat reuses and activates the still-live OnlyPreview tab. An existing
  standalone host is likewise reused in place. Host creation remains for genuinely absent hosts.
- Reopening a previously indexed directory uses the existing cache mechanism, with fresh workspace
  authority and normal filesystem reconciliation. Revoked workspace IDs are never reauthorized.
- If OnlyPreview currently holds another Project, stopping this Chat workspace does not alter it.
  Match canonical real paths so symlink aliases behave identically.

The existing search bootstrap derives its SQLite path from the canonical root. Engine startup
validates workspace/config/engine hashes before loading cached trees and index data, then
reconciles filesystem changes. Search shutdown closes handles and watchers without deleting the
database. Project unbinding must dispose only its matching search coordinator and authority;
global search-window stop or shutdown also tears down the host or independent preview readers
and is not the clear-workspace operation.

## Implementation and code verification — 2026-09-14

The shared clear-workspace service replaces host destruction in both host adapters. It serializes
with explicit opens, rechecks the current host/root, cancels remembered-directory restoration,
revokes Project selection and search authority, and broadcasts the empty Project. Existing Shell
handling displays the guide. The search runtime releases only the matching project coordinator;
external readers and the mounted host remain alive.

Passed focused Node regressions:

| Check | BL | COWORK |
| --- | --- | --- |
| Recent directory clear, storage and restore races | 27/27 | 7/7 |
| Background index lifecycle and scoped revoke | 26/26 | 15/15 |
| Main clear integration, tab/window hosts | 8/8 | 8/8 |
| Workspace binding wiring | 12/12 | 12/12 |
| Existing warm cache and filesystem reconciliation | 11/11 | 11/11 |
| Real tab-controller lifecycle | — | 12/12 |
| Agent target routing | — | 10/10 |

COWORK warm-cache verification used a temporary copy of the existing BL fixture pointed at
COWORK's actual engine. Ordinary, pinned and sole-tab controller tests retain the same tab,
container and host even when the saved opening preference is a window. Pinned/sole regressions
were confirmed failing against the old destruction path and passing against the repair.

The new clear dependency exposed an AgentTarget test loader limitation for .mjs modules. That
non-clear test now stubs the clear service boundary; the real clear behavior is covered by the
integration checks above.

Five changed TypeScript files in each app transpile without diagnostics. Narrow dependency-closure
type checks retain 5 BL and 4 COWORK existing diagnostics, identical to the in-memory HEAD baseline;
no new diagnostics. No dependency rebuild, Electron GUI/E2E, full build, packaging or release.

## Human handoff

Human acceptance in BL and COWORK: open OnlyPreview in the fixed tab, select a workspace, stop
using it, confirm the same tab shows the guide, then choose the old directory from Chat. The same
tab must render it without another window; search must reflect files changed while unbound.
Repeat with another directory and with an unrelated Project open. Also repeat in an ordinary
OnlyPreview tab and a standalone OnlyPreview window: both retain their existing host when cleared
and reuse it when a workspace is selected again.
