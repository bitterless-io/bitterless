import { app, webContents } from 'electron'
import type { WebContents } from 'electron'
import { dispatchApplicationFindCommand } from '@main/menu/applicationFindMenu.service'

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
  const now = Date.now()
  const last = lastShortcutAt.get(key) || 0
  if (now - last < shortcutDedupeMs) return true
  lastShortcutAt.set(key, now)
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
  app.on('web-contents-created', (_event, contents) => installShortcutsForWebContents(contents, actions))
  for (const contents of webContents.getAllWebContents()) installShortcutsForWebContents(contents, actions)
}
