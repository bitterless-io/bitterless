import { app } from 'electron'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'

// App metadata for about / health output. NEVER exposes scripts or dependencies — only the
// allowed meta fields below. In a packaged build it reads the trimmed out/app-meta.json baked
// by scripts/genAppMeta.mjs (so the shipped meta has no scripts/deps); in dev it falls
// back to package.json. Main process only.
export interface PackageInfo {
  name: string
  version: string
  versionCode: string
  description: string
  repository: string
  author: string
  license: string
  homepage: string
}

const ALLOWED: (keyof PackageInfo)[] = [
  'name',
  'version',
  'versionCode',
  'description',
  'repository',
  'author',
  'license',
  'homepage'
]
const DEFAULTS: PackageInfo = {
  name: '',
  version: '',
  versionCode: '0',
  description: '',
  repository: '',
  author: '',
  license: '',
  homepage: ''
}

class PackageHelper {
  private cached: PackageInfo | null = null

  // Keep only the allowed fields; coerce object-valued fields (repository/author) to string.
  private pick(raw: Record<string, unknown>): PackageInfo {
    const out: Record<string, unknown> = { ...DEFAULTS }
    for (const key of ALLOWED) {
      const value = key === 'versionCode'
        ? raw.version_code ?? raw.versionCode
        : raw[key]
      if (value == null) continue
      out[key] = key === 'versionCode'
        ? String(value)
        : typeof value === 'object' ? JSON.stringify(value) : value
    }
    return out as unknown as PackageInfo
  }

  // Prefer the build-time trimmed meta (no scripts/deps); fall back to package.json (dev).
  getPackageInfo(): PackageInfo {
    if (this.cached) return this.cached
    const root = app.getAppPath()
    const candidates = [join(root, 'out', 'app-meta.json'), join(root, 'app-meta.json'), join(root, 'package.json')]
    for (const candidate of candidates) {
      try {
        const raw = JSON.parse(readFileSync(candidate, 'utf-8')) as Record<string, unknown>
        this.cached = this.pick(raw)
        return this.cached
      } catch {
        // not present / unreadable — try the next candidate
      }
    }
    this.cached = { ...DEFAULTS }
    return this.cached
  }
}

export const packageHelper = new PackageHelper()
