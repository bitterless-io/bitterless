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

Ral's directory clarification: the managed root must contain an explicit institution_id parent segment, not only a hash containing the institution. BL uses `<library>/<backend-account-sha256>/<institution_id>/<workflow-id>-<revision-directory-uuid>/`; the catalog lives inside that institution directory. Validate the institution identifier before constructing paths; identical workflow IDs in separate institutions never share storage.

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

## Shared and institution scopes (Ral, 2026-09-16)

This requirement applies to BOTH Skills and Workflows. Shared means local/builtin content common to this desktop across accounts; it does not publish institution data to a public cloud catalog. Institution means content obtained for an authenticated account's currently selected, live-authorized institution. Backend archive APIs remain institution-scoped.

| Scope | Directory / ownership | Account or institution switch | Display and Agent identity |
|---|---|---|---|
| shared | Explicit shared root, outside account namespace; retain existing local/builtin Skill locations compatibly | Remains available, including logged-out state | Shared badge and qualified shared identity |
| institution | Account/backend namespace -> literal sanitized institution_id -> skill/workflow stable identity -> revision | Old context immediately disappears from list, search, prompt and tool resolution; new context reauthorizes | Institution badge, institution identity and qualified cloud identity |

Separate parent directories explicitly by institution_id; do not hide institution identity solely inside a combined hash. Example library path: <library>/<backend-account-scope>/<institution_id>/<workflow_id>/<revision>. Shared workflows use <library>/shared/<workflow_identity>/<revision>. Equivalent existing Skill paths may be retained as shared without destructive migration, while new institutional Skill directories must have an explicit institution_id parent. Preserve local user files and stable existing shared references. Never classify previously downloaded institution data as shared merely because an old directory was flat; use its stored provenance, migrate/quarantine owned data safely, and remove it from shared discovery.

Workbench Skill and Workflow lists and details identify scope and institution. Shared workflows include the canonical offline demonstration package and supported local package imports, available without login. Existing trusted Kimchi builtins remain shared entries or explicit shared runtime catalog entries. Imported package previews are declarative JSON only. Institutional packages are downloaded through authenticated APIs. Copy/import to shared must be an explicit user action, never an automatic side effect of sync or logout.

The actual Agent catalog must carry the distinction, not just UI labels. Include shared vs institution, current institution identity, stable qualified reference and an entry/path identifier. Preserve existing shared names where unambiguous; same-name cross-scope entries must remain independently addressable without silent precedence. Skill path discovery/search and workflow invocation must resolve only the current authorized institutional context plus shared assets. No broad parent directory scan may expose another account/institution. Invalidate cached catalog/system prompt/runtime discovery when the account or institution changes; reject stale direct references to managed institutional paths while keeping trusted arbitrary local workflow behavior explicit. Do not leak tokens or unrelated institution metadata to the Agent.

Verification adds: shared content survives logout/account switch; both Skills and Workflows have explicit institutional parent directory; identical display names remain independently addressable; agent prompt/catalog, search, path discovery and resolution agree with the visible scope; membership loss and late replies cannot restore inaccessible content; old flat institution Skill artifacts do not leak into shared discovery. Preserve unrelated existing local files and shared runtime behavior.

### Skill provenance and scope assignment

Preserve existing known shared/builtin skill directories and references. Preserve existing cloud Skill sync where the app already has it, partitioning institutional downloads using authoritative cloud provenance; this request does not require adding a new BL cloud Skill service where none exists. New local Skill imports/recordings must choose Shared or the currently authorized institution explicitly; default selection must be shown before import/create. Known shared presets stay shared.

Do not guess an institution for legacy recorded/imported skills that were presented as institutional but have no stored owner/provenance. Keep their bytes untouched, exclude them from Agent discovery until assigned, and expose an explicit Workbench migration/assignment action explaining that a scope is needed. This is a migration state, not a third final sharing scope. The user can assign Shared or current authorized institution; copy/activate safely before archiving an owned old reference, never destroy source files on failure. Do not demand a chat-level decision to implement this action.
