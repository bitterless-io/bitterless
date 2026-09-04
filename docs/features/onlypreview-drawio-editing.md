# OnlyPreview Draw.io Editing

Status: parked (owner, 2026-09-04: 「draw 的需求先放着，先不用支持预览和编辑了」)

Nothing here is queued. The research below is kept because it is the expensive part —
the measured bundle numbers and the ruled-out alternatives — so picking this up later
starts from the decision rather than from the survey.

Owner request, 2026-09-04: 「对于 draw.io 我想好了，我要支持编辑！」, approved shape: the editor lives in
the preview pane, Save overwrites the file in place, and the write goes through the hidden
`fileSearch` preload with the same discipline as Delete.

This is the first time OnlyPreview writes **file contents**. `onlypreview.md` currently states that
it "never edits file contents"; folder authoring already broke the create/rename/delete half of that
sentence, and this breaks the rest. The contract is updated deliberately, not by accident.

## What exists

`src/renderer/onlypreview/preview/src/vendor/drawio/viewer-static.min.js` — draw.io **31.3.2**, the
viewer build, 4.0 MB, committed. It is loaded into the Vue preview surface with every remote asset
root redirected to a local one (`STYLE_PATH`, `SHAPES_PATH`, `STENCIL_PATH`, `DRAW_MATH_URL`,
`mxBasePath`) and `mxLoadStylesheets = false`, so it makes no network request. It renders; it cannot
edit, and the local asset root holds no stencils, so a diagram that uses shape libraries renders
without them.

## Is there a component to install instead?

No. Checked on the npm registry, 2026-09-04:

| package | latest | size | what it is |
| --- | --- | --- | --- |
| `mxgraph` | 4.2.2, **2020-10-28** | 9.5 MB | the graph *library* under draw.io. No palette, no format panel, no menus. Upstream archived it. |
| `react-drawio` | 1.0.7 | 36.5 KB | an `<iframe>` pointing at `embed.diagrams.net` — the editor comes from the network |
| `vue-drawio` | 1.0.0 | 36.5 KB | the same wrapper for Vue |
| `drawio`, `drawio-webapp`, `@drawio/*` | — | — | do not exist |

The iframe wrappers are out: they fetch the editor over the network and would send diagram content
to a third party. So an offline editor means vendoring draw.io's webapp. That is not a preference,
it is the only shape available.

Electron integration is not in question either: **`jgraph/drawio-desktop` is the official Electron
build of draw.io** (Apache-2.0, Electron ^44.1.1, active). It loads
`file://…/drawio/src/main/webapp/index.html` from a bundled copy of the same webapp — exactly the
arrangement below, with `drawio` vendored as the app's own submodule.

## The bundle — the one decision that needs the owner

`draw.war` is a Java **W**eb **a**pplication **ar**chive: a ZIP with a servlet layout, because
draw.io historically shipped as a Java servlet app. The static webapp sits at the archive root and
unzips to plain files; nothing Java is needed to serve it. Measured from its central directory:

| | |
| --- | --- |
| `draw.war` v31.3.2 | 3,647 entries, **50.2 MB packed / 144.5 MB unpacked** |

Where the bulk is, unpacked: `js/` 66.4 MB, `stencils/` 40.8 MB, `img/` 6.5 MB, `images/` 6.1 MB,
`WEB-INF/` 5.0 MB, `resources/` 5.4 MB, `templates/` 4.9 MB, `math4/` 3.1 MB.

Most of that is not an editor. `js/integrate.min.js` (21.3 MB) is draw.io's integration build, and
its size matches `app.min.js` + `stencils.min.js` + `extensions.min.js` (9.2 + 7.2 + 3.7) — so the
40.8 MB of loose `stencils/*.xml` is the same content in unpacked form and should not be needed.
A plausible offline embed set is:

```text
js/integrate.min.js   21.3 MB      images/          6.1 MB
img/                   6.5 MB      mxgraph/         3.0 MB
shapes/                2.2 MB      styles/          0.1 MB
resources/dia.txt                  index.html, js/bootstrap.js, js/main.js
                                   ── roughly 40 MB unpacked
```

For scale, the official desktop app ships 154–246 MB per platform. The exact kept set is confirmed
by the first fetch run and written back here; the estimate above is not yet verified against a
running editor.

**Recommendation: fetch and stage, do not commit.** This repository already has the pattern for a
large third-party payload — Maestro's external tools are fetched and staged into `Resources/` at
packaging time rather than living in the tree.

