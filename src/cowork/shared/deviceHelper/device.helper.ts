import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { pathHelper } from '../pathHelper/path.helper'

// Stable per-install identity, persisted at userData/device_info.json. The device_id is the
// MQTT consumer identity — one WhatsApp account is bound to exactly one device_id (see
// Main process only: this reads the isolated Cowork userData directory.
export interface DeviceInfo {
  device_id: string
  created_at: number
  schema_version: number
}

const FILE = 'device_info.json'
const SCHEMA_VERSION = 1
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

class DeviceHelper {
  private cached: DeviceInfo | null = null

  private file(): string {
    return pathHelper.inUserData(FILE)
  }

  // Valid = parseable object carrying a well-formed UUID device_id. Anything else → rebuild.
  private valid(value: unknown): value is DeviceInfo {
    if (!value || typeof value !== 'object') return false
    const id = (value as Record<string, unknown>).device_id
    return typeof id === 'string' && UUID_RE.test(id)
  }

  private build(): DeviceInfo {
    const info: DeviceInfo = { device_id: randomUUID(), created_at: Date.now(), schema_version: SCHEMA_VERSION }
    mkdirSync(pathHelper.userData(), { recursive: true })
    writeFileSync(this.file(), JSON.stringify(info, null, 2), 'utf-8')
    return info
  }

  // Read device_info.json if present + valid; otherwise (missing / corrupt / malformed id)
  // rebuild it. Cached after the first resolve so repeat calls don't re-hit disk.
  getDeviceInfo(): DeviceInfo {
    if (this.cached) return this.cached
    const path = this.file()
    if (existsSync(path)) {
      try {
        const parsed = JSON.parse(readFileSync(path, 'utf-8'))
        if (this.valid(parsed)) {
          this.cached = parsed as DeviceInfo
          return this.cached
        }
      } catch {
        // corrupt JSON — fall through to rebuild
      }
    }
    this.cached = this.build()
    return this.cached
  }

  getDeviceId(): string {
    return this.getDeviceInfo().device_id
  }
}

export const deviceHelper = new DeviceHelper()
