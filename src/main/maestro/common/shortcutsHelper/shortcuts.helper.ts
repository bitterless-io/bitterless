import { app, session, webContents } from 'electron'
import type { WebContents } from 'electron'
import { MAESTRO_PARTITION } from '@maestro-main/data/maestroDataRoot'

export interface ShortcutActions {
  newTab: () => void
  closeActiveTab: () => void
}

const shortcutContents = new WeakSet<WebContents>()
const shortcutDedupeMs = 120
const lastShortcutAt = new Map<string, number>()
let activated = false

const runShortcut = (key: string, actions: ShortcutActions): boolean => {
  if (key !== 't' && key !== 'w') return false
  const now = Date.now()
  const last = lastShortcutAt.get(key) || 0
  if (now - last < shortcutDedupeMs) return true
  lastShortcutAt.set(key, now)
  if (key === 't') actions.newTab()
  else actions.closeActiveTab()
  return true
}

const installShortcutsForWebContents = (contents: WebContents, actions: ShortcutActions): void => {
  if (contents.session !== session.fromPartition(MAESTRO_PARTITION) || shortcutContents.has(contents)) return
  shortcutContents.add(contents)
  contents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    const mod = process.platform === 'darwin' ? input.meta : input.control
    if (!mod || input.alt || input.shift) return
    if (runShortcut(String(input.key || '').toLowerCase(), actions)) event.preventDefault()
  })
}

// Bitterless retains the application menu and Cmd/Ctrl+Q. Only WebContents in Maestro's
// persistent partition receive the tab shortcuts.
export const activateShortcuts = (actions: ShortcutActions): void => {
  if (activated) return
  activated = true
  app.on('web-contents-created', (_event, contents) => installShortcutsForWebContents(contents, actions))
  for (const contents of webContents.getAllWebContents()) installShortcutsForWebContents(contents, actions)
}
