import { BrowserWindow, app, webContents } from 'electron'
import type { WebContents } from 'electron'
import { dispatchApplicationFindCommand, registerWindowCloseShortcut } from '@main/menu/applicationFindMenu.service'

export interface ShortcutActions {
  newTab: () => void
  closeActiveTab: () => void
  searchSessions: () => boolean
  /**
   * Is the Maestro window the focused one right now?
   *
   * This is the ONLY test for whether the tab chords apply — see the module comment. It is asked per
   * keystroke because focus moves, and answered by the window's owner rather than here so this
   * module keeps no handle on `maestroWindowHelper`.
   */
  ownsFocusedWindow: () => boolean
}

/**
 * Cmd+T / Cmd+W / Cmd+F for the Maestro window.
 *
 * **The claim is a property of the WINDOW, not of the view.** `Cmd+W` means "close the active tab"
 * exactly when the focused window is the one that HAS tabs; in every other window it is not ours and
 * must reach the application menu's inherited `fileMenu` `close` role, which closes that window.
 *
 * That sentence is the whole design, and it replaced a per-view registry (a session/partition test
 * plus an `enrollMaestroShortcutContents` allowlist) that had to be remembered by every surface that
 * renders inside the Maestro window. Forgetting it was silent and the symptom was severe — the key
 * fell through and took the WHOLE window down instead of one tab:
 *
 *  - OnlyPreview's composite views, three separate entries (Ral 2026-09-11);
 *  - the Zellij mini app's chrome, missed by that same round
 *    (`docs/issues/maestro-zellij-chrome-cmd-w-closes-window.md`, Ral 2026-09-18).
 *
 * A registry cannot be complete by construction, and neither miss was visible to typecheck, to
 * review, or to any test — the enrolled surfaces kept working. Asking "is the Maestro window
 * focused?" needs nothing registered, so a new view inside it is correct the moment it exists. This
 * is `micromeet-cowork`'s arbitration (`apps/cowork/src/main/common/shortcutsHelper/shortcuts.helper.ts`),
 * minus its menu ownership: Bitterless keeps the host application menu, and its terminal proves it
 * still receives Cmd+W through `setIgnoreMenuShortcuts(true)`.
 *
 * Two explicit exceptions remain, and they are behaviours rather than permissions:
 * `terminalKeyboardOwners` (the view wants the key itself) and `windowCloseGuards` (the key must do
 * nothing at all).
 */
const shortcutContents = new WeakSet<WebContents>()
const shortcutDedupeMs = 120
const lastShortcutAt = new Map<string, number>()
let activated = false

/**
 * Views that want Cmd+W themselves — the Zellij terminal, where it closes a PANE.
 *
 * Not a permission: this one takes Cmd+W AWAY from the tab chords for the view that registers it.
 */
const terminalKeyboardOwners = new WeakSet<WebContents>()
export const setTerminalKeyboardOwner = (contents: WebContents): void => {
  terminalKeyboardOwners.add(contents)
}

/**
 * Views where Cmd+W must do NOTHING — Omni cells (Ral 2026-09-11).
 *
 * Omni is its own window with no tabs, so neither branch of the rule above fits it: closing the
 * active Maestro tab is wrong (that is a different window) and closing the Omni window is what Ral
 * asked NOT to happen. "Do nothing" is therefore a third, explicit answer, and it has to be stated
 * somewhere — silence is what produced the original bug.
 */
const windowCloseGuards = new WeakSet<WebContents>()
export const guardWindowCloseShortcut = (contents: WebContents): void => {
  windowCloseGuards.add(contents)
}

/**
 * 同一个键在同一个瞬间只算一次。
 *
 * 菜单项与 `before-input-event` **都可能**到达(菜单项拥有加速键,但持焦的 view 仍会收到按键),
 * 两条路共用这一个窗口,所以一次 Cmd+W 关不掉两个 tab。
 */
const claimShortcut = (key: string): boolean => {
  const now = Date.now()
  const last = lastShortcutAt.get(key) || 0
  if (now - last < shortcutDedupeMs) return false
  lastShortcutAt.set(key, now)
  return true
}

/** 当前持有键盘焦点的 view;没有任何 view 持焦时退回窗口自己的页面。 */
const focusedContentsOf = (window: BrowserWindow): WebContents => {
  const focused = webContents.getFocusedWebContents()
  return focused && !focused.isDestroyed() ? focused : window.webContents
}

// 终端自己要这个键:原样转投过去,由它的页面处理器决定怎么编码(不在这里翻译成字节序列)。
const forwardCloseToTerminal = (contents: WebContents): void => {
  contents.sendInputEvent({ type: 'keyDown', keyCode: 'w', modifiers: ['meta'] })
  contents.sendInputEvent({ type: 'keyUp', keyCode: 'w', modifiers: ['meta'] })
}

