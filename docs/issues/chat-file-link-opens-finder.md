# 聊天里的文件链接:单击去了访达,悬浮看不到路径 —— 与 cowork 不一致

**状态:** ✅ **已修**(2026-09-23),守卫 `check:chat-file-link`。
**来源:** Ral 2026-09-23:「1 做掉,以 cowork 交互为准」。
配对文档:[`features/chat-file-link-context-menu.md`](../features/chat-file-link-context-menu.md) §5,
两处分歧就是在做那件事时撞见的。

## 两处分歧

| | 本仓(修之前) | `micromeet-cowork` |
|---|---|---|
| 正文链接**单击** | `showFileInFolder` → 把人踢去访达 / 资源管理器 | `openWorkspaceInPreview` → 应用内 OnlyPreview |
| 链接**悬浮** | 只有目标本身(`Trial%201%20NPG`),看不到可读路径 | markdown title 带原样路径 |

## 第一条为什么值得单独记

cowork 在 2026-09-08 就把单击改成了应用内预览,而且它的 `docs/INDEX.md` 里那条明写着这次改动
**「synced to bitterless」**。本仓的代码却一直是 `showFileInFolder`。

> **文档说同步过,代码说没有。** 要么当时根本没同步,要么之后被回退了 —— 两种都没有留下痕迹。

这正是「同步过」这类断言必须由**闸**而不是由**文档**来担保的原因:一句写在 INDEX 里的
"synced to X" 不会在 X 回退时变红。所以这次补的守卫直接钉住行为本身
(`onMarkdownClick` 里必须是 `previewLocalFile`,且不许再出现 `showFileInFolder`),
而不是再写一句"已同步"。

## 修法

1. **单击走 `previewLocalFile` → `coach.openWorkspaceInPreview`。** 本仓早就有这条通路 ——
   `file:line` 引用的**双击**一直在用它,所以不是新增能力,只是正文链接没接上。
   失败沿用 `markMissing`,与 `showFileInFolder` 给人的反馈一致;静默 no-op 读起来就是
   "点了没反应"。
   **属于 Project 还是外部文件由 OnlyPreview 自己判**,渲染端不重算 —— 第二份判定只会漂移。
2. **`mdDirLink` 补 markdown title**,带可读路径。`"` 与 `\` 必须转义:一个裸 `"` 会提前
   闭合 title,**整条链接连目标一起解析失败**,等于用一类断链换掉另一类。

**没动的:** 产物条上的「在访达中显示」按钮 —— 那是另一个入口,人明确要文件在盘上的位置时
仍然该给他访达。守卫也钉住 `showFileInFolder` 继续存在。

## 本仓没有的那条缺陷

cowork 那边同一批还修了「路径带空格时链接根本不是链接」
(`micromeet-cowork/docs/issues/file-link-with-space-is-not-a-link.md`)。
**本仓不受影响** —— `mdDirLink` 用 `encodeURIComponent` 逐段编码,空格本来就成了 `%20`。
实测四种刁钻路径都正常渲染成链接,所以按配对规则不做任何"为了对齐"的改动。

## 验证

`yarn check:chat-file-link`。过真 `marked`:必须是 `<a>`、目标解得回原路径、可见文字恰好是
文件名、title 是可读全路径;再钉单击的去向。三条断电反验各自都能让它红:

| 拆掉什么 | 失败断言数 |
|---|---|
| title | 6 |
| title 的引号转义 | 1(带 `"` 的文件名直接不是链接) |
| 单击退回 `showFileInFolder` | 2 |
