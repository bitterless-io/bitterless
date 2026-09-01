# OnlyPreview Global Search And Result Preview

Status: Accepted; tasks 035–048, 072, 073, 076, 092, and 100 implemented through independent
review; owner verification pending

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

| Token             | Value                 | Use                                                                         |
| ----------------- | --------------------- | --------------------------------------------------------------------------- |
| Canvas            | `#f6f7fa`             | global-search background                                                    |
| Surface           | `#ffffff`             | input, result rows, preview stage                                           |
| Royal             | `#4e5882`             | active group rail, selected row edge, primary focus                         |
| Royal soft        | `#eceef7`             | selected/hovered structure                                                  |
| Project selection | `#d6e4ff`             | ordinary selected file or directory in the Project tree                     |
| Divider           | `#d9ddea`             | result/preview split and quiet borders                                      |
| Ink / muted       | `#25283a` / `#6f7487` | primary and secondary copy                                                  |
| Floating gutter   | `24px`                | transparent space between the native Search view edge and workspace surface |
| Floating surface  | `14px` radius         | one clipped search workspace with a restrained two-layer Ink shadow         |

Typography remains the app's system UI stack. File names use 12px/650, relative directories and
media labels use 10px/500, preview text uses the existing editor monospace stack, and group labels
use the existing 10px uppercase utility treatment. The signature element is a paired
Contents/Files workbench: two compact structural headers anchor equal parallel result ledgers
without cards, badges, gradients, or decorative motion.

## Layout

Global Search uses a dedicated trusted local `WebContentsView` child application. Main sizes that
native view to the complete OnlyPreview content area and separately supplies the real Preview
rectangle as renderer-local workspace geometry. The Shell Project tree, toolbar, and status rail
remain visible through the transparent canvas; the opaque search workspace stays at the same right
Preview position with its existing `24px` inset, radius, shadow, and internal dimensions. Closing
Search detaches only Search, so the selected-file Preview remains loaded.

```text
┌──────────── FULL-WINDOW TRANSPARENT SEARCH VIEW ──────────────────────────┐
│ transparent Project/menu area                                             │
│ ┌──────── PROJECT ────────┬──── current Preview rectangle ───────────────┐ │
│ │ visible underneath      │ 24px transparent inset                      │ │
│ │                         │ ╭────── floating workspace ───────────────╮ │ │
│ │                         │ │ Search / scope                          │ │ │
│ │                         │ ├──────── CONTENTS ────┬──── FILES ──────┤ │ │
│ │                         │ ├──────────────────────┴──────────────────┤ │ │
│ │                         │ │ PREVIEW                         Open ↗ │ │ │
│ │                         │ ╰── 14px radius + quiet shadow ──────────╯ │ │
│ └─────────────────────────┴────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────┘
```

```text
Any transparent canvas: click → Search renderer close → restore opener (click is consumed)
Workspace surface:     clicks remain inside Search
Native z-order:        Shell < native Vue/Chrome Preview < full-window Search
```

- Search input and scope stay fixed at the top.
- Main sets only the Global Search `WebContentsView` background to transparent. `html`, `body`, and
  `#app` fill the full native view and paint no canvas. The `.onlypreview-global-search` workspace is
  absolutely placed from Main's current Preview rectangle, applies the exact `24px` inset, remains
  opaque, clips all internal regions to one `14px` radius, and owns the shadow. Shell and Preview
  backgrounds are unchanged.
- The upper result region has two equal independent scroll ledgers: Contents on the left and Files
  on the right, separated by one quiet divider. DOM and linear keyboard order follow that visible
  reading order. Inside Files, all matching folders precede all matching files while each partition
  keeps its stable natural order; an empty group remains as a quiet heading plus one direct empty
  line only after the request settles.
- A horizontal separator divides results from the bottom preview. Default preview height is 38% of
  the search work area, keyboard/resizable within 25–70%, and restored only for the current window.
- The full-window Search renderer owns outside-workspace hit testing. Clicking any transparent
  Project/menu/splitter/Preview-gutter area explicitly performs the existing `mode: 'opener'`
  dismissal and consumes the event; clicks inside the rounded workspace never trigger dismissal.
  The historical Shell DOM shield from task 044 is retired rather than left as a second hit target.