let installedActions: ShortcutActions | null = null

/**
 * 菜单项 `File ▸ Close` 的落点 —— **Cmd+W 的最后仲裁者**。
 *
 * 为什么必须有这一条:`before-input-event` 只在**某个 webContents 持有键盘焦点**时才触发,而这套 UI
 * 自己会造出「谁都不持焦」的空档 —— 历史下拉的 `accept` 分支摘掉持焦的 view 却不恢复焦点,
 * `activateTab` 里 `previous.view.setVisible(false)` 又「把焦点丢掉」,焦点要等到
 * `focusAddressBarForBlankTab()` 才回来。键落在那个空档里就直达菜单,而菜单继承的
 * `role: 'close'` 关的是整扇窗(Ral 2026-09-23,
 * docs/issues/cmd-w-falls-through-to-the-menu-when-focus-is-nowhere.md)。
 *
 * 下面四条判据**一条都不问「有没有人持焦」**,所以那个空档不再是漏洞。次序是判据本身:
 * 守卫要在终端之前(Omni cell 里什么都不该发生),终端要在本窗之前(它把键要走了)。
 */
export const dispatchWindowCloseShortcut = (): void => {
  const window = BrowserWindow.getFocusedWindow()
  const actions = installedActions
  if (!window || window.isDestroyed() || !actions) return
  const contents = focusedContentsOf(window)
  if (windowCloseGuards.has(contents)) return
  if (terminalKeyboardOwners.has(contents)) {
    forwardCloseToTerminal(contents)
    return
  }
  if (!claimShortcut('w')) return
  // 有 tab 的那扇窗关 tab;其余每一扇窗关窗口 —— 这正是原来 `role: 'close'` 的行为,一字不差。
  if (actions.ownsFocusedWindow()) actions.closeActiveTab()
  else window.close()
}

const runShortcut = (key: string, actions: ShortcutActions, contents: WebContents): boolean => {
  // Find is already window-resolved by its own dispatchers (`dispatchApplicationFindCommand` picks
  // the foreground owner, and `searchSessions` refuses unless the Maestro window is focused), so it
  // needs no test here.
  if (key === 'f') return dispatchApplicationFindCommand('find-in-file') || actions.searchSessions()
  if (key !== 't' && key !== 'w') return false
  // Swallowed, but still `true` so the caller preventDefaults — that is what keeps it off the menu's
  // window-close role.
  if (windowCloseGuards.has(contents)) return true
  // Not the tabbed window ⇒ not our key. Returning false (no preventDefault) is the POINT: the menu
  // then closes that window, which is what every other window wants.
  if (!actions.ownsFocusedWindow()) return false
  // 去重与菜单项那一路共用 —— 见 `claimShortcut`。已经被算过的那一次仍然 `true`,
  // 因为这一下必须被 preventDefault 掉,否则它会再落到菜单上。
  if (!claimShortcut(key)) return true
  if (key === 't') actions.newTab()
  else actions.closeActiveTab()
  return true
}

// Installed on EVERY WebContents — see the module comment. What a view is allowed to do is decided
// per keystroke, so there is nothing to register and nothing to forget.
const installShortcutsForWebContents = (contents: WebContents, actions: ShortcutActions): void => {
  if (shortcutContents.has(contents)) return
  shortcutContents.add(contents)
  contents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || input.isComposing) return
    const mod = process.platform === 'darwin' ? input.meta : input.control
    if (!mod || input.alt || input.shift) return
    // A terminal owns Cmd+W outright: let the key through untouched so its own handler closes a
    // pane. Cmd+T is still ours — the terminal has no use for it.
    const key = String(input.key || '').toLowerCase()
    if (key === 'f' && event.defaultPrevented) return
    if (key === 'f' && input.isAutoRepeat) { event.preventDefault(); return }
    if (key === 'w' && terminalKeyboardOwners.has(contents)) return
    if (runShortcut(key, actions, contents)) event.preventDefault()
  })
}

// Bitterless retains the application menu and Cmd/Ctrl+Q.
export const activateShortcuts = (actions: ShortcutActions): void => {
  if (activated) return
  activated = true
  // 菜单项的 click 只有一个入口,没有参数可传,所以它从这里取 actions。
  installedActions = actions
  registerWindowCloseShortcut(dispatchWindowCloseShortcut)
  app.on('web-contents-created', (_event, contents) => installShortcutsForWebContents(contents, actions))
  for (const contents of webContents.getAllWebContents()) installShortcutsForWebContents(contents, actions)
}
