# OnlyPreview Global Search And Result Preview

Status: Accepted; implementation tasks 035–040 complete through independent review; owner verification pending

## Purpose

`Shift+Cmd/Ctrl+F` opens one Global Search workspace for the current OnlyPreview directory. It
replaces the former Project-sidebar filter/search UI, separates filename/directory matches from
file-content matches, and gives every selected result a bounded preview below the result list.

The Project sidebar returns to one job: browse the current root. Its first row is the root directory
itself. The explicitly selected directory, including that root row, is the default Contents scope;
the search workspace can explicitly switch Contents to the whole project. Files always searches
project-wide file and directory names.

## Visual Direction

The design extends the existing OnlyPreview workbench instead of introducing a second visual
language.

| Token | Value | Use |
| --- | --- | --- |
| Canvas | `#f6f7fa` | global-search background |
| Surface | `#ffffff` | input, result rows, preview stage |
| Royal | `#4e5882` | active group rail, selected row edge, primary focus |
| Royal soft | `#eceef7` | selected/hovered structure |
| Divider | `#d9ddea` | result/preview split and quiet borders |
| Ink / muted | `#25283a` / `#6f7487` | primary and secondary copy |

Typography remains the app's system UI stack. File names use 12px/650, relative directories and
media labels use 10px/500, preview text uses the existing editor monospace stack, and group labels
use the existing 10px uppercase utility treatment. The signature element is a paired Files/Contents
group rail: two compact structural headers divide one continuous result ledger without cards,
badges, gradients, or decorative motion.

## Layout

Global Search occupies the existing right work area. The Shell keeps the Project tree visible and
sets the native Preview Region view to zero bounds while search is active; closing search restores
the prior content bounds and selected-file Preview without reloading it.

```text
┌──────────── PROJECT ───────────┬────────────── GLOBAL SEARCH ──────────────┐
│ ▾ bitterless                  │ [ Search files and contents…           × ] │
│   ▾ src                       │ Contents [ Current directory ▾ ] src/main │
│     …                         ├───────────────────────────────────────────┤
│                               │ FILES                                     │
│                               │  classifier.ts             src/main/...   │
│                               │  onlypreview               src/renderer   │
│                               │ CONTENTS                                  │
│                               │  classifier.ts             src/main/...   │
│                               │  …before matched text after…              │
│                               ├──────── draggable horizontal split ───────┤
│                               │ PREVIEW                         [Open ↗]   │
│                               │ selected result preview / direct children │
└───────────────────────────────┴───────────────────────────────────────────┘
```

- Search input and scope stay fixed at the top.
- The result ledger owns upper-region scrolling. Files always precedes Contents. Inside Files, all
  matching folders precede all matching files while each partition keeps its stable natural order;
  an empty group
  remains as a quiet heading plus one direct empty line only after the request settles.
- A horizontal separator divides results from the bottom preview. Default preview height is 38% of
  the search work area, keyboard/resizable within 25–70%, and restored only for the current window.
- At the 800px minimum window width, the Project pane may remain at its existing 180px minimum; the
  search workspace receives the rest. No modal or extra top-level window is created.
- Reduced-motion mode removes chevron/selection transitions; no ambient animation is introduced.

## Project Root And Scope

The Project tree renders one Shell-owned synthetic root row before the loaded root listing:

```text
▾ <workspace.rootName>      relative scope: ''
  ▾ src
    file.ts
  README.md
```

- The root row represents `relativePath: ''` but is not persisted to SQLite and is not inserted
  into the search index. Its children are the existing root browse listing.
- It starts expanded on a newly opened/restored workspace. Collapsing it hides loaded descendants
  without discarding browse tokens or expansion state below it.
- One click on a directory selects it as Current directory without changing expansion. Double click
  keeps it selected and toggles expansion. Selecting a file records its parent as Current directory.
  Roving focus alone does not change Current directory; if no explicit tree selection exists, use
  the selected Preview file's parent, then root.
- The removed Project text field, roving tree focus, and search-result selection cannot change the
  directory anchor. Explicit Project-tree selection can: while Global Search is open, selecting a
  directory updates Current directory to that directory, and selecting a file updates it to the
  file's parent. Current-directory Contents supersedes its active request; Project-scoped Contents
  records the latest directory for a later switch without issuing an equivalent search.
- Root context actions retain directory parity: Reveal, Copy Folder, Copy Path, Copy Relative Path
  (`.`), and Copy Name. Root never exposes Delete.
- Search-excluded files and directories remain browseable but use a pale-orange row background.
  Excluded directory icons use solid accent orange in both open and closed states; excluded files
  keep the ordinary file icon. The background persists across hover and selection, with the Royal
  selection rail retaining the selected state. Each opaque directory token carries whether its
  descendants are physically blocked, so an exact directory-only exclusion still marks loaded
  children without a Renderer path scan. A directory kept traversable for an ordered `!`
  re-inclusion does not force that re-included descendant orange. The synthetic root and symlinks
  are not given this marker.

