// Importing xpc/preload exposes window.xpcRenderer for renderer-side emitters.
import 'electron-xpc/preload'
import { contextBridge, webUtils } from 'electron'
import { randomUUID } from 'crypto'
import { mkdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// File-path resolver: turns a picked/dropped File into its absolute path WITHOUT
// reading bytes, so attachments travel to main as PATHS (never binary over IPC).
// This is Electron's documented replacement for the removed File.path.
contextBridge.exposeInMainWorld('fileBridge', {
  getPathForFile: (file: File): string => webUtils.getPathForFile(file)
})

contextBridge.exposeInMainWorld('audioBridge', {
  writeTempAudio: (params: { bytes: ArrayBuffer; extension?: string }): string => {
    const ext = String(params.extension || 'wav').toLowerCase().replace(/[^a-z0-9]/g, '') || 'wav'
    const dir = join(tmpdir(), 'bitterless-maestro-audio')
    mkdirSync(dir, { recursive: true })
    const file = join(dir, `${Date.now()}-${randomUUID()}.${ext}`)
    writeFileSync(file, Buffer.from(params.bytes))
    return file
  }
})
