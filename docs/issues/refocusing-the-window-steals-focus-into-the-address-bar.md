# Refocusing the window steals focus into the address bar

Status: fixed; owner verification pending (2026-09-22)

## Report

Ral 2026-09-22:「浏览器主窗口处于 web 内容 tab 时，失焦再聚焦会导致输入框直接被聚焦，这个是不
应该的。只有点击操作的时候才会聚焦。」

复现前提（Ral 追问后给出，这也是判据）：**先聚焦网页内容**，再切走、再切回来 → 地址栏里有光标、
可以直接打字；只点过 tab（焦点在 chrome）再切走切回来 → 不触发。

## Confirmed cause

一扇窗里有好几个 `WebContentsView`（chrome 是窗口自己的 webContents，网页在操作区那个子 view
里）。macOS 重新激活窗口时，first responder 回到的是**窗口自己的** web view，而不是刚才持有焦点
的那个子 view。

而 chrome 这份文档的 `document.activeElement` 一直停在地址栏 `<input>` 上 —— 它在某一次
「打开空白 tab → 地址栏自动聚焦并全选」或一次手动输入之后就再没被 DOM-blur 过，**原生焦点转交给
操作区并不会清掉它**。于是窗口一激活，那个 activeElement 就被唤醒：光标闪在地址栏，而操作者以为
自己还停在网页上。

Ral 给的两条前提正好把这条链条钉死：焦点在 chrome 时失焦再聚焦，first responder 本来就该回到
chrome，没有任何错位，所以不触发。

## Fix

`contentFocusRestore.service.ts`（新）：记住**失焦那一刻内容区是否真的持有原生焦点**，是则在窗口
重新激活时把焦点还给它。

- 还回去，而不是把地址栏的焦点掐掉：掐掉之后焦点落在 chrome 的 `body` 上，打字哪儿都不去，比现在
  更糟。Chrome 的行为也是「切回来还在网页上」。
- 判据只认「失焦那一刻内容区持有焦点」。人主动点进地址栏再切走的那一路，失焦时持焦的是 chrome，
  这里什么都不做 —— 敲了一半的 URL 和光标原样留着。
- composite mini-app tab 没有内容 `WebContentsView`（返回 `null`），不介入：它自己的焦点归它自己
  的 mount 管。
- 切走期间换过 / 关过 tab 也不追着抢：那时该由那条路径决定焦点。

窗口失活**不会**改 first responder，所以 `blur` 事件里读 `webContents.isFocused()` 读到的仍然是
「谁持有焦点」（Electron 的 `IsFocused()` 落到 `RenderWidgetHostView::HasFocus()`，与窗口是不是
key 无关）。

## Verification

- 单测（判据表）：还焦点只发生在「内容区持焦 → 失焦 → 再聚焦」这一路；chrome 持焦那一路零动作；
  一次失活只还一次；tab 关掉 / 换成 composite / 已经持焦时都不动。
- 人工（Ral）：点网页内容 → 切到别的应用 → 切回来 → 光标仍在网页，地址栏没有被聚焦。
