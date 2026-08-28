---
id: onlypreview-global-search-transparent-scrim-046-1
status: passed
reviewed_task: onlypreview-global-search-transparent-scrim-046
target: working-tree
base: dev/next
date: 2026-08-28
review_type: independent-final-contract-and-ui-review
---

# onlypreview-global-search-transparent-scrim-046 — Review 1

- Result: **PASS**
- Scope: exact transparent Shell dismissal shield, absence of visual tint mechanisms, retained
  click capture and accessibility attributes, unchanged visibility/dismissal/native-view contracts,
  and task-scoped performance risk.
- Unrelated dirty-worktree changes were preserved and excluded. No production or test source was
  modified by this review.
- Build, Electron, Playwright, E2E, packaged smoke, and the real application were not run, as
  required by the independent-review assignment.

## Findings

No P1, P2, or P3 finding remains.

## 文件清单

| #   | 文件                                                                 | 问题数 |
| --- | -------------------------------------------------------------------- | ------ |
| 1   | `docs/plan/tasks/onlypreview-global-search-transparent-scrim-046.md` | 0      |
| 2   | `docs/design/onlypreview-global-search.md`                           | 0      |
| 3   | `src/renderer/onlypreview/shell/src/App.less`                        | 0      |
| 4   | `src/renderer/onlypreview/shell/src/App.vue`                         | 0      |
| 5   | `tests/onlypreview/onlyPreviewGlobalSearchUi.test.mjs`               | 0      |

## 问题清单

No TS-1, TS-2, FE-1, or FE-2 issue exists in the task-scoped changes.

- The reviewed Less, Vue, and test files are 549, 537, and 333 lines; every applicable JS/Vue file
  remains below the 800-line limit.
- Task 046 adds no function declaration/expression, Vue business flow, or business `emit`.
- The production hunk is one static CSS value change; the test hunk adds only bounded source
  assertions.

## Contract evidence

### Exact invisible treatment

- `App.less:523-533` retains the single `.onlypreview-shell__global-search-scrim` rule with
  `position: absolute`, `inset: 0`, `z-index: 40`, zero margin/padding/border, and
  `-webkit-app-region: no-drag`.
- Its background is exactly `transparent`. The rule contains no alpha/hex fill, element opacity,
  pseudo-element, gradient, shadow, filter/backdrop-filter, animation, or transition. No other
  selector or pseudo-selector targets the scrim class.
- `onlyPreviewGlobalSearchUi.test.mjs:315-325` scopes inspection to that exact CSS rule, requires the
  positioning/z-index/no-drag contract and exact transparent background, and rejects all specified
  tint/filter/motion mechanisms.

### Click dismissal, state, and native layering remain intact

- `App.vue:322-330` still mounts one button only while authoritative Search visibility is active.
  It retains `type="button"`, `tabindex="-1"`, its localized accessible name, and the existing
  `dismissOnlyPreviewGlobalSearch` click handler. Making a positioned button's background
  transparent does not disable its pointer hit testing, so the covered Shell action cannot receive
  the dismissal click.
- The focused UI contract test still proves the current-host, monotonic visibility fence and the
  unchanged `closeGlobalSearch({ hostToken, mode: 'opener' })` dismissal route. It also proves that
  Shell presentation does not directly own close/failure orchestration.
- Task 046 changes no Vue state/store/service, Main, XPC, preload, Search renderer, Preview service,
  focus restoration, or native child-view code. The native Search surface therefore remains above
  Preview and the Shell shield through the existing view ordering; Search itself is not made
  transparent.

### Performance and accessibility

- The change removes an alpha fill and adds no layout loop, repaint animation, timer, observer,
  reactive watcher, process, renderer, native view, request, or allocation proportional to project
  size. It cannot expand indexing/search work or memory pressure.
- The existing pointer-only shield intentionally remains outside linear keyboard navigation, while
  its accessible label remains present. Keyboard dismissal stays inside the active native Search
  workspace; task 046 neither changes focus order nor removes a keyboard path.

## Verification

| Check                                                              | Result                                   |
| ------------------------------------------------------------------ | ---------------------------------------- |
| `node --test tests/onlypreview/onlyPreviewGlobalSearchUi.test.mjs` | **PASS — 11/11**                         |
| Task-046 hunk lint/code-rule audit                                 | **PASS — 0 new errors**                  |
| Task-046 hunk Prettier comparison                                  | **PASS — no task-hunk formatting delta** |
| Task-scoped `git diff --check`                                     | **PASS**                                 |
| Code-review TS-1/TS-2/FE-1/FE-2 audit                              | **PASS — 0 findings**                    |
| Build / Electron / Playwright / E2E / packaged smoke / real app    | Not run, as required                     |

Whole-file ESLint still reports the existing
`onlyPreviewGlobalSearchUi.test.mjs:183` `explicit-function-return-type` error, outside the 046
hunk. Whole-file Prettier also reports unrelated pre-existing formatting at `App.less:334` and in
earlier Global Search test sections; Prettier proposes no change to the 046 CSS or assertion lines.
These are baseline noise, not task-046 findings.

## Conclusion

**PASS — task 046 is ready for Ral's live acceptance.** The existing full-Shell click shield is now
visually absent while retaining its complete click-capture, non-focusable accessibility, opener
restoration, state-fence, and native Search-over-Preview contracts, with no new performance cost.
