# Project directory loading gates

Status: Implemented; code verification complete; human testing pending — 2026-09-15.

Ral requires Project bookmarks and Locate to wait for the directory list. Until the current
Project's list is available, show a loading animation in the list region. Apply the same behavior
to BL and COWORK.

## State and layout

The Project panel has a 1px right divider using the existing divider color, including while loading
or empty (explicit owner request, 2026-09-15). The divider stays fixed when the directory scrolls.

Use Shell.projectionReady as the successful directory-listing gate. Its source is a validated root
listing for the current workspace and generation, including an empty listing. Search index progress
or a synthetic root row does not establish readiness.

```text
Project | Recents             Collapse  Locate (disabled)

                loading animation
                Loading project

              ↓ current root listing arrives

Project | Recents             Collapse  Locate
Bookmarks (existing contents/empty state)
Project root and directory rows
```

- Before a root listing arrives: hide the whole bookmarks region, disable Locate, and show a
  compact centered loading indicator in the Project list area. Include a stable name, status/ARIA
  label and existing localized loading-project text. Use the existing Arco loading component and
  borderless semantic Less styling; retain the current Project header and panel navigation.
- Ready: remove the loader and render the existing bookmark/tree states immediately. Empty
  directories are successful results and do not keep spinning. Locate is enabled only when the
  current preview belongs to this Project; enforce readiness in its action as well as its button.
- Background indexing/reconciliation after readiness retains the directory and bookmarks.
- Changing or clearing the workspace resets listing readiness. Old-generation listings cannot
  finish the new Project's loading state. No workspace retains the existing chooser guide.
- Failed initial loading stops the animation and retains the existing error message. Keep failure
  separate from unrelated preview/menu errors; a successful current root listing or an existing
  retry/new-workspace flow clears the failure state. Do not introduce new retry UI.
- Gate bookmark visibility without changing persistence, ordering, or background bookkeeping.
  Recents and the existing Preview region remain independent.

## Implementation and code verification — 2026-09-15

The Shell exposes projectListingLoading from the bound workspace, projectionReady and a dedicated
initial-listing failure flag. App shows an Arco loader in the Project list region until readiness;
BookmarkBar gates its nav while the component stays mounted. Both the Locate button and its store
action require directory readiness. Retry, clear, workspace switch and a valid root listing reset
initial failure appropriately; preview/menu errors and background indexing do not drive this gate.

BL and COWORK each pass 27/27 focused tests: existing bookmarks/root-listing coverage plus loading
state and previous shared-presentation-event regressions. New loading tests fail 0/4 against the
old HEAD and pass 4/4 with the repair. They use the real Shell, projection, deferred loading and tree
expansion, and rendered App/Bookmark template VNodes for loading/status, bookmark visibility and
Locate availability. Empty root, stale events, clear/switch, background indexing and failure/retry
are covered.

Each app's two changed Vue SFC scripts/templates and App.less compile successfully. The four
shared source files and regression tests match between apps; diff checks pass. No Electron GUI/E2E,
independent review, full build, packaging, installation or release was run.

## Human handoff

Human test in the updated BL and COWORK: select a sufficiently large Project, observe only the
loader in its list region with no bookmarks and Locate disabled; when the list appears, confirm
bookmarks return and the current in-project preview can be located. Also try an empty directory,
switching projects and clearing the workspace.
