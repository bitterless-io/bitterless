# OnlyPreview large-content filesystem I/O in Electron Main

Status: implemented; owner runtime verification pending

## Requirement

Ral, clarified 2026-08-31: Electron Main must not perform filesystem reads or writes whose payload
can become large enough to stall the window/control process. Small bounded application
configuration and operational persistence are not part of this migration and must remain on their
existing paths.

OnlyPreview Main therefore remains a capability, revision, window/view and OS-action coordinator
for project content. Workspace traversal, project-file `open`, content reads, streaming and Delete
belong to a trusted renderer-process preload. Visible pages remain sandboxed and receive only
narrow operations. Existing small window-state, setting, shim and logging persistence is retained.

This issue is intentionally scoped to OnlyPreview and shared services reached by it. The wider
Bitterless Main tree currently contains many unrelated filesystem owners (Maestro, MCP, Codex,
EyesOnAgents, Coin, Submodules and others); completing this issue must not be reported as an
application-wide zero-Main-I/O migration.

## Confirmed current violations

The initial source audit found direct Main filesystem calls in:

- `onlyPreviewWorkspace.registry.ts`: target/root/item resolution, file open and identity checks,
  delete;
- `onlyPreviewClassifier.service.ts`: signature and text reads through a Main-owned handle;
- `onlyPreviewAsset.registry.ts`: Main-owned file streams and post-stream `stat`;
- `onlyPreviewDocument.registry.ts`: HTML root/resource `realpath`/`stat` and stream validation;
- `onlyPreviewIndex.service.ts`: legacy Main traversal (`lstat`/`realpath`/`readdir`);
- `onlyPreviewAgentSkill.service.ts`: synchronous access/path checks.

The audit also found small bounded Main persistence on normal OnlyPreview paths:

- `windowState.service.ts` persists a small window-layout configuration;
- `mcpHandler.ensureShim()` writes the small fixed MCP launcher shim;
- application logging persists bounded diagnostic records.

These are explicitly **not violations after Ral's clarification** and must not be migrated as part
of the project-content performance boundary.

The production search/index/browse runtime and Settings/Recent-directory SQLite are already valid
examples: their filesystem/database work runs in renderer preloads and Main only relays bounded
control/metadata messages. The old `onlyPreviewIndex.service.ts` Main traversal is no longer wired
and should be deleted or moved so it cannot regress into production.

Task 081 must not extend this legacy boundary: Office selection, admission metadata, identity,
signature and complete-byte reads move to the existing hidden `fileSearch` preload. Main performs
only in-memory host/runtime/revision/adapter authorization for Office.

## Migration constraints

- Do not unsandbox Shell, Vue Preview, Global Search, Settings or Guide.
- Do not expose a generic `read(path)`, `stat(path)`, root path, database path, absolute path or
  filesystem capability to a visible page.
- Use separate unguessable capability-bound XPC interfaces for privileged preload services and
  explicit result envelopes so thrown filesystem errors cannot leak paths through transport logs.
- Keep large payloads bounded and single-generation. Existing `electron-xpc` structured-clones
  renderer results through Main, so use small serial frames (or another explicitly reviewed
  transferable channel), never a whole-file XPC result or parallel whole-file buffers.
- Preserve raw HTML/PDF containment, Range behavior, symlink/replacement checks, revision
  revocation, native external-open/reveal actions and delete confirmation semantics.
- Do not change existing small configuration, window-state, Agent Skill/shim or diagnostic
  persistence solely to remove an `fs` import.
- The source guard must follow project-content data paths and size ceilings. A filename-only ban on
  every Main `fs` import is broader than this requirement and is not an acceptance criterion.

## Acceptance

- Workspace opening, Project listing, current-file preview, text reading, HTML/PDF/assets and file
  Delete/content metadata work through trusted preload capabilities with explicit byte ceilings.
- Main receives no project file handle and never reads or buffers a complete potentially large
  project file.
- Existing bounded window-state/settings, Agent Skill/shim and logging behavior remains unchanged.
- Main remains responsible for in-memory authorization/state, Electron windows/views, protocol
  routing, explicit native OS actions and small operational configuration.
- Focused source/integration tests and the production build pass; Electron/Playwright/E2E remains
  Ral-owned.

## Audit outcome

Task 081 removes Office selection/admission/content filesystem I/O from Main: the hidden
`fileSearch` preload owns containment, identity, `open` and bounded reads, while Main performs only
in-memory authorization and bounded frame relay. Independent
[Task 081 review 1](../plan/reviews/onlypreview-ooxml-viewer-runtime-repair-081-1.md) found no Office
Main-fs path.

Tasks 083-085 complete the large-content boundary. Task 087 then independently audited every
project-content path, including the existing Office relay, and found no P1, P2 or P3 issue:
[Task 087 review 1](../plan/reviews/onlypreview-main-fs-boundary-audit-087-1.md). The complete
non-E2E OnlyPreview suite passed 532/532 and the independent focused boundary suite passed 46/46.

This issue does not claim that OnlyPreview—or Bitterless as a whole—has zero Main-process
filesystem I/O; that broader claim was explicitly withdrawn by the clarified requirement. Small
bounded application configuration, window-state, Agent Skill/shim and logging persistence remains
in Main.

## Delivery plan

The migration is split into the serial
[analysis and integration plan](../plan/analysis/onlypreview-main-filesystem-preload-migration.md):

1. [Task 083](../plan/tasks/onlypreview-retire-main-index-083.md) removes the dead Main traversal.
2. [Task 084](../plan/tasks/onlypreview-project-authority-preload-084.md) moves Project metadata,
   native-action authorization and two-phase Delete to the hidden preload.
3. [Task 085](../plan/tasks/onlypreview-preview-stream-preload-085.md) moves text, asset/PDF/media
   and HTML reads/streams.
4. [Task 086](../plan/tasks/onlypreview-auxiliary-main-io-086.md) is superseded by the clarified
   boundary and intentionally leaves small configuration persistence unchanged.
5. [Task 087](../plan/tasks/onlypreview-main-fs-boundary-audit-087.md) performs the final
   large-content data-path and integrated delivery audit.