## Search Result Contract

One request returns two independently capped sections. Each section is limited to 250 results, for
at most 500 visible rows total.

```ts
type OnlyPreviewGlobalSearchScope =
  | { kind: 'directory'; relativePath: string }
  | { kind: 'project' };

interface OnlyPreviewGlobalSearchFileResult {
  section: 'files';
  resultToken: string;
  name: string;
  relativePath: string;
  parentRelativePath: string;
  nodeKind: 'file' | 'directory';
  previewHint: OnlyPreviewKind;
  mediaType: OnlyPreviewSearchMediaType;
}

interface OnlyPreviewGlobalSearchContentResult {
  section: 'contents';
  resultToken: string;
  fileName: string;
  relativePath: string;
  parentRelativePath: string;
  mediaType: 'text';
  contentMatch: OnlyPreviewSearchContentMatch;
}

interface OnlyPreviewGlobalSearchResponse {
  workspaceId: string;
  generation: number;
  requestId: string;
  files: OnlyPreviewGlobalSearchFileResult[];
  contents: OnlyPreviewGlobalSearchContentResult[];
  filesTruncated: boolean;
  contentsTruncated: boolean;
}
```

- Files matches Unicode-normalized literal `name` and includes eligible files plus directories.
  Primary text is `name`; secondary text is the relative parent (`.` for root children).
- Contents searches eligible text bodies only. Primary text is `fileName`; secondary text is the
  relative parent; the row includes one grapheme-safe verified snippet.
- A file may appear once in Files and once in Contents because the sections answer different
  questions. Exact-path deduplication occurs only inside each section.
- Files always uses Project scope over the existing file/directory metadata tier. Its complete
  matches are stable-partitioned as directories then files before the 250-row cap and token issue.
  Contents uses the live explicit directory by default and switches to Project through the
  selector. Both sections retain
  the same hidden/fixed/config/depth policy. Switching Contents scope cancels/supersedes the request
  but does not derive an anchor from result selection.
- After the existing priority, promotion, and first-build readiness gates, the authoritative Files
  metadata branch and Contents SQLite branch start cooperatively. Either section may publish first;
  the terminal response waits for both. Cancellation or branch failure drains both branches before
  active-index ownership is released.
- During first build, the latest manually opened eligible file may publish a complete early Files
  and/or Contents row, and scoped Contents may stream from its bounded traversal. The request
  remains pending until the existing project candidate supplies complete Files metadata; the
  authoritative terminal response then replaces both sections without a duplicate project walk.
- The hidden preload keeps only the latest request's bounded `{ resultToken → exact result }` map.
  Query change, cancellation, workspace/generation change, refresh, promotion/failure, and shutdown
  revoke old result tokens.

## Result Preview Contract

Selecting a row by pointer or keyboard requests preview data using only the current
host/workspace/generation/request/result token. Main validates and relays; it performs no filesystem
I/O. The hidden preload resolves the token and returns one exact bounded variant:

```ts
type OnlyPreviewGlobalSearchPreview =
  | { kind: 'text'; adapter: 'plain' | 'markdown' | 'html-static'; name: string;
      text: string; truncated: boolean }
  | { kind: 'directory'; name: string; entries: OnlyPreviewBrowseEntry[]; truncated: boolean }
  | { kind: 'context'; name: string; before: string; match: string; after: string;
      truncated: boolean }
  | { kind: 'info'; name: string; previewHint: OnlyPreviewKind; mediaType: string;
      size: number; modifiedAt: number };
```

- File-section text preview reads at most the first 256KiB through the same containment, symlink,
  opened-identity, size, and tolerant-decoding boundary as Preview/Search. Markdown uses the safe
  Markdown renderer. HTML uses a static sanitizer: scripts, event handlers, navigation, remote or
  local resource URLs, forms, embeds, and active content are removed. Search preview never executes
  HTML; opening the file normally still uses Chrome Preview.
- Unknown/compound-extension files admitted by task 035 use `plain`. Known PDF/image/audio/video/
  Office/Draw.io/unsupported files use `info` and are never read for search preview.
- Directory preview returns only direct children, sorted directory-first/naturally, with a hard cap
  of 200 and truthful `truncated`; it never recursively traverses on selection.
- Content-section preview returns a verified bounded context around that exact result. It does not
  render the whole file or accept a renderer-supplied absolute path/offset.
- Preview fetch is latest-only. A stale result, selection, query, workspace, generation, token, or
  component load cannot replace the current pane. Failures render one compact info/error state and
  never clear the accepted result list.
