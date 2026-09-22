# 再按一次 Cmd+F 只聚焦、不全选

Status: implemented; owner testing pending.

Ral 2026-09-22:「cmd+f 文件内搜索的时候,如果是已经打开过搜索框的话,再次点击 CMD+F 应该聚焦
并全选搜索文字」。

## 现状与期望

文件内搜索框已经打开时再按 Cmd+F,只把光标放回输入框,不选中已有的词。于是要换一个词还得先自己
把旧词选掉 —— 而人再按一次 Cmd+F 的意图,几乎总是"换个词再搜"。

同一个 shell 里的 Global Search(Cmd+Shift+F)本来就是 focus + select
(`GlobalSearchWorkspace.vue`)。两个搜索框在同一个界面上行为不一致,本身就是缺陷。

## 两条路都要改

`PreviewToolbar.vue` 用的是 `<FindBar v-if="onlyPreviewFindStore.open" />`,所以:

| 情形 | 走哪条 |
| --- | --- |
| 关掉之后重新打开 | 重新挂载 → `onMounted` |
| 已经开着,再按一次 Cmd+F | `focusRevision`(`handleFocusRequest` 只在 `open` 已为真时递增它) |

两种情形下人要做的事一样,所以两条路合并成同一个 `focusAndSelect()`。

## 改动

`FindBar.vue`:`onMounted(() => inputRef.value?.focus())` 与 focusRevision 的 watcher 都改走
`focusAndSelect()`,即 `focus()` 之后补一个 `select()`。`inputRef` 本来就是原生
`HTMLInputElement`(与 Global Search 同类型),`select()` 无需任何适配。

空输入框上 `select()` 是空操作,所以第一次打开(没有历史词)的行为不变。

## 守卫

`tests/onlypreview/onlyPreviewFindRenderer.test.mjs`:两个搜索框都必须 focus + select;
FindBar 的挂载与再次唤起必须走同一段;`handleFocusRequest` 只在已打开时递增 focusRevision。