```text
scripts/drawio/fetch-editor.mjs      download draw.war, verify its SHA-256, unpack, trim, emit
vendor/drawio-editor/                gitignored, dev loads from here
Resources/drawio-editor/             staged at packaging time, outside the ASAR
```

Everything below assumes that plan. It is the only part that needs a yes before implementation
starts; the rest follows from it.

## Surface

The editor is a **third preview surface**, beside `vue` and `chrome`.

```text
preview region
├─ vue      Monaco · Markdown · OOXML · image · media · drawio VIEWER
├─ chrome   contained HTML · Chromium PDF
└─ drawio   the editor, its own WebContentsView on the local webapp   ← new
```

It has to be its own `WebContentsView` and not a component inside the Vue surface, for the same
reason the Chromium PDF surface is: it is a whole third-party application with its own document,
its own asset roots and its own CSP needs. Loading it into the Vue preview would put draw.io's
globals next to ours.

Viewing keeps using the existing viewer. Only an explicit **Edit** action switches a diagram to the
editor surface, so opening a folder full of `.drawio` files stays as cheap as it is today, and the
50 MB webapp is only paid for when the owner actually edits.

## Talking to the editor

Through draw.io's own **embed protocol**, not through its internals:

```text
editor page   local index.html?embed=1&proto=json&spin=1&noSaveBtn=0&saveAndExit=0&offline=1
host  ← {event:'init'}                     the editor is ready
host  → {action:'load', xml, autosave:1}   the diagram, once
host  ← {event:'autosave', xml}            every change, debounced by the editor
host  ← {event:'save', xml}                the owner pressed Save
host  → {action:'status', message, modified:false}   after a successful write
```

The embed protocol is the integration draw.io supports and documents, which is what makes this
maintainable across upgrades: our side never touches `EditorUi`, `Graph` or `mxCellEditor`. Messages
are `postMessage` JSON, and the host verifies `event.source` is the editor view and that the payload
shape matches before acting on it — an editor page is still a third-party application.

## Saving

Save overwrites the file in place. The write is the mirror image of Delete, and it is bounded the
same way:

| step | what |
| --- | --- |
| authorize | resolve the item through the workspace authority; refuse a symlink, a path outside the workspace, or a stale generation |
| pin | `lstat` the target and record `dev`/`ino`/`size`/`mtime` |
| stage | write the new XML to `.bitterless-write-<uuid>` in the **same directory**, so the rename cannot cross a filesystem |
| verify | re-check the target's identity — refuse if it changed since the pin |
| replace | `rename` the staged file over the target: atomic, so no reader ever sees a partial diagram |
| discard | on any failure, unlink the staged file and leave the original untouched |

The renderer never receives a write API. Main owns the command and the result; the hidden
`fileSearch` preload owns the syscalls, exactly as it does for create, rename and delete.

A file whose identity changed under the editor is refused with a typed failure and the alert error
dialog, rather than overwriting whatever is there now. The owner keeps their unsaved XML in the
editor, so nothing is lost by refusing.

## Unsaved changes

`autosave` marks the surface dirty; it does **not** write. A dirty diagram that is about to be
replaced — another file selected, the workspace changed, the window closed — raises the alert-layer
confirmation with three outcomes: Save, Discard, Cancel. Cancel keeps the editor where it is.

This is the first place in OnlyPreview where leaving can lose work, so it is the first place that can
refuse to leave.

## Limits

- `.drawio` and `*.drawio.xml`, plus a bare `.xml` whose root is `<mxfile` — the classification
  repair landed already, and it is what made the diagram path reachable at all.
- `.drawio.png` and `.drawio.svg` embed their XML inside an image. Editing them means re-embedding on
  save, which is a different write path; they keep rendering through the image surface for now.
- One editor at a time. A second Edit replaces the first, through the unsaved-changes gate.
- The same file-size limit the viewer uses.

## Delivery

Split, because the bundle step gates the rest:

1. `onlypreview-drawio-editor-bundle` — the fetch/verify/trim script, the gitignore, the packaging
   stage, and the recorded size. Nothing user-visible.
2. `onlypreview-drawio-write-authority` — the preload `writeFile` authority and its Main command,
   with the identity-pinned atomic replace. Testable with no editor at all.
3. `onlypreview-drawio-editor-surface` — the third preview surface, the embed protocol, Edit/Save,
   and the unsaved-changes gate.