- At the 800px minimum window width, the Project pane may remain at its existing 180px minimum; the
  search workspace receives the rest. Search is a child view, never a modal or extra top-level
  window. Its native z-order invariant is `Shell < active Preview < active Global Search`; every
  Preview attach and exact PDF document-frame-ready transition re-raises Search while it is active.
  Both result columns remain visible at narrow
  widths through `minmax(0, 1fr)` and text ellipsis; they never stack or create page-level
  horizontal scrolling.
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
- One click on a directory row outside its arrow selects it as Current directory without changing
  expansion. Double click on that row area keeps it selected and toggles expansion exactly once.
  One click on the directory arrow selects/focuses it as Current directory and toggles expansion
  exactly once; the arrow consumes the complete pointer gesture so it cannot also activate the row.
  Selecting a file records its parent as Current directory. Roving focus alone does not change
  Current directory; if no explicit tree selection exists, use the selected Preview file's parent,
  then root.
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
- Ordinary selected files and directories use the clearer light-blue `#d6e4ff` surface with the
  existing Royal trailing rail. An explicit selected-hover state keeps that surface above ordinary
  hover; focus, typography, row geometry, icons, and selection/expansion behavior remain unchanged.

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
  relative parent; the row includes one grapheme-safe verified snippet. The whole normalized query
  is one literal substring, including punctuation such as the hyphen in `agent-runtime`; neither
  FTS candidate generation nor snippet projection may turn it into a prefix/token match such as
  `ag`.
- A file may appear once in Files and once in Contents because the sections answer different
  questions. Exact-path deduplication occurs only inside each section.
- Files always uses Project scope over the existing file/directory metadata tier. Its complete
  matches are stable-partitioned as directories then files before the 250-row cap and token issue.
  Contents uses the live explicit directory by default and switches to Project through the
  selector. Both sections retain
  the same hidden/fixed/config/depth policy. Switching Contents scope cancels/supersedes the request,
  immediately clears rows and preview issued for the previous scope, and immediately reruns the
  current non-empty query without the typing debounce. It does not derive an anchor from result
  selection.
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
  | {
      kind: 'text';
      adapter: 'plain' | 'markdown' | 'html-static';
      name: string;
      text: string;
      truncated: boolean;
    }
  | { kind: 'directory'; name: string; entries: OnlyPreviewBrowseEntry[]; truncated: boolean }
  | {
      kind: 'office';
      adapter: 'xlsx' | 'docx' | 'pptx';
      name: string;
      sourceExtension: '.xlsx' | '.xlsm' | '.docx' | '.pptx';
      size: number;
      modifiedAt: number;
      readGrant: string;
    }
  | {
      kind: 'info';
      name: string;
      previewHint: OnlyPreviewKind;
      mediaType: string;
      size: number;
      modifiedAt: number;
    };
