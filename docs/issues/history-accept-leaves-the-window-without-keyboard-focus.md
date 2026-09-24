# 选中一条历史记录之后,窗口里没有任何 webContents 持有键盘焦点

Status: fixed; owner verification pending (2026-09-24)

## 来路

这是 [⌘W 落到菜单上关掉整扇窗](./cmd-w-falls-through-to-the-menu-when-focus-is-nowhere.md) 的**另一半**。
那一条把症状堵住了(菜单项拥有 ⌘W,仲裁不再依赖有没有人持焦);这一条修的是**焦点为什么会落空**。

Ral 2026-09-23 给的复现前提本身就是证据:「先通过搜索历史记录选择一个,然后再快速新建 tab,
再去 Command+W」—— 必须**先选一条历史记录**才触发。

## Confirmed cause

历史下拉是一个独立的 `WebContentsView`。人在它里面点一行,**原生键盘焦点在它身上**。接受这条动作时:

| 步骤 | 代码 | 谁持焦 |
| --- | --- | --- |
| main 收到 `accept` / `choose` | 只 `broadcast`,**不恢复焦点** —— 注释写着「Home accepts the identity before restoring focus」(bitterless)/「The consumer restores address focus for **remove/retry**」(cowork) | 下拉 view |
| 渲染层处理完,`hide()` | `setVisible(false)` ＋ `removeChildView()` | **持焦的 view 被摘掉 → 落空** |
| 渲染层把地址栏拨回原值 | `restoreAddress()` | 仍然落空 |

同一个 `action()` 里的另外几条分支 —— `close`(main 侧 `win.webContents.focus()`)、`remove`、
`retry`、`toggle` —— **都**把焦点还了回去。**只有接受历史记录这一支漏了**,而它恰好是最常走的那条。

落空的后果有两个,一个显性一个隐性:

- 打字进不去地址栏 —— 看着有焦点环(DOM 焦点还在),键盘事件没有接收者;
- 窗口里没有任何 webContents 能收到 `before-input-event` —— ⌘W / ⌘T / ⌘F 全部静默失效,
  而 ⌘W 还会继续落到应用菜单上(bitterless 那侧因此关掉整扇窗)。

**只补渲染层的 `input.focus()` 是不够的。** 那只设 DOM 焦点;原生焦点在另一个 webContents 上,
它被摘掉之后不会自己回来 —— 得到的正是「焦点环画得出来、打字进不去」那个假象。
(同一类错误在 OnlyPreview 的重命名输入框上出现过。)

## Fix

两仓同形,三段:

1. **契约加一个 `focusHost()`**(`BrowserHistoryPopupApi` / `HistorySuggestionsApi`),
   main 侧实现就是 `win.webContents.focus()`。
2. **渲染层把「还焦点」写成一步**:先 `focusHost()` 要回原生焦点,再设 DOM 焦点,
   **两步都在压制标志之内**(bitterless 复用既有的 `focusSuppressed`;cowork 新增
   `historyFocusSuppressed`,`openHistory()` 读它)。压制是必要的:地址栏一拿到焦点就触发
   `@focus` → 重新打开下拉,那正是「刚选完一行、下拉又弹开」。
3. **接受历史记录那一支调用它**,与 `remove` / `retry` 一致。

**为什么不由 main 在 `action()` 里顺手做**:那会赶在渲染层处理完这次点击之前把焦点挪走,
于是下拉被重新弹开 —— 原注释里那句「otherwise focus can supersede this click」说的就是它。
渲染层知道自己什么时候做完,而且它是在压制之内调用的。

**Google 候选行那一支刻意不动**:它会让当前 tab 真的导航过去,原生焦点归操作区的 view,
窗口不会落空。

## Verification

- 守卫(两仓各一份):契约与 main 侧的 `focusHost()` 存在且确实 focus 宿主页;还焦点的顺序是
  「压制 → 原生 → DOM → 解压制」;接受历史记录那一支确实调用;cowork 另钉住 `openHistory()`
  读压制标志、组件不得绕过 store 直接 focus 输入框。bitterless 另钉住四个还焦点的调用点一个不少。
- typecheck 两仓通过;bitterless `yarn build` 通过。
- **未跑 Electron / E2E**,按 root CLAUDE.md。人工验收:地址栏输入 → 从下拉里选一条历史记录 →
  **直接打字**(应当进地址栏,而不是什么都不发生)→ 再按 ⌘T / ⌘W(应当开/关 tab)。
