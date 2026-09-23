# 聊天里的文件链接 —— 右键菜单 · Copy path

**状态:** ✅ **已实现**(2026-09-23),两仓齐;守卫 `check:chat-file-link`(bl)。**来源:** Ral 2026-09-23,对文件链接提了四条期望:

> 点击 DECISIONS.md,应该是以链接的形式渲染,且不包含括号后面的 URL。
> 悬浮时,可以展示它完整的路径;点击之后,直接进入 Only Preview 中预览。
> 右击有菜单,可以 copy path。

前三条已在 [`micromeet-cowork/docs/issues/file-link-with-space-is-not-a-link.md`](../../../micromeet-cowork/docs/issues/file-link-with-space-is-not-a-link.md)(那条缺陷是 cowork 独有的,bl 的 `mdDirLink` 用 `encodeURIComponent` 逐段编码,实测不受影响)
修完(链接根本没解析 → 顺带三条都不成立)。**本文只做第四条。**

## 0 · 现状

聊天正文里的文件链接**没有任何右键菜单**。右击落到 Electron 的默认行为上,什么也不给。
应用里已有的菜单只有会话列表那一个(`SessionContextMenu.vue`),形状可以照搬:
`Teleport` 到 body · 覆盖层点击关闭 · 方向键导航 · Esc 关闭 · 关闭后焦点归位 · 无边框。

## 1 · 行为

| | |
|---|---|
| 触发 | 在正文的 `<a>` 上右击。**不是**整个气泡 —— 在普通文字上右击要留给浏览器的默认菜单 |
| 菜单项 | **Copy path** 一项。够用就好,不预先塞"在访达中显示"之类没人要的条目 |
| 复制什么 | **解码后的真实路径**(`/…/Trial 1 NPG/…`),不是 href 里那串 `Trial%201%20NPG` |
| 反馈 | 复制成功给一条轻提示;失败要说出来 |
| 非文件链接 | http(s)、`micromeet://`、`file:line` 引用一律不接管,右击照旧 |

## 2 · 两个必须做对的地方

**① 复制走 main,不走渲染端。** 打包后 renderer 跑在 `file://`,`navigator.clipboard` 在这个
来源下不可靠 —— 本仓既有的剪贴板操作全在 main(`browser.controller.ts`、
`coworkAgent.service.ts` 用 electron 的 `clipboard`),会话菜单的 `copySessionPath` 也是。
**照这条走,不要在组件里直接调 `navigator.clipboard`。**

**② 路径要解码后再复制。** 链接的 href 是转义过的(`%20`/`%28`),直接复制出去粘到终端里是错的。
用 `decodeFileHref`(`@shared/replyFileLink`)—— 它正是这份编码的另一半,不要在这里重写一遍,
那正是那个文件的注释警告过的"两半分开住就会悄悄漂移"。

## 3 · 无边框

按工作区的 *Borderless UI*:菜单靠**背景 + 圆角 + 阴影**成形,不画边框;选中态靠背景色。
照 `SessionContextMenu` 现有的样子,不要新造一套。

## 4 · 落点

| | `micromeet-cowork` | `bitterless` |
|---|---|---|
| 菜单组件 | `renderer/control/src/` 新增 | `renderer/maestro/control/src/` 新增 |
| 挂载 | `ControlApp.vue`(`SessionContextMenu` 旁) | 对应的 App 组件 |
| 右击委托 | `MessageItem.vue` 的 markdown 容器 | 同名文件 |
| 解码 | `@shared/replyFileLink` 的 `decodeFileHref` | bl 没有这个共享件,用它自己的 `localPathFromHref` |
| 文案 | `i18n/control/messages.ts` | `i18n/{en,zh}.ts` |

## 5 · 配对时发现的两处分歧(**已按「以 cowork 交互为准」修掉**)

查 bl 的同一条路时撞见两件与 cowork 不一致的事,都不是本功能引入的。Ral 2026-09-23
裁定「以 cowork 交互为准」,已于同日修完 —— 见
`bitterless/docs/issues/chat-file-link-opens-finder.md`,守卫 `check:chat-file-link`。

1. **bl 的单击去的是访达,不是 OnlyPreview。** `MessageItem.vue` 调 `showFileInFolder`;
   cowork 走 `openWorkspaceInPreview`。而 `docs/INDEX.md` 里
   `features/cowork-reply-file-links.md` 那条写着这次改动「**synced to bitterless**」(2026-09-08)。
   **文档说同步过,代码说没有。** ✅ 已改为 `previewLocalFile → openWorkspaceInPreview`,
   并把行为本身钉进守卫 —— 一句写在 INDEX 里的 "synced to X" 不会在 X 回退时变红。
2. **bl 的链接没有 title**,悬浮显示不了可读全路径。✅ `mdDirLink` 已补 title(`"` / `\` 转义)。

bl 的 `mdDirLink` 用 `encodeURIComponent` 逐段编码,**空格那条缺陷它没有**(实测四种刁钻路径
都正常渲染成链接),所以按配对规则「A defect already absent in the other project needs
verification, not an artificial code change」没做任何为了对齐的改动。
