# Workbench institution Kimchi workflows

Status: approved by Ral, implementation in progress (2026-09-16).

## Scope

Ral requested a Kimchi-compatible sample archive published to each selected institution and a Workflow tab in both desktop Workbenches: workflow list, details and a polished flowchart. Complete the earlier institution sharing contract by downloading, checking for updates and replacing managed local installations. Use the existing Kimchi 0.0.9 runtime. Editing graphs and automatically executing downloaded code are outside this request.

## Package contract v1

ZIP root contains workflow.json, an entry .ts/.mts file and optional supporting files/README.md. No dependency installation. workflow.json has format=kimchi-workflow-package, version=1, engine=kimchi-0.0.9, entry (normalized relative .ts/.mts), name, description and graph. Graph nodes have unique safe id, label, kind and optional description; kind is function|agent|parallel|branch|foreach|loop|workflow. Edges have from/to referring to existing nodes and optional label. Bound manifest/graph sizes and reject malformed or unsupported data with an actionable error. A graph is authored preview metadata, not proof of executable behavior. Listing, detail, download and visualization MUST NOT import or execute workflow TS. Explicit chat workflow execution retains the existing worker/supervisor permissions.

The sample is authored from the installed public Kimchi flow API and TypeBox. It accepts a string and performs prepare (trim) -> count (words) -> summarize, returning a deterministic message without model, file, process or network operations. Same archive bytes can be independently registered on the two backends. The publishing institution must be confirmed; no assumed institution 1 or exposure to other institutions.

## Data, auth and synchronization

Reuse the existing authoritative logged-in backend/account/institution context; credentials stay outside renderer, manifests and persistence. Never send authentication to arbitrary archive hosts. Use the new institution workflow list/detail/download-url/check-updates APIs and their actual backend response envelopes. UI exposes current institution and loading, unauthenticated, missing-institution, empty and retryable-error states. BL can select among the authenticated customer's live institutions; Cowork follows its selected CRMS institution.

Use a separate managed workflow library scoped by backend, authenticated account and institution, keyed by stable cloud workflow ID. Keep revision, hash and entry mapping. On explicit install or preview of a cloud item, obtain signed download for the requested revision, verify compressed bytes and SHA-256, safely extract into staging, validate the manifest and entry, then atomically activate that revision. Reject traversal/absolute paths, symlinks, archive collisions and expansion bombs. Default caps: 20 MiB compressed, 100 MiB expanded, 500 files; graph <=200 nodes/500 edges, manifest <=256 KiB. Failed updates preserve the prior valid installation and show the error. Versioned directories plus atomic catalog replacement are allowed to preserve files used by an active run; they still represent one logical workflow. Do not modify unrelated local workflows. Removed cloud records cease appearing as installed; only their owned managed mapping/files may be removed. Never delete executing files.

Poll installed managed records every 60 seconds while authenticated and also after context changes/manual refresh. Serialize work, deduplicate installs, and fence all responses/activation by an account+institution generation. Logout, revocation and institution changes clear visible context and prevent stale completion; no cross-account cache exposure. Paused/offline failures preserve valid local files, with explicit last error/status and retry. Bound requests and stop timers on app/service disposal. New available records appear in the cloud list; updates to installed workflows activate only after complete verification. No download or preview runs the workflow.

## Layout and design

Use the application's existing typography and theme tokens. Spend visual emphasis on the flowchart: calm canvas, clear directional connectors, compact step cards with meaningful node-kind icons, selected-step outline and readable branching labels. Use royal blue for selection, teal for function steps, violet for Agent steps and amber for branch/loop semantics with accessible text. Respect light/dark themes and reduced motion. Avoid decorative statistics/cards unrelated to the workflow.

~~~text
Workbench navigation: ... | Workflow | ...
+-------------------------+-----------------------------------------------+
| Workflow  [Refresh]     | Name                         [Download/Sync]  |
| Institution / state    | Description / revision / sync status          |
| Search                 | [Flow] [Details]                              |
|-------------------------|-----------------------------------------------|
| Name         revision  |        Prepare -> Count -> Summarize          |
| Description / status   |                                               |
| Name         revision  | [Zoom out] [Fit] [Zoom in]                    |
| ... scrollable list    | Step detail: selected label, type, description|
+-------------------------+-----------------------------------------------+
~~~

List and main panel scroll independently. At narrow widths collapse the list to a compact selectable region and keep diagram controls usable. Enter/Space selects list items/nodes; clear focus styles. Details show description, package/engine, cloud revision, file size/hash and local sync state without secrets or signed URLs. Graph labels are escaped text (no raw HTML). Loading, empty graph, invalid manifest and network failure have distinct states; retry never presents fabricated data. Selected node shows its authored description. Fit/zoom/scroll must keep long/branching graphs inspectable. Copy an installed entry command/path if useful; no automatic execution. Preserve unrelated legacy workflows and existing runtime/chat behavior.

## Integration and verification

Real chain: Workbench pane -> renderer store -> typed electron-xpc API -> authoritative Main auth/context -> backend -> signed archive -> safe local package storage -> JSON parser -> diagram model/view. Existing Kimchi explicit file loader must successfully execute the published deterministic sample. Each app uses its established state, i18n, file/style and IPC conventions. Cowork keeps business BEM classes and stable name attributes alongside Tailwind; BL uses reactive State store, Arco and sibling Less with both en/zh keys.

Verify focused runtime/manifest/storage/synchronization tests including invalid graph/ZIP, hash mismatch, failed update rollback, removed records, stale account/institution responses and no-code-execution preview; real component/store route wiring; keyboard/empty/error/zoom/selection behavior. Run applicable strict Node/Vue types and build, with a rendered visual inspection at desktop and constrained width. Test fixture data is labelled as such and never used as production fallback. Independent review must pass before merge and synchronization. Record exact checks, screenshots, commits and publication IDs after completion.
