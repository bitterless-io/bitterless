import type { BrowserWindow, WebContents } from 'electron'

/**
 * 窗口重新激活时,把原生焦点还给**刚才真正持有它的那个 view**。
 *
 * 缺陷(Ral 2026-09-22):「浏览器主窗口处于 web 内容 tab 时,失焦再聚焦会导致输入框直接被聚焦」。
 * 他给的复现前提正好是判据:**先点网页内容**再切走再切回来才触发;只点过 tab(焦点在 chrome)
 * 切走切回来不触发。
 *
 * 成因:一扇窗里有好几个 `WebContentsView`,但 macOS 重新激活窗口时 first responder 回到的是
 * **窗口自己的** web view(也就是 chrome 这一份文档),而不是刚才持有焦点的那个子 view。chrome
 * 这份文档的 `document.activeElement` 一直停在地址栏 `<input>` 上 —— 它在某次
 * `focusAddressBarForBlankTab()` 或一次手动输入之后就没再被 DOM-blur 过,原生焦点转给操作区时也
 * 不会清掉它 —— 于是窗口一激活,那个 activeElement 就"活"了回来:光标闪在地址栏里,而人以为
 * 自己还在网页上。
 *
 * 修法是把焦点**还回去**,不是把地址栏的焦点掐掉:掐掉之后焦点落在 chrome 的 body 上,打字哪儿
 * 都不去,比现在更糟。Chrome 的行为也是"切回来还在网页上"。
 *
 * 判据只认「失焦那一刻内容区真的持有焦点」。人主动点进地址栏再切走的那一路,失焦时持焦的是
 * chrome 而不是内容区,所以这里什么都不做,半截 URL 和光标原样留着。
 */
export const attachContentFocusRestore = (
  win: BrowserWindow,
  /** 当前 tab 的内容 webContents。composite mini-app tab 没有,返回 null —— 那时不介入。 */
  contentAtFront: () => WebContents | null
): void => {
  let restore = false

  win.on('blur', () => {
    const contents = contentAtFront()
    // 窗口失活**不会**改 first responder,所以这一刻 `isFocused()` 读到的仍然是"谁持有焦点"。
    restore = Boolean(contents && !contents.isDestroyed() && contents.isFocused())
  })

  win.on('focus', () => {
    if (!restore) return
    restore = false
    const contents = contentAtFront()
    // 切走期间换过 tab / 关过 tab:那时该由那条路径决定焦点,这里不追着抢。
    if (!contents || contents.isDestroyed() || contents.isFocused()) return
    contents.focus()
  })
}
