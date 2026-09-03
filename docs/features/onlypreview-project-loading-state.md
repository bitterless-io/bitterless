# The Preview Pane Says "Loading project" While the Index Builds

Status: implemented; owner verification pending

Owner request, 2026-09-03: 「再目录列表完成加载前，这个组件显示为 loading project 吧 做个好看的 loading 动画就行」 —
before the Project listing finishes loading, the empty preview pane should say it is loading the
project, with a good-looking animation, instead of "Select a file".

## The signal

The state is **derived by Main and pulled with the preview presentation**. Three cheaper designs were
tried on paper and all three are wrong:

- **Let the preview renderer subscribe to the search-progress broadcast.** `xpcMain.broadcast` is
  fire-and-forget with no replay, and the Vue preview view is created lazily — later than the bind.
  An event sent at bind time is simply missed, so the pane would sit on "Select a file" for the whole
  build. That is the one case the feature exists for.
- **Forward the search engine's raw state.** The engine re-enters `building`/`reconciling` on every
  watch-driven refresh, so an ordinary file save, a `git checkout`, or a build touching files would
  flip an already-usable Project back to "Loading project".
- **Store the state on the presentation.** Every path that binds a Project clears the presentation
  immediately afterwards, which would erase the value microseconds after it was set.

What is implemented instead:

| Transition | Trigger |
| --- | --- |
| → `building` | a Project workspace is bound — by definition before its index exists |
| → `reconciling` / `ready` | a search snapshot Main observed on its way to the renderers |
| → `failed` | the shell reports a build that failed before producing an index |
| cleared | the workspace is revoked, including a bind that succeeded and was then abandoned |

`ready` **latches**: once a Project is usable, later non-ready observations are ignored, and only a
fresh bind starts a new build as far as this pane is concerned.

`failed` exists because a first build that throws before an index exists emits no snapshot at all —
the engine's catch is conditional on having an index. Without a terminal, the pane would animate
forever beside a Project rail that already shows the error. The index build is renderer-driven, so
its failure is the renderer's to report; the report is authority-checked in Main, and a workspace
that is not the current one is ignored.

The value reaches the preview by re-publishing the preview presentation, which the preview renderer
already pulls. `snapshotInternal` derives it per snapshot rather than reading a stored field.

## The animation

Three index rows filling in under the copy, staggered so they sweep rather than blink in unison. The
metaphor is taken from the app's own vocabulary — the Project rail already draws the real index build
as a royal-blue bar — so it reads as "the file listing is being built" rather than as a generic
spinner.

The 52px mark is left **pixel-identical** to the empty state: no pulse, no ring, no scale. It is the
one element both states share, so animating it would make the swap to "Select a file" read as a
different component rather than as the same one finishing. For the same reason the empty state
reserves the same fixed-height slot the rows occupy — the column is centred, so content present in
only one state would move the mark and the heading when the index becomes ready.

`prefers-reduced-motion` keeps the rows, half filled and still: the state still reads as in-progress
without motion.

Delivery: [onlypreview-project-loading-state-119](../plan/tasks/onlypreview-project-loading-state-119.md).
