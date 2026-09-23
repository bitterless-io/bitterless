# 网页右键菜单在链接/图片上仍然带着 Back、Forward、Reload

Status: fixed; owner verification pending (2026-09-23)

## Report

Ral 2026-09-23（附截图：在 YouTube 页面右击一张缩略图，菜单从上到下是
Back / Forward(灰) / Reload ── Open link in new tab / Copy link address ──
Open image in new tab / Save image as… / Copy image / Copy image address）：

> 按理 可以 open in new tab 的时候不该显示 back 和 reload forward，要参考 chrome 的网页中右击的
> 逻辑，但是要和 mini APP 做区分。

## Confirmed cause

`showPageMenu()` 把导航段写成了 `sections` 的**第一个元素，无条件**：

```ts
const sections: MenuItemConstructorOptions[][] = [
  [ Back, Forward, Reload ]      // ← 永远在，后面只往下追加目标段
]
if (params.linkURL) sections.push([...])
if (params.mediaType === 'image') sections.push([...])
```

Chrome 的规矩不是这样。Chrome 的网页右键菜单是**按右击落点分派**的，导航段只属于「页面」这一种
落点：

| 右击落在 | Chrome 给的 | 有没有 Back/Forward/Reload |
| --- | --- | --- |
| 空白页面 | Back / Forward / Reload / Save as… / Print… / View source | **有** |
| 链接 | Open link in new tab / new window / Save link as… / Copy link address | 没有 |
| 图片 | Open image in new tab / Save image as… / Copy image / Copy image address | 没有 |
| 选中文字 | Copy / Search for “…” / Print | 没有 |
| 输入框 | Undo / Cut / Copy / Paste / Select all | 没有 |

链接里套图片时两段都给，导航仍然没有。截图里那一发正是「链接 ＋ 图片」。

## Fix

先把目标段收进 `targetSections`，再决定导航段出不出现：

```ts
const targetSections = []            // link / image / editable / selection
…
const sections = []
if (!targetSections.length) {
  sections.push(historyLocked ? [Reload] : [Back, Forward, Reload])
}
sections.push(...targetSections)
```

两个判断都写在这里，理由各自独立：

1. **判据取「我们有没有给出目标段」，而不是逐个去问 `params` 的字段。** 在链接/图片/选区/输入框上
   两者是同一件事；区别在**我们还没有实现条目的那些落点**（`video` / `audio` / `canvas`）：按字段
   判会得到一个**空菜单**，按段判则退回页面菜单 —— 与今天的行为一致。补齐媒体条目是另一件事，
   不在这一改里。
2. **mini app 与网页分开**（Ral 同一句「但是要和 mini APP 做区分」）：mini app 不是网页，没有可回退
   的浏览历史，`historyLocked` 让 Back / Forward 在它身上**永远是灰的** —— 与其摆两个点不动的条目，
   不如不给。Reload 对它仍然成立，所以留着。

## Verification

- 守卫（两仓各一份，同一条规则）：导航段必须在 `!targetSections.length` 闸之内；
  `historyLocked` 那一支**不含** Back/Forward 且**含** Reload；四个目标段都进 `targetSections`
  且最终仍展开进菜单。少任何一条都会红。
- typecheck 通过（两仓）。
- **未跑 Electron / E2E**，按 root CLAUDE.md。人工验收：在网页上分别右击空白处、链接、图片、
  选中文字、输入框，只有空白处那一次带导航；在 mini app 的 tab 上右击空白处，只有 Reload。

## 已知差距（**未改**）

Chrome 在链接上还有 Open link in new window / Save link as…，在视频/音频上有整组媒体条目，
在页面上还有 Save as… / Print / View page source。我们目前都没有。这次只改分段规则，不扩条目。
