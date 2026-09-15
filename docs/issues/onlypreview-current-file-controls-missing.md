# Current preview header and Project locate action disappear

Status: Implemented; code verification complete; human testing pending — 2026-09-15.

Ral reports in BL and confirms in COWORK that a file is already being previewed, but the Project
locate-current-file button cannot be used and preview-header content is missing. The current header
shows only back/forward/reload navigation.
The supplied reference shows file name, path, type and the file-actions menu in the header.

## Observed code contract

Both apps currently derive the locate action and PreviewToolbar identity from
Shell.previewPresentation. The toolbar template still contains file name, path, type and actions;
there is no evidence yet that these elements were deliberately removed. Locate additionally checks
that the visible preview file belongs to the active Project workspace. A visible body alone does
not prove Shell received the matching presentation: the native preview has a separate state channel.

Investigate the main presentation snapshot, Shell request/event handling, current workspace identity
and native bounds. Do not patch a disabled condition or substitute stale tree selection before the
failed boundary is demonstrated.

## Confirmed root cause

Both apps install electron-xpc 1.1.0. Its real preload subscribe implementation stores one callback
per handleName with Map.set; a later subscriber replaces the earlier one. App mounts Shell first,
which subscribes to ONLY_PREVIEW_PREVIEW_PRESENTATION_EVENT, then initializes Recents. The September
14 Recents change subscribed directly to that same event, replacing Shell's callback.

A Node VM replay of each app's actual electron-xpc preload dispatch invokes Recents once and Shell
zero times for this mount order. Native Preview uses a separate renderer, so the file body updates
while Shell retains its initial empty presentation. The toolbar consequently hides file identity,
type and actions, and Locate remains disabled. This is not a missing template or an overlay issue.
The old single-store tests did not mount Shell and Recents together on the actual single-slot bus.

Repair: make the Shell presentation-event subscriber the single owner, then fan out to current
preview synchronization and active Recents refresh. Recents keeps its own RECENTS_CHANGED_EVENT
subscription. Preserve host filtering, dispose/remount behavior, current selection revisions and
independent request generations. Do not change the dependency globally or relax UI eligibility.

## Required result

- After selecting an in-project file and successfully previewing it, its current identity reaches
  the header and the locate button can expand, select and focus the matching Project row.
- Header identity and actions follow the actual preview across selection, reload and navigation;
  clearing a workspace or changing preview must not leave another file's identity or actions.
- Preserve independent external previews and their valid actions. Locate must not target an
  unrelated Project by treating an external authority ID as the active Project ID.
- BL is the canonical source; apply any shared repair to COWORK and preserve host-specific wiring.

## Implementation and verification — 2026-09-15

Shell now owns the one presentation subscription and forwards the notification to active Recents
through handlePreviewPresentation. Recents keeps only its own RECENTS_CHANGED subscription. The
existing host filter, request-generation checks and disposed-state gate remain effective. The two
stores are identical across BL and COWORK; no UI template, styling or eligibility fallback changed.

New onlyPreviewPresentationSubscriptions.test.mjs in each app uses its real electron-xpc preload
inside Node VM and the actual Shell-to-Recents mount order. It exercises actual Shell methods,
header computed state and the Locate action with real tree expansion. Both old HEAD implementations
fail 0/3; both repaired versions pass 3/3. Scenarios cover first/change selection, header identity,
locating the actual preview, current Recents state, wrong host, dispose/remount and stale responses.

The final focused files in each app report 12 passing tests and one existing failure: the Shell
store's <800-line guard (HEAD already 869 lines, current 874). Both store entry-point dependency
bundles compile with esbuild without warnings. Shared source parity and diff checks pass.
No Electron GUI/E2E, independent review, full build, packaging, installation or release was run.

## Human verification

Human acceptance: in the updated BL and COWORK, open a Project file, verify the expected header,
collapse its parent folders and click Locate; repeat with a second file and after clearing and
reselecting the workspace.
