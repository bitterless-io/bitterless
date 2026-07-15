import { app } from 'electron'
import { join } from 'node:path'
import { maestroDataRoot } from '@maestro-main/data/maestroDataRoot'

// Main-process path access for the shared helpers (device_info, app meta, …).
// Plain singleton — NOT XPC-exposed (bitterless wraps these in an XpcMainHandler to reach
// the renderer; coach only needs them main-side for now). Main process only: it reads
// Electron `app` paths, so never import this from a renderer/preload bundle.
class PathHelper {
  // userData: Application Support (macOS) / Roaming (Windows) — per-user, writable, persists.
  userData(): string {
    return maestroDataRoot()
  }

  // A path under userData. The directory is created by whoever writes the file.
  inUserData(...segments: string[]): string {
    return join(this.userData(), ...segments)
  }

  // Packaged app root (asar root in prod; the project dir in dev).
  appPath(): string {
    return app.getAppPath()
  }
}

export const pathHelper = new PathHelper()
