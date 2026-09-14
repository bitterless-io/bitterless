# OnlyPreview workspace selection empty state

Status: Implemented; code verification complete; human testing pending — 2026-09-14.

Ral: When OnlyPreview starts without a selected workspace, show a button that selects a workspace
together with guide text. Applies to BL and COWORK's shared OnlyPreview shell.

## User experience

Show a single workspace prompt in the left Project region whenever Shell's `workspace` is null.
Place it outside the Project/Recents switched panels so the action remains visible whichever tab
is selected. Selecting a workspace replaces the prompt with the existing navigation contents.

```text
OnlyPreview menu bar

Project / Recents          Existing file preview or preview empty state

Choose a workspace
Choose a folder as your
workspace to browse, search,
and preview its files.

[ Choose workspace ]
```

- English title/action: `Choose a workspace` / `Choose workspace`.
- English guide: `Choose a folder as your workspace to browse, search, and preview its files.`
- Chinese title/action: `选择工作区` / `选择工作区`.
- Chinese guide: `选择一个文件夹作为工作区，即可浏览、搜索和预览其中的文件。`
- Use the shared OnlyPreview i18n catalog in both apps. Keep guide text on the plain background.
- Use the existing system font and palette: white `#ffffff`, Project background `#f9fafc`,
  ink `#25283a`, muted `#6f7487`, Royal Blue `#4e5882`. The primary text button is borderless,
  compact, rounded, with visible keyboard focus. Keep the existing overall shell layout.

## Behavior and implementation boundary

- The action directly calls `onlyPreviewShellStore.chooseFolder()`, the existing native picker
  flow. Use `targetLoading` for disabled/loading state; repeated clicks cannot open another picker.
- Cancel keeps the empty state. Existing workspace-change events remain the only commit path;
  picker failure uses the existing visible Shell error handling and allows retry.
- A restored/selected workspace hides the prompt. Do not reinterpret a preview presentation's
  `workspaceId` as a selected Project: an external file may have an authority without a Project.
- No workspace plus an external file still shows the prompt in the left region and preserves the
  visible file. Do not change startup restoration, chooseFolder IPC, or preview host ownership.
- Do not put the prompt into Shell's `previewContentHost`: the native Vue Preview view already
  covers that region even for its empty state. This feature needs no new native-view/XPC path.
- Move the existing `projectEmpty` UI to the shared left area rather than creating two copies.
  Keep error handling reachable in the no-workspace state and respect panel accessibility.

## Verification and human acceptance

- Changed two shared shell files and the local i18n catalog in each app. The shell template and
  Less copies are byte-identical; catalog edits preserve each app's brand/language integration.
- Both Vue scripts/templates and Less compile; 205 English/Chinese keys match in each catalog.
- A temporary exercise of the actual compiled templates passed 16 scenarios: Project/Recents,
  workspace presence and loading across both repos, including external preview authority, visible
  errors, the picker callback and the button's guide association.
- Existing checks: BL Recents/ExplicitOpen passed 14/15 and the focused AppWiring folder checks
  passed 1/2; COWORK Recents passed 9/10. The three failures are pre-existing `<800` line guards:
  each Shell store is 869 lines in both HEAD/current, and the BL handler is 856 in both. None of
  those files was edited by this change.
- No new permanent tests were added. No Electron launch, E2E, full build, packaging or release.

Ral should start the new build without a remembered workspace, check both navigation tabs,
cancel the picker once and then select a directory. The guide/button stays until selection
succeeds, after which files appear. Also verify the CTA stays usable beside an external preview.

Workspace stop/reselection uses this same empty state while retaining the live tab and renderers;
see [workspace clear lifecycle](../issues/onlypreview-workspace-clear-retains-tab.md).
