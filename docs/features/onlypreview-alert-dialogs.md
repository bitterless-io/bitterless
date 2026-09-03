# OnlyPreview Alert Dialogs

Status: implemented; owner verification pending

Owner request, 2026-09-03: replace the in-tree New Folder edit row with a real dialog, give
OnlyPreview a reusable error dialog, and make both live in the **alert** layer reserved by
[onlypreview-view-layers](onlypreview-view-layers.md).

> 「新建目录 需要弹出 alert view (webcontentsview) alert 级别，并展示组件 new folder 专用，并自动激活
> input … 如果有目录名冲突就提示出来 一个报错专用弹窗 也是 alert内但是 z-index 更高 … 标题 内容 确定按钮
> 文案都能制定」

## Why a view and not an `a-modal`

The OnlyPreview window is a `BaseWindow` whose content is a stack of `WebContentsView`s. A modal
rendered inside the Shell renderer can only cover the Shell's own pixels, so it would appear *under*
the preview surface — the same defect that took three rounds to fix for Global Search. The alert
layer already exists in the layer manager and already sorts above `main` and `global`; a dialog
rendered there is above every preview surface by construction, including the out-of-process Chromium
PDF viewer.

## One view, a dialog stack

The alert layer holds **one** view — the layer manager refuses a second occupant — so the error
dialog is not a second view. It is a second dialog *inside* the alert renderer, painted above the
dialog that raised it:

```text
alert WebContentsView  (transparent, covers the window content rect)
├─ scrim            rgba(0,0,0,.28) — click does NOT dismiss (see Dismissal)
├─ dialog  z 10     new-folder | delete-confirm
└─ error   z 20     always above the dialog that raised it
```

「z-index 更高」is therefore literal CSS inside one renderer, which is also what makes the error
dialog reusable: it does not need a view, a window, or a layer of its own.

## Lifecycle

Same contract as Global Search, for the same reason the owner gave then — 「打开一个渲染进程是比较慢的」:

| moment | action |
| --- | --- |
| OnlyPreview window opens | the alert view is created and loaded, hidden |
| a dialog is requested | the view is shown in the `alert` layer and the layer order is re-sorted |
| the last dialog closes | the view is hidden; the renderer keeps its process |
| OnlyPreview window closes | the view is destroyed |

A dialog request that arrives before the renderer reports ready is queued, not dropped. The
alert renderer pulls the current dialog state on mount rather than relying on a broadcast it may
have missed, matching the fix already made for the project-index state.

## Dialogs

### New Folder

Replaces the in-tree edit row for **creation**. Rename keeps its in-place edit row
([onlypreview-folder-authoring](onlypreview-folder-authoring.md)): renaming is an edit of a row that
already exists, and the row is the natural place for it.

```text
┌──────────────────────────────────────────────┐
│  New Folder                                  │
│  in “docs”                                   │
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │ untitled folder                        │  │   ← focused, text selected
│  └────────────────────────────────────────┘  │
│                                              │
│                        [ Cancel ]  [  OK  ]  │
└──────────────────────────────────────────────┘
```

- The input is focused with its text selected the moment the dialog paints, so typing replaces the
  prefill and **Enter** alone creates `untitled folder`.
- The prefill is always `untitled folder`. Confirming it **untouched** runs the existing untitled
  sequence (`untitled folder`, `untitled folder 2`, …) at commit time, so Enter always creates
  something; a name the owner actually typed is created verbatim and its collision is reported.
  Silently creating `untitled folder 2` instead of what was typed would be worse than a conflict,
  and probing for a free name before the dialog opens would need a new read path in the hidden
  authority for a prefill.
- `in “<folder>”` names the destination, because New Folder is reachable from a folder row **and**
  from the Project root menu; without it the two are indistinguishable.
- **Enter** or `OK` commits. **Esc** or `Cancel` closes with no syscall.
- `OK` is disabled while the trimmed name is empty or fails `validateOnlyPreviewEntryName`, and one
  message appears under the input rather than in an error dialog — an invalid character is a typing
  state, not a failure. Nothing is said while the field is empty, which is a starting state.

