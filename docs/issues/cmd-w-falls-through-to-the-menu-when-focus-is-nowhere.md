# Cmd+W 在焦点交接的空档里落到菜单上,关掉了整扇窗

Status: fixed; owner verification pending (2026-09-23)

Related: [maestro-zellij-chrome-cmd-w-closes-window](./maestro-zellij-chrome-cmd-w-closes-window.md)
(同一个症状的第二轮,当时按「补一个 view 进名册」修)·
`micromeet-cowork` `src/main/common/shortcutsHelper/shortcuts.helper.ts`(**已经修对的那一半**)

## Report

Ral 2026-09-23:

> 当我创建一个新的 tab 并输入文字，然后通过选择一个历史记录打开一个 tab，接着快速打开一个新的
> tab，再点击 Command+W。结果关闭的是主窗口，而不是最新新建的那个 tab……一般来说，快速新建一个
> tab 都是直接能够通过 Command+W 关闭的。但是，如果我先通过搜索历史记录选择一个，然后再快速新建
> tab，再去 Command+W 关闭，此时就会触发关闭主窗口。这里应该存在时序状态上不同步的逻辑错误。

他的判断是对的,而且比「时序」更硬:**这条路本来就是一个竞态,只是平时赢的是我们。**

## Confirmed cause

Bitterless 的 Cmd+W 只走 `before-input-event`
(`src/main/maestro/common/shortcutsHelper/shortcuts.helper.ts`),而应用菜单用的是 Electron 默认的
`{ role: 'fileMenu' }`(`src/main/menu/applicationFindMenu.service.ts`),macOS 上那一项就是
**Close Window ⌘W**。

于是「关 tab」要成立,必须两件事同时为真:

1. 窗口里**有某个 webContents 持有键盘焦点** —— 否则 `before-input-event` 根本不会触发;
2. 它比 macOS 的原生窗口关闭键当量先拿到这个键。

第 1 条在这套 UI 里**会短暂不成立,而且是代码自己造成的**:

| 时刻 | 代码 | 焦点在哪 |
| --- | --- | --- |
| 历史下拉打开、用户在里面选了一条 | `maestroHistoryView.service.ts` `action()` 的 `accept` 分支**不恢复焦点** —— 只 `broadcast`,注释写着「Home accepts the identity before restoring focus」 | 历史 view |
| 紧接着 `hide()` → `detach()` | `view.setVisible(false)` ＋ `contentView.removeChildView(view)` | **持焦的那个 view 被摘掉了 —— 焦点落空** |
| 用户「快速」再开一个 tab | `newTab()` → `activateTab()`(其中 `previous.view.setVisible(false)` 那一行的注释原文:「把焦点丢掉」)→ **之后**才 `focusAddressBarForBlankTab()` 把焦点交回宿主页 | 这段 await 期间仍然落空 |
| 这一刻按下 Cmd+W | 没有任何 webContents 持焦 ⇒ 没有 `before-input-event` ⇒ 键直达应用菜单 | `role: 'close'` 关掉**焦点窗口 = 主窗** |

对照 `close` 那一支就更清楚:同一个 `action()` 里,`action === 'close'` 是**先
`win.webContents.focus()` 再 `hide()`**;`accept` 这一支没有。所以「先选历史、再快速开 tab」才会
触发,平时不会 —— 平时宿主页一直持焦。

这不是「漏了某个 view 没进名册」。名册那一轮(OnlyPreview 三处、Zellij chrome)修的是**持焦但没
注册**;这一次是**根本没有谁持焦**,再完整的名册也接不住。

## micromeet-cowork 早就修对了这一半

cowork 的同名文件里逐字写着病因:

> macOS consumes Cmd+W as the window's native close key equivalent **BEFORE the key reaches any
> WebContents** — which is why Cmd+T works through before-input-event and **Cmd+W used to close the
> window while the tab survived**. A menu item that OWNS the accelerator takes precedence over that
> native action, so tab close must live here.

cowork 因此把 `Command+W` 绑在**自己的菜单项**上(`Window ▸ 关闭标签页` → `runShortcut('w')`),
整份菜单里**没有任何 `role: 'close'`**。Bitterless 保留了宿主应用菜单,所以只拿到了
`before-input-event` 那一半,`fileMenu` 里的 Close Window 一直在当兜底。

## Fix

**让菜单项拥有这个快捷键,菜单成为最后的仲裁者** —— 与 cowork 同一条路,但保留 bl 的多窗口语义。

1. `applicationFindMenu.service.ts`:`{ role: 'fileMenu' }` 换成显式的 File 子菜单
   (macOS 上默认 `fileMenu` 的全部内容就是一个 `close`),其中 Close 项自带
   `accelerator: 'Command+W'`,`click` 交给下面这个仲裁。
2. `shortcuts.helper.ts` 新增 `dispatchWindowCloseShortcut()`,与 `before-input-event` **共用同一套
   判据和同一个去重窗口**(两条路都可能到达,去重保证不会关掉两个 tab):
   - 焦点 view 在 `windowCloseGuards` 里(Omni cell)→ 什么都不做;
   - 焦点 view 在 `terminalKeyboardOwners` 里(Zellij 终端)→ 把键转投给它(关 pane);
   - `ownsFocusedWindow()` 为真(Maestro 主窗)→ `closeActiveTab()`;
   - 其余窗口 → `focused.close()`,也就是原来 `role: 'close'` 的行为,一字不差。

关键点:这四条判据**一条都不依赖「有没有 webContents 持焦」**。焦点落空时菜单项照样触发,
于是那个空档不再是漏洞。

## Verification

- `tests/maestro/cmdWOwnsTheAccelerator.test.mjs`(新增):菜单模板里**不再有** `fileMenu` /
  `role: 'close'`,Close 项显式带 `Command+W` 且 click 走 `dispatchWindowCloseShortcut`;
  仲裁函数里四条判据齐全且顺序正确(guard → terminal → 本窗 → 其它窗)。
- `yarn build` / typecheck。
- **未跑 Electron / E2E**,按 root CLAUDE.md。人工验收就是 Ral 给的那一串:新建 tab → 输入文字 →
  选一条历史 → 快速再开一个 tab → Cmd+W,应当关掉最新那个 tab;另外在 Omni 窗、OnlyPreview 独立窗、
  Zellij 终端里各按一次,行为与今天一致。

## Scope —— 只改 bitterless,cowork 已核实不受影响

cowork 的菜单由 `shortcuts.helper.ts` 的 `installApplicationMenu()` 装,`Command+W` 绑在它自己的
`Window ▸ 关闭标签页` 上,整份模板里没有 `role: 'close'`。

它的树里确实也有一份 `src/main/menu/applicationFindMenu.service.ts`,里面同样写着
`{ role: 'fileMenu' }` —— 但**全仓没有任何地方调用 `installApplicationFindMenu()`**(从 bitterless
搬过去时带上的死代码)。所以那份模板从未被 `setApplicationMenu`,cowork 现在是对的。

**留给下一个人的坑**:哪天有人在 cowork 里调了 `installApplicationFindMenu()`,它会覆盖掉
`installApplicationMenu()` 装的菜单,`role: 'fileMenu'` 的 ⌘W 就回来了,这个缺陷原样重现。
要么删掉那份死代码,要么给它同样的 File 模板 —— 本次没动,因为那是 cowork 的清理,不是这条缺陷的修复。