```

- Text preview from either Files or Contents reads at most the first 256KiB through the same
  containment, symlink, opened-identity, size, and tolerant-decoding boundary as Preview/Search.
  Markdown uses the safe Vue Preview renderer and reading-column style. Plain text uses the Vue
  Preview source typography without loading another Monaco runtime into the independent Search
  renderer. HTML uses a static sanitizer: scripts, event handlers, navigation, remote or local
  resource URLs, forms, embeds, styles, and active content are removed. Search preview never
  executes HTML; opening the file normally still uses Chrome Preview.
- XLSX/XLSM, DOCX, and PPTX use the same pinned, per-format lazy `@silurus/ooxml` session as the
  main Preview through a Search-specific component. The `office` response is metadata-only plus one
  opaque read grant. A Search-dedicated hidden-preload lane owns stable-identity reads and emits
  ordered chunks capped at 512KiB; Main validates and relays one chunk at a time and never performs
  file I/O or buffers a complete Office package. Search does not reuse the main Preview lane or its
  current-file Find state.
- Unknown/compound-extension files admitted by task 035 use `plain`. Known PDF/image/audio/video/
  Draw.io/unsupported files use `info` and are never read for search preview.
- Directory preview returns only direct children, sorted directory-first/naturally, with a hard cap
  of 200 and truthful `truncated`; it never recursively traverses on selection. Each direct-child
  name uses 13px semibold (`600`) typography, one pixel above the Search renderer's 12px base.
- Content-section rows retain their verified grapheme-safe match snippet, but bottom Preview does
  not reuse it. A Contents token resolves the same bounded file-head variant as a Files token for
  that text file. The pane starts at the beginning even when the query match lies after the first
  256KiB; it never accepts a renderer-supplied absolute path/offset or jumps to the match.
- Selection updates immediately and clears/disposes the prior preview. Preview dispatch uses one
  120ms fixed-window leading-plus-trailing scheduler: the first selection runs immediately,
  selections inside the interval replace one pending candidate, and the final candidate always
  runs. A stale result, selection, query, workspace, generation, token, byte frame, dynamic import,
  Worker, Viewer load/layout, or error cannot replace the current pane. Failures render one compact
  current-result error state and never clear the accepted result list.
- Preview components are selected with `defineAsyncComponent` by the returned variant. No preview
  dependency is bundled into the initial Shell path unless it is already shared by the Shell. Every
  accepted preview is keyed by its revision/result token; unmount cancels the Office read and
  disposes the Viewer/Worker before the next component can commit.

## Interaction

| Input                                           | Behavior                                                                                                                                        |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `Shift+Cmd/Ctrl+F`                              | open Global Search at the current explicit directory and focus/select query                                                                     |
| type / IME                                      | immediately retire rows from the previous query, then run one 120ms latest-only global query; composition text never dispatches early           |
| `Up` / `Down`                                   | move one row across Contents then Files and load its bounded file-content bottom preview                                                        |
| `Left` / `Right` on group heading               | collapse/expand only that group; both begin expanded                                                                                            |
| click or `Enter`                                | select and preview immediately; Office loads lazily; rapid changes coalesce to the last candidate without changing main Preview                 |
| double-click or `Cmd/Ctrl+Enter` on file        | open it in the main Preview, close Global Search                                                                                                |
| explicit Project-tree file/directory selection  | update the live Current directory; rerun only directory-scoped Contents                                                                         |
| double-click or `Cmd/Ctrl+Enter` on directory   | expand its full ancestry and target, select and center-focus it in Project, then close Global Search                                            |
| Contents scope selector                         | immediately retire the prior request/results and rerun the current non-empty query for Current directory or Project; Files remains project-wide |
| drag/keyboard separator                         | resize result/preview split within 25–70%                                                                                                       |
| click any transparent area outside the workspace | close Global Search in its own renderer, consume the click, and restore its live opener                                                         |
| `Esc`                                           | first clear a non-empty query; second close Global Search and restore prior Preview bounds                                                      |

Focus stays inside the search workspace while active. Project-tree interaction resumes after an
outside-workspace click closes Search; that dismissal click itself is never forwarded. Closing Search restores
focus to the surface that opened it when still valid, otherwise the current Project row, otherwise
the main Preview.

## State And Performance

- Opening search with no workspace shows one direct Open Folder state; no request is sent.
- Main publishes the authoritative host-scoped Search visibility state with a monotonic revision.
  Shell and Search receive current-state replay with each context report, but Shell paints no DOM
  shield. Search renderer geometry and visibility revisions fence outside-workspace dismissal;
  Shell/Search reloads and late async replies cannot resurrect an older state.
- A false visibility event also exits the detached warm Search renderer, cancelling its active
  request and clearing query/results before the next open. Repeated close requests republish false
  without repeating focus restoration.
- Pending may retain accepted warm/fresh rows only while query and scope identity remain unchanged.
  Editing the query or switching scope immediately clears the previous rows and preview before the
  replacement request starts, so an unfinished prefix such as `ag` is never presented as a match
  for `agent-runtime`. Stale/cancelled batches cannot mutate either section or the preview token map.
- Counting/indexing remains the existing 2px Project-bottom rail. Search shows no percentage or
  duplicate indexing explanation.
- Files, Contents, and preview each have distinct empty/error states. A failure in one preview does
  not turn the search request into an error.
- Priority, one Files/Folder metadata pass, and Contents SQLite share one request fence but execute
  as cooperative sibling branches in the hidden preload. A reusable committed snapshot is searched
  immediately while startup reconciliation builds a private candidate. After promotion, the same
  request reruns against the fresh snapshot and its terminal response replaces warm rows and result
  tokens. Files and Folder deliberately remain one pass: splitting them would clone the same tree
  and traverse it twice. No second traversal, XPC request, renderer, worker, or SQLite connection is
  created; both authoritative siblings must settle before each reader lease is released. A future
  persistent worker is reserved for Contents only if per-section diagnostics prove FTS CPU—not the
  initialization gate—is the remaining bottleneck.
- Each reader lease captures one matching SQLite/tree pair. Promotion raises a writer gate before
  waiting for active readers, swaps only after they drain, and then admits the fresh terminal phase.
  Schema-8 persisted non-file tree metadata is build-bound. A legacy/missing marker may derive a
  provisional directory-name tier only from ancestors of committed eligible file records: no
  filesystem walk, body read, empty-directory invention, or symlink authority. The tier remains
  uncertified and is terminal-replaced by the complete tree after promotion.
- A bounded watch performs one metadata-only preflight, then reads and commits eligible file bodies
  in ten-file chunks while the tree marker remains invalid. The 512-path ceiling therefore retains
  at most ten bounded bodies at once and does not create one transaction per changed file; failure
  leaves the marker invalid until a full reconcile proves completeness.
- Watch paths that are physically excluded from Search are partitioned before filesystem/stat and
  tree mutation; they may refresh a loaded Project listing but cannot invalidate Search or request
  a candidate. Recursive-watch failure uses capped, completion-aware reattachment/backoff rather
  than a permanent fixed-interval full-reconcile loop. Startup reclaims only exact stale
  candidate/previous artifacts for the active database basename.
- Anchorless full-segment wildcard policy uses exact shared segment-language dispatch; line
  terminators preserve ordered `*/`/`**/` semantics. Residual anchorless embedded-wildcard programs
  have an aggregate 64-state config limit and fail before traversal rather than multiplying rules,
  matcher states, and every workspace path into sustained CPU. Ordered descendant coverage can
  prove strict or union coverage by later excludes only within one non-refundable 16,384-credit
  ledger. Scale-dependent scans, representatives, continuation/product states, fixed-width keys,
  queue entries, and visited entries reserve before work or allocation; exhaustion fails open.
- Search remains one-active/one-latest and time-sliced. Filename traversal never opens file bodies;
  content reads keep the 1MiB cap; result preview adds at most one 256KiB text buffer, one 200-entry
  directory listing, or one bounded 25MiB Office buffer with one format Worker/Viewer. Supersession
  releases the prior buffer/list/session immediately; Search and main Preview Office lanes are
  independent.
- The Search child renderer stores at most 500 result rows and one preview payload. Office adds at
  most one bounded package buffer, Worker, and Viewer in its Search lane. No click can create a
  persistent collection, parallel Search full-file reads, or recursive directory scan.
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
  reveal/focus, `folder` display type, exact punctuated-query fencing, immediate Project/Directory
  scope reruns, group navigation, async component selection, Office leading/trailing coalescing,
  stale read/import/Worker/Viewer/error rejection, unmount disposal, preview race cancellation, Esc
  restore, reduced-motion and 800px layout source contract.
- Floating-surface tests: Search-only native transparency, transparent `html`/`body`/`#app`, exact
  body `24px` padding, one rounded/clipped/shadowed workspace, and gutter-only opener dismissal.
- Diagnostics tests: fake monotonic time, fixed stage ordering, first-per-section once, terminal
  cancellation/failure, event-count bounds, and exclusion of query, result text, paths, identities,
  tokens, and raw errors.
- Non-E2E gates: focused Node tests, node/web typechecks as applicable, i18n, scoped lint/format,
  debug build, and `git diff --check`. Ral owns real-app visual, keyboard, large-project, and resource
  acceptance; Electron/Playwright is not run unless he asks.