The owner asked for 「确定和保存 按钮」. Read as one commit action plus the cancel affordance every
dialog needs: the commit button is `OK` / `确定`, which is the one the owner then referred to
(「点击确定或回车保存」). There is no second commit button — two would mean the same thing.

### Error

Generic, and every string is supplied by the caller: 「标题 内容 确定按钮文案都能制定」.

```text
┌───────────────────────────────────────────────┐
│  Name already in use                          │
│                                               │
│  “Design Notes” already exists in “docs”.     │
│  Enter a different name.                      │
│                                               │
│                                     [  OK  ]  │
└───────────────────────────────────────────────┘
```

```text
┌───────────────────────────────────────────────┐
│  名称已被占用                                   │
│                                               │
│  “docs”中已存在“Design Notes”。                 │
│  请输入其他名称。                                │
│                                               │
│                                      [ 确定 ]  │
└───────────────────────────────────────────────┘
```

- **Enter**, **Esc**, and clicking the confirm button all close it — the owner's rule, and correct:
  a single-button dialog has one outcome, so every dismissal gesture should reach it.
- Closing it returns focus to whatever raised it. For the duplicate-folder case that is the New
  Folder input, **with the rejected name still there and selected**, so the next keystroke replaces
  it. This is the part that matters: an error dialog that drops the typed name makes the owner
  retype it.
- The caller supplies `title`, `message`, and `confirmLabel`. `confirmLabel` defaults to the
  localized `OK`, so a caller that only has something to say does not have to invent a button.
- The message is plain text, never HTML, and never an absolute path — the same disclosure rule the
  rest of OnlyPreview follows.

### Delete confirmation

```text
one file
┌──────────────────────────────────────────────────────┐
│  Delete “report.pdf”?                                │
│                                                      │
│  It will be removed from disk immediately.           │
│  This cannot be undone.                              │
│                                                      │
│                              [ Cancel ]  [ Delete ]  │
└──────────────────────────────────────────────────────┘

one folder
│  Delete “docs” and everything inside it?             │

four rows, collapsed to three entries
┌──────────────────────────────────────────────────────┐
│  Delete 3 items?                                     │
│                                                      │
│  docs                                    folder      │
│  notes/2026-09.md                                    │
│  assets/logo.png                                     │
│                                                      │
│  They will be removed from disk immediately.         │
│  This cannot be undone.                              │
│                              [ Cancel ]  [ Delete ]  │
└──────────────────────────────────────────────────────┘
```

- The list shows the **collapsed** plan (see below), project-relative, with `folder` marked, capped
  at 10 rows followed by `…and N more`. The owner should see what will actually be removed, not what
  was clicked.
- `Cancel` holds the initial focus and **Enter** activates it; **⌘⏎ / Ctrl+⏎** confirms, and the
  Delete button shows that hint. A recursive permanent delete is the one action in OnlyPreview with
  no undo, so the default gesture is the safe one. If the owner would rather have Enter delete, this
  is a one-line change.
- **Esc** or `Cancel` closes with no syscall and leaves the selection intact.

## Dismissal

Clicking the scrim does **not** dismiss. Both dialogs carry text the owner typed or a destructive
choice, and a stray click on a full-window scrim is too easy. Esc is the dismissal gesture, and it is
in the button row.

## Refactor of the existing New Folder path

| today | after |
| --- | --- |
| Main allocates the untitled name, preload `mkdir`s it, the row appears in edit mode | the dialog collects the name first, then one preload `mkdir` |
| a duplicate name raises a **native** Main dialog and the row reverts | the error dialog opens above the New Folder dialog and the input keeps the name |
| an empty tree offers no visible creation affordance | unchanged — the affordance stays the context menu |

The folder is no longer created before it is named, which removes a real failure mode: cancelling the
old flow left an `untitled folder` on disk.

## Delivery

[onlypreview-alert-dialogs-120](../plan/tasks/onlypreview-alert-dialogs-120.md).