- Preview components are selected with `defineAsyncComponent` by the returned variant. No preview
  dependency is bundled into the initial Shell path unless it is already shared by the Shell.

## Interaction

| Input | Behavior |
| --- | --- |
| `Shift+Cmd/Ctrl+F` | open Global Search at the current explicit directory and focus/select query |
| type / IME | 120ms latest-only global query; composition text never dispatches early |
| `Up` / `Down` | move one row across Files then Contents and load its bottom preview |
| `Left` / `Right` on group heading | collapse/expand only that group; both begin expanded |
| click or `Enter` | select the row and show its bottom preview, without changing main Preview |
| double-click or `Cmd/Ctrl+Enter` on file | open it in the main Preview, close Global Search |
| explicit Project-tree file/directory selection | update the live Current directory; rerun only directory-scoped Contents |
| double-click or `Cmd/Ctrl+Enter` on directory | expand its full ancestry and target, select and center-focus it in Project, then close Global Search |
| Contents scope selector | switch Contents between live Current directory and Project; Files remains project-wide |
| drag/keyboard separator | resize result/preview split within 25–70% |
| `Esc` | first clear a non-empty query; second close Global Search and restore prior Preview bounds |

Focus stays inside the search workspace while active except for explicit Project-tree interaction.
Closing search restores focus to the element that opened it when still valid, otherwise the current
Project row, otherwise the main Preview.

## State And Performance

- Opening search with no workspace shows one direct Open Folder state; no request is sent.
- Pending retains accepted section rows and current preview. Stale/cancelled batches cannot mutate
  either section or the preview token map.
- Counting/indexing remains the existing 2px Project-bottom rail. Search shows no percentage or
  duplicate indexing explanation.
- Files, Contents, and preview each have distinct empty/error states. A failure in one preview does
  not turn the search request into an error.
- Files and Contents share one request fence but execute as cooperative sibling branches in the
  hidden preload. A reusable committed snapshot is searched immediately while startup reconciliation
  builds a private candidate. After promotion, the same request reruns against the fresh snapshot
  and its terminal response replaces warm rows and result tokens. No second traversal, XPC request,
  renderer, worker, or SQLite connection is created; both siblings must settle before each reader
  lease is released.
- Each reader lease captures one matching SQLite/tree pair. Promotion raises a writer gate before
  waiting for active readers, swaps only after they drain, and then admits the fresh terminal phase.
  Schema-8 persisted non-file tree metadata is build-bound and fail-closed; a legacy/missing marker
  permits only ordinary-file and Contents warm batches, never fabricated folder rows.
- A bounded watch performs one metadata-only preflight, then reads and commits eligible file bodies
  in ten-file chunks while the tree marker remains invalid. The 512-path ceiling therefore retains
  at most ten bounded bodies at once and does not create one transaction per changed file; failure
  leaves the marker invalid until a full reconcile proves completeness.
- Search remains one-active/one-latest and time-sliced. Filename traversal never opens file bodies;
  content reads keep the 1MiB cap; result preview adds at most one 256KiB text buffer or one
  200-entry directory listing. Supersession releases the prior buffer/list immediately.
- The Shell stores at most 500 result rows and one preview payload. No click can create a persistent
  collection, parallel full-file reads, or recursive directory scan.
- `[onlypreview-search]` diagnostics measure each process locally: Shell dispatch to first accepted
  batch/terminal, Main XPC call duration, and hidden-runtime SQLite open, count, candidate,
  reconcile, promotion, warm-snapshot availability, initial-tree-metadata wait, first
  Files/Contents result, and terminal time. Timings are never subtracted across process clocks.
  Logging is bounded and behavior-neutral.

## Required Verification

- Contract tests: strict grouped result/preview shapes, scope fencing, token revoke, independent
  caps/truncation, filename directories, content-only matches, first-build priority replacement.
- Security tests: forged/stale token/path/generation rejection, no absolute path, no Main I/O,
  over-depth/excluded/symlink/no-I/O, 256KiB and 200-child bounds, static HTML sanitization.
- Renderer tests: shortcut separation from `Cmd/Ctrl+F`, Project input removal, root row/keyboard/
  context actions, explicit live scope synchronization, folder-first Files order, nested directory
  reveal/focus, `folder` display type, group navigation, async component selection, preview
  race cancellation, Esc restore, reduced-motion and 800px layout source contract.
- Diagnostics tests: fake monotonic time, fixed stage ordering, first-per-section once, terminal
  cancellation/failure, event-count bounds, and exclusion of query, result text, paths, identities,
  tokens, and raw errors.
- Non-E2E gates: focused Node tests, node/web typechecks as applicable, i18n, scoped lint/format,
  debug build, and `git diff --check`. Ral owns real-app visual, keyboard, large-project, and resource
  acceptance; Electron/Playwright is not run unless he asks.
