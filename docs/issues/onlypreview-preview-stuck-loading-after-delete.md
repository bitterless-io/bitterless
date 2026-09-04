# Deleting the selected file shows "Loading project" instead of "Select a file"

Status: fixed; owner verification pending

## Observed behavior

Select a file in the Project tree, delete it. The preview pane shows

```text
Loading project
Building the project index. Files appear as they are found.
```

instead of the `Select a file` empty state — with the Project tree beside it fully populated and
browsable.

## Root cause

The pane Ral saw is the **`projectIndexing` branch**, not the `Loading` strip:

```vue
<!-- PreviewSurface.vue:174-190 -->
<div v-else-if="!onlyPreviewPreviewStore.loading && onlyPreviewPreviewStore.projectIndexing" …>
  <h1>{{ onlyPreviewI18n.preview.loadingProjectTitle }}</h1>   <!-- "Loading project" -->

<!-- PreviewSurface.vue:192-203 — only reached when the branch above did not match -->
<div v-else-if="!onlyPreviewPreviewStore.loading" …>
  <h1>{{ onlyPreviewI18n.preview.emptyTitle }}</h1>            <!-- "Select a file" -->
```

Indexing is ordered **ahead of** empty, so whenever `projectIndexing` is true the empty state cannot
render at all.

`projectIndexing` reads `presentation.projectIndexState`, which Main derives in
`OnlyPreviewProjectIndexStateService`
(`src/main/onlypreview/onlyPreviewProjectIndexState.service.ts`). That service marks a workspace
`building` the moment it is bound (`markBound`, `:35-37`) and leaves it there until a **search
snapshot reports `ready`**:

```ts
// :46-53  markObserved — the only path to `ready`
if (current.state === 'ready' && state !== 'ready') return;   // ready latches
```

The single caller is the search-snapshot relay
(`src/main/windows/onlyPreviewWindow.helper.ts:842-853`). If no snapshot ever reports `ready` for
that workspace — a large Project, or an index that keeps reconciling — the state stays `building`
for the whole session.

**That stale state is invisible while a file is selected**, because every content branch precedes
the indexing branch. Deleting the selected file is simply the first moment the pane has nothing else
to render: `followDeletedSelection` → `clearWorkspace` → `clearPresentation`
(`onlyPreviewPreviewRegion.service.ts:314-344`) publishes an `empty` presentation that **keeps its
`workspaceId`**, so `snapshotInternal` (`:804`) re-derives the same stale `building`, and the pane
falls through to "Loading project".

So the delete path is correct and the empty presentation arrives as designed. The defect is the
**placeholder outranking the empty state for a Project that is demonstrably already usable**.

## Fix

The placeholder exists so an empty pane does not read "Select a file" before there is anything to
select — that rationale is spent the moment the Project has resolved a real file. The preview store
now records the last workspace for which Main delivered a `fileRef` **and** a `descriptor`, and
`projectIndexing` returns false for that workspace:

- `browsedWorkspaceId` is set in `applyPresentation` on every surface, because a Chrome-surface
  selection proves the Project is browsable exactly as a Vue one does.
- A Project that has proven nothing yet keeps the placeholder, so the first-build case the service
  documents is unchanged.

Deliberately **not** changed: the latch in `OnlyPreviewProjectIndexStateService`. Whether that
Project's index genuinely never reaches `ready` is a separate question — see below — and guessing at
it would have meant changing a state machine on no evidence.

## Acceptance

| Scenario | Expectation |
|---|---|
| Delete the selected file in a Project that has previewed a file | `Select a file` |
| Delete a folder containing the selected file | `Select a file` |
| Freshly bound Project, index still building, nothing selected yet | `Loading project` (unchanged) |
| Index reports `ready` / `failed` / no Project bound | Unchanged |
| A second Project bound in the same session | Its own first build still gets the placeholder |

Regression: `tests/onlypreview/onlyPreviewRenderingAdapters.test.mjs` — "a Project that has already
resolved a file drops the index placeholder for its empty pane". Verified to fail against the
pre-fix store and pass after it.

## Evidence gaps closed alongside the fix

Neither caused this issue. Both are why it took a source re-read instead of a log read to answer,
and both follow the rule the repo already applies elsewhere: *a `catch {}` may leave behavior
unchanged, it may not leave no evidence.*

1. **Index-state transitions are now recorded.** `OnlyPreviewProjectIndexStateService` emits
   `event=project-index workspaceId=… from=… to=…` on every transition, including `cleared`. The
   sink is injected (`setTrace`) rather than imported, so the service stays free of the Electron log
   runtime and pure-Node tests can still bundle it; it is wired in
   `onlyPreviewOpenDiagnostics.runtime.ts`, and an unwired service degrades to today's silence
   rather than to a crash. **This is what would have answered "why did `ready` never latch" from
   `onlypreview.log`** — that question is still open for Ral's Project, but it is now diagnosable.
2. **`followDeletedSelection` no longer fails silently**
   (`onlyPreviewProjectNativeAction.service.ts:659-678`). The swallow stays — bookkeeping must not
   fail a completed delete — but it now emits `event=delete-follow-selection-failed` with the
   workspace, node kind and reason. Every statement in that block is skipped on a throw, starting
   with the `requireCurrentItem()` authority check, which would leave the selection and the preview
   pointing at a file that is already off disk.
