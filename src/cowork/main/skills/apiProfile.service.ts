import { join } from 'path'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs'
import type { AuthHint } from '@cowork-main/drive/replayEngine'
import { coworkDataRoot } from '@cowork-main/data/coworkDataRoot'

// Domain API Profile: the system's shared, VALUE-FREE header convention (which auth header,
// from which storage/cookie/meta key, prefix), learned once per host at ingest and applied by
// the ApiDriver to EVERY api.fetch — so per-API skills never repeat headers. It holds only the
// SCHEME (no tokens), resolved live at call time, so it's not a secret → a plain userData file
// (main-native, no xpc to the sqlite preload, no encryption needed).

const safeHost = (host: string): string => host.toLowerCase().replace(/[^a-z0-9.-]/g, '_')

const profileDir = (): string => {
  const dir = join(coworkDataRoot(), 'api-profiles')
  mkdirSync(dir, { recursive: true })
  return dir
}

export const readApiProfile = (host: string): AuthHint[] => {
  if (!host) return []
  const file = join(profileDir(), safeHost(host) + '.json')
  if (!existsSync(file)) return []
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { auth?: AuthHint[] }
    return Array.isArray(parsed.auth) ? parsed.auth : []
  } catch {
    return []
  }
}

export const writeApiProfile = (host: string, auth: AuthHint[]): void => {
  if (!host) return
  try {
    writeFileSync(
      join(profileDir(), safeHost(host) + '.json'),
      JSON.stringify({ host, auth, updatedAt: Date.now() }, null, 2)
    )
  } catch {
    /* best effort — a missing profile just means api.fetch is cookie-only */
  }
}
