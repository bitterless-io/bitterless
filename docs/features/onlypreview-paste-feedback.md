# OnlyPreview paste feedback — where a conflict is reported, and how a pasted file is found

Status: proposed. Owner request, 2026-09-18 (screenshot of the inline banner attached to the ask):

> 1. 优化粘贴文件 UI，粘贴一个已经存在的内容的时候不要这种 UI 提示，应该通过 alertview 提示，并配关闭按钮
> 2. 将文件粘贴到目录下要自动滚动到该文件上
> 3. 然后背景色闪烁一下：无背景色-变蓝-变成无背景色，但是不用打开预览哦

Applies to **both** BL and micromeet-cowork (paired development); the shell is vendored.

## 1 — a name conflict belongs in the alert layer, not the Project rail

Today `OnlyPreviewProjectPasteController.paste()` ends its catch with

```ts
if (this.host.workspace === workspace) this.host.errorMessage = this.errorMessage(error);
```

which paints the shared Project error banner — the pink strip with the Copy-detail button. For a
`NAME_EXISTS` conflict that is the wrong surface twice over: it is the banner reserved for *index and
runtime* failures, so a routine "this name is taken" competes with real breakage, and it carries the
Copy-detail affordance, which invites the owner to report a non-bug.

A paste conflict is an ordinary, expected outcome of a deliberate action, and the alert layer already
exists for exactly that class — it is what New Folder uses for the same `NAME_EXISTS`. Route it
there, with the dialog's existing confirm/close button, which already dismisses on Enter, Esc and
click.

- The alert layer is reachable from the renderer today through `showNotice`, which is
  `showError(tone: 'notice')` in Main. A conflict is an error, not a notice, so
  `OnlyPreviewNoticeRequest` gains an optional `tone` and the paste path passes `'error'`. No new
  API method: the two would differ by one field.
- Only the **conflict** moves. A paste that fails for a workspace/permission/IO reason stays on the
  banner, because that is genuine breakage and the Copy-detail button is the right affordance for it.

## 2 and 3 — find the pasted file without opening it

`revealCreatedEntries` is what paste currently calls, and it sets three things:

```ts
this.host.treeSelectedRelativePath = entry.relativePath;
this.host.selectedRelativePath = entry.relativePath;   // <- this is the Preview selection
this.host.focusedRelativePath = entry.relativePath;
```

`selectedRelativePath` is the previewed file. Setting it is why a paste opens the preview, which the
owner does not want. New Folder wants that behaviour and keeps it; paste needs a variant that stops
short of it.

Required behaviour for paste:

1. Expand the ancestors so the row exists (unchanged).
2. Set the tree selection and focus — **not** `selectedRelativePath`. The preview keeps showing
   whatever it was showing.
3. Scroll the row into view. `focusTreePath(relativePath, true)` in `App.vue` already does exactly
   this (`scrollIntoView({ block: 'center' })`) and is used by Locate; reuse it rather than writing a
   second scroller.
4. Flash the row background once: no background -> blue -> no background.

### The flash

One CSS animation on the row, triggered by a short-lived class, self-clearing so a second paste
re-triggers it:

```text
0%    transparent
35%   Royal-soft blue
100%  transparent          ~900ms, ease-in-out, runs once
```

- The blue is the existing selection blue token, not a new colour.
- It must not fight the real selection background: the flash sits on a modifier that animates
  `background-color` and is removed when it ends, so a selected row returns to its selected surface
  and an unselected row returns to transparent.
- `prefers-reduced-motion: reduce` disables it, matching the shell's existing block for the index
  progress bar and the chevron. Under reduced motion the row is still scrolled to and still selected
  in the tree, so nothing is lost but the animation.
- Pasting several files flashes each pasted row that is present, not only the first.

## Verification

- Renderer source guards: paste's catch no longer writes `errorMessage` for a conflict; the paste
  reveal does not assign `selectedRelativePath`; the flash class is applied and cleared.
- The alert request for a conflict carries `tone: 'error'` and the localized `NAME_EXISTS` sentence,
  in both catalogs.
- Compiled-CSS guard for the keyframes and the reduced-motion opt-out, in the stylesheet the shell
  actually loads — the same discipline the search-panel shadow guard uses, because a rule in a
  stylesheet that surface does not load is inert and source text cannot see that.
- No Electron/E2E.
