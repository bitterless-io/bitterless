import { app, session, webContents } from 'electron'
import type { WebContents } from 'electron'
import { MAESTRO_PARTITION } from '@maestro-main/data/maestroDataRoot'

export interface ShortcutActions {
  newTab: () => void
  closeActiveTab: () => void
  searchSessions: () => boolean
}

const shortcutContents = new WeakSet<WebContents>()
const shortcutDedupeMs = 120
const lastShortcutAt = new Map<string, number>()
let activated = false
// Enrollment can happen before or after `activateShortcuts`, so the actions are remembered rather
// than captured: a view enrolled first would otherwise get no binding at all.
let pendingActions: ShortcutActions | null = null

/**
 * Views that want Cmd+W themselves — the Zellij terminal, where it closes a PANE.
 *
 * Registering here is not the same as `enrollMaestroShortcutContents`: an enrolled view gets the
 * tab chords, this one takes Cmd+W away from them.
 */
const terminalKeyboardOwners = new WeakSet<WebContents>()
export const setTerminalKeyboardOwner = (contents: WebContents): void => {
  terminalKeyboardOwners.add(contents)
}

/**
 * Views where Cmd+W must do NOTHING — Omni cells (Ral 2026-09-11).
 *
 * An Omni cell is not in Maestro's partition and is not enrolled, so Cmd+W used to fall past this
 * handler entirely and land on the application menu's inherited `fileMenu` `close` role, which
 * closes the WINDOW. Omni has no tabs, so there is nothing for the key to mean there; swallowing it
 * is the whole fix. This registry exists because "do nothing" still has to be an explicit decision
 * made here — silence is what produced the bug.
 */
const windowCloseGuards = new WeakSet<WebContents>()
export const guardWindowCloseShortcut = (contents: WebContents): void => {
  windowCloseGuards.add(contents)
}

const runShortcut = (key: string, actions: ShortcutActions, contents: WebContents): boolean => {
  if (key === 'f') return actions.searchSessions()
  if (key !== 't' && key !== 'w') return false
  const now = Date.now()
  const last = lastShortcutAt.get(key) || 0
  if (now - last < shortcutDedupeMs) return true
  lastShortcutAt.set(key, now)
  if (key === 't') actions.newTab()
  // Swallowed, but still `true` so the caller preventDefaults — that is what keeps it off the menu's
  // window-close role.
  else if (windowCloseGuards.has(contents)) return true
  else actions.closeActiveTab()
  return true
}

/**
 * Contents that are Maestro's for chord purposes without being in Maestro's partition.
 *
 * A composite mini-app tab (OnlyPreview) creates its views with no `partition`, so they run in the
 * default session and the partition test below skips them. With focus inside such a view, Cmd+W
 * reached neither `closeActiveTab` nor any mini-app binding and fell through to the application
 * menu's inherited `fileMenu` `close` role — closing the whole Cowork window instead of the tab.
 *
 * The partition test stays the default on purpose: it is what stops arbitrary web content in a tab
 * from claiming Bitterless chords. Enrollment grants a keystroke, not a session — the host enrolls
 * each view of a mini app it registered, and nothing else can.
 */
const enrolledContents = new WeakSet<WebContents>()

export const enrollMaestroShortcutContents = (contents: WebContents): void => {
  enrolledContents.add(contents)
  if (pendingActions) installShortcutsForWebContents(contents, pendingActions)
}

const installShortcutsForWebContents = (contents: WebContents, actions: ShortcutActions): void => {
  const isMaestroSession = contents.session === session.fromPartition(MAESTRO_PARTITION)
  const claimsShortcuts =
    isMaestroSession || enrolledContents.has(contents) || windowCloseGuards.has(contents)
  if (!claimsShortcuts || shortcutContents.has(contents)) return
  shortcutContents.add(contents)
  contents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || input.isComposing) return
    const mod = process.platform === 'darwin' ? input.meta : input.control
    if (!mod || input.alt || input.shift) return
    // A terminal owns Cmd+W outright: let the key through untouched so its own handler closes a
    // pane. Cmd+T is still ours — the terminal has no use for it.
    const key = String(input.key || '').toLowerCase()
    if (key === 'f' && input.isAutoRepeat) { event.preventDefault(); return }
    if (key === 'w' && terminalKeyboardOwners.has(contents)) return
    if (runShortcut(key, actions, contents)) event.preventDefault()
  })
}

// Bitterless retains the application menu and Cmd/Ctrl+Q. Only WebContents in Maestro's
// persistent partition receive the tab shortcuts.
export const activateShortcuts = (actions: ShortcutActions): void => {
  pendingActions = actions
  if (activated) return
  activated = true
  app.on('web-contents-created', (_event, contents) => installShortcutsForWebContents(contents, actions))
  for (const contents of webContents.getAllWebContents()) installShortcutsForWebContents(contents, actions)
}
