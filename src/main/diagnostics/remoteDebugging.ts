import { app } from 'electron'
import { moduleLog } from '@main/logging/moduleLog'

const log = moduleLog('health')

/**
 * Open Chromium's DevTools protocol on a port so a renderer can be profiled **from outside the app**
 * (`BITTERLESS_INSPECT=9222 yarn dev`). Opening DevTools inside a renderer that is already burning a core
 * on a machine with no free memory tends to make the very thing being measured worse, and the window
 * that must be observed is often the one that will not paint.
 *
 * Off unless the variable is set, and it must run before app ready — command-line switches are read
 * when Chromium starts, and appending one afterwards is ignored silently.
 */
export const installRemoteDebugging = (): void => {
  const port = String(process.env.BITTERLESS_INSPECT || '').trim()
  if (!port) return
  if (!/^\d{4,5}$/.test(port)) {
    log.warn(`BITTERLESS_INSPECT="${port}" is not a port number — remote debugging not enabled`)
    return
  }
  app.commandLine.appendSwitch('remote-debugging-port', port)
  // Chromium 111+ rejects a protocol WebSocket that carries an Origin it was not told to allow.
  app.commandLine.appendSwitch('remote-allow-origins', `http://127.0.0.1:${port}`)
  log.warn(`remote debugging ON — DevTools protocol at http://127.0.0.1:${port}/json (BITTERLESS_INSPECT)`)
}
