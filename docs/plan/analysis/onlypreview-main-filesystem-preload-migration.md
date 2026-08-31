# OnlyPreview Main filesystem I/O preload migration

## Scope

This plan completes the clarified boundary in
[`onlypreview-main-filesystem-io.md`](../../issues/onlypreview-main-filesystem-io.md): Electron Main
must not own potentially large project-content reads, streams or mutations. The trusted hidden
`fileSearch` renderer preload becomes the owner of workspace path validation, project metadata,
body reads, streaming and the one explicit Delete mutation. Small bounded application
configuration and operational persistence stays unchanged in Main.

The scope is OnlyPreview plus shared services reached by it. Other Bitterless modules with their own
Main filesystem ownership are not silently migrated or reported as complete here.

## Initial boundary and delivery outcome

| Path | Final owner | State |
| --- | --- | --- |
| target inspection and workspace-root validation | hidden `fileSearch` preload | valid |
| Project browse/index/search/watch and search preview | hidden `fileSearch` preload | valid |
| XLSX/XLSM, DOCX and PPTX admission/body reads | hidden `fileSearch` preload | valid |
| legacy Project traversal | removed | retired by Task 083 |
| Project item/root metadata and Delete | hidden `fileSearch` preload | migrated by Task 084 |
| non-Office descriptor, signature and text reads | hidden `fileSearch` preload | migrated by Task 085 |
| image/media/Draw.io/PDF bytes and Range | hidden `fileSearch` preload | migrated by Task 085 |
| HTML entry and contained resources | hidden `fileSearch` preload | migrated by Task 085 |
| OnlyPreview window-state persistence | shared bounded Main configuration service | retained |
| Agent Guide skill/shim checks | existing bounded Main helpers | retained |
| OnlyPreview/search/Office diagnostic file writes | existing bounded Main logging | retained |

## Target architecture

```text
native dialog / OS-open target
            |
            v
Main: host + lifecycle validation, opaque IDs, native confirmation/actions
            |
            | private capability-bound XPC (path never reaches a visible renderer)
            v
hidden fileSearch renderer preload
  ├─ workspace containment + identity + item metadata
  ├─ bounded descriptor/text reads
  ├─ serial asset/document read sessions
  └─ two-phase identity-fenced Delete
            |
            v
filesystem / SQLite

visible Shell/Vue/raw Chromium
  └─ receives only relative metadata, opaque tokens and bounded content responses
```

Main retains in-memory host/workspace/selection/revision/grant registries, protocol request
validation, native dialogs, `shell.openPath`, reveal, clipboard projection and window/view
lifecycle. It may hold a canonical root string needed to authorize a native action, but cannot use
that string for project-file `open`, traversal, content streaming or mutation. Small bounded app
configuration is outside this content boundary.

## Integration enumeration

| Caller | Integration | Required proof |
| --- | --- | --- |
| Recent-directory/open router | private target inspection -> workspace authority bind | explicit target works before index completion; exact host/workspace generation |
| Project context menu | Main host/ref validation -> preload item/root resolution -> native action | no visible path API; symlink/device/identity failures remain typed |
| Delete confirmation | preload `prepareDelete` -> Main native confirmation -> preload `commitDelete` | replacement after confirmation is rejected; one regular file only |
| Preview Region | Main revision/adapter state -> preload descriptor/text/read grant | stale selection cannot publish ready/content |
| asset protocol | Main token/Range validation -> serial preload frames -> response | exact range/length/identity, bounded buffering, abort/revoke cleanup |
| HTML document protocol | Main token/resource validation -> preload-contained resource read | entry-directory containment and total revision budget |

## Delivery order

| Task | Boundary | Depends on |
| --- | --- | --- |
| `onlypreview-retire-main-index-083` | delete the dead legacy Main traversal and add a regression guard | Task 081 |
| `onlypreview-project-authority-preload-084` | Project root/item metadata, native-action authorization and two-phase Delete | 083 |
| `onlypreview-preview-stream-preload-085` | descriptor/text plus asset/PDF/media/HTML serial reads | 084 |
| `onlypreview-auxiliary-main-io-086` | superseded; retain bounded configuration/shim/log persistence | 085 |
| `onlypreview-main-fs-boundary-audit-087` | final large-content data-path audit and integrated non-E2E verification | 085 |

Tasks are serial because every later task consumes the same hidden runtime lifecycle, workspace
generation and failure envelope established by the earlier task.

## Performance and safety invariants

- No visible renderer receives an absolute path or generic filesystem method.
- Private runtime methods use independent unguessable capabilities and exact instance/workspace/
  selection/grant revisions.
- Whole files never cross XPC in one result. Reads are sequential, size-limited frames with one live
  generation and deterministic cancellation/close.
- Main never waits on an unbounded preload operation: every request has a fixed deadline and
  renderer replacement invalidates pending work.
- Existing size, archive, decompression, raster, Range, HTML budget and 30-second Preview watchdog
  limits remain in force.
- The final source guard follows project-content read/write call paths and their byte ceilings. It
  does not reject unrelated small configuration persistence merely because it imports `fs`.
