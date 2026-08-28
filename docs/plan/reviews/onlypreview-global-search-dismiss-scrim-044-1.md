---
id: onlypreview-global-search-dismiss-scrim-044-1
status: passed
reviewed_task: onlypreview-global-search-dismiss-scrim-044
target: working-tree
base: dev/next
date: 2026-08-28
review_type: independent-final-contract-and-ui-review
---

# onlypreview-global-search-dismiss-scrim-044 — Review 1

- Result: **PASS**
- Scope: Main-owned revisioned Global Search visibility, Shell event isolation, click-to-dismiss
  scrim, native child-view ordering, warm Search renderer closure, idempotent focus restoration,
  and task-scoped source/tests/docs. Unrelated dirty-worktree changes were preserved and excluded.
- Electron, Playwright, E2E, packaged smoke, and the real application were not run, as required.

## Findings

No P1, P2, or P3 finding remains.

## Reviewed contracts

### Main owns visibility and publishes one ordered truth

- `src/main/onlypreview/views/onlyPreviewGlobalSearchView.service.ts:62-66,82-106` stores an exact
  `{ revision, active, workspace }` snapshot, advances it for context reports, and replays current
  visibility so a reloaded Shell can recover an already-attached Search.
- `onlyPreviewGlobalSearchView.service.ts:115-163,273-317` advances and broadcasts visibility on
  show, close, failure, and teardown. An inactive repeated close republishes false without running
  focus fallback again, while a delayed failure restores focus only when the view was active.
- `src/shared/onlypreview/onlyPreview.types.ts:200-213` and
  `src/shared/onlypreview/onlyPreview.contract.ts` keep the snapshot and event host-scoped,
  revisioned, exact, and runtime-validated.

### Shell renders one cheap, click-consuming dismissal layer

- `src/renderer/onlypreview/shell/src/onlyPreviewShellEvents.service.ts:82-94,126-182` accepts only
  exact three-field events for the current host and ignores any revision older than the last
  accepted state.
- `src/renderer/onlypreview/shell/src/onlyPreviewGlobalSearchVisibility.store.ts` isolates the
  reactive visibility state from the larger Project controller.
- `src/renderer/onlypreview/shell/src/App.vue:323-330` mounts one non-focusable button as the final
  Shell child only while Search is active. Its pointer click is consumed by that element and routed
  through `onlyPreviewGlobalSearchDismiss.service.ts` to `closeGlobalSearch(..., mode: 'opener')`.
- `src/renderer/onlypreview/shell/src/App.less:523-533` covers the complete Shell with a static 14%
  Ink alpha fill and `no-drag`. It adds no blur, filter, animation, transition, shadow, renderer,
  native view, or unbounded work.
- The Search `WebContentsView` remains attached above the active Preview at the exact Preview
  bounds. It therefore occludes the Shell scrim in the Search region, while exposed Shell chrome
  is dimmed and becomes the single close target.

### Late and warm Search renderers converge on the same state

- `src/renderer/onlypreview/globalSearch/src/onlyPreviewGlobalSearchHost.client.ts:60-93,134-160`
  merges visibility events and snapshots through the same monotonic revision fence, closing the
  event-before-subscribe and async-snapshot races.
- `src/renderer/onlypreview/globalSearch/src/main.ts:14-25` no longer enters unconditionally during
  bootstrap. Active state enters the warm workspace once; inactive state exits, cancels the live
  request, and clears stale query/results.

## Verification

| Command / evidence | Result |
| --- | --- |
| Focused task and integration Node suites | **PASS, 33/33** |
| `yarn typecheck:node` | **PASS** |
| `yarn vue-tsc --noEmit --noCheck -p tsconfig.web.json --composite false` | **PASS** |
| Task-scoped ESLint | **PASS** |
| `yarn build` | **PASS**; validation-only package-name mutation restored afterward |
| `git diff --check` | **PASS** |
| Independent behavior and UI review | **PASS:** no P1, P2, or P3 finding |
| Electron / Playwright / E2E / real app | Not run, as required |

## Conclusion

**PASS — task 044 is ready for Ral's live acceptance.** Global Search now leaves one lightweight
transparent dismissal surface over every exposed Shell area, keeps its native Search surface fully
visible, consumes the background click, and closes through the existing opener-restoration path
without reloading Preview or creating another process/view.
