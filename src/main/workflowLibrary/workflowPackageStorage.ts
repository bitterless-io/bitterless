import { createHash, randomUUID } from 'node:crypto'
import { existsSync, readFileSync, mkdirSync, writeFileSync, renameSync, rmSync, statSync, openSync, readSync, closeSync } from 'node:fs'
import { dirname, join, sep } from 'node:path'
import { inflateRawSync } from 'node:zlib'
import AdmZip from 'adm-zip'
import type { CloudWorkflow, InstalledWorkflow, WorkflowSource } from '../../shared/workflowLibrary.type'
import { parseWorkflowManifest, safePackagePath, WORKFLOW_LIMITS } from '../../shared/workflowPackage'

const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value
  for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  return crc >>> 0
})
const boundedData = (entry: AdmZip.IZipEntry): Buffer => {
  if (entry.header.flags & 1 || ![0, 8].includes(entry.header.method)) throw new Error('Encrypted or unsupported workflow ZIP compression.')
  const compressed = entry.getCompressedData()
  const data = entry.header.method === 0 ? compressed : inflateRawSync(compressed, { maxOutputLength: Math.max(1, entry.header.size) })
  if (data.length !== entry.header.size) throw new Error('Workflow archive expanded length is invalid.')
  let crc = 0xffffffff
  for (const byte of data) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255]
  if (((crc ^ 0xffffffff) >>> 0) !== entry.header.crc) throw new Error('Workflow archive checksum is invalid.')
  return data
}

export class WorkflowPackageStorage {
  constructor(private readonly root: string) {}

  list(): InstalledWorkflow[] {
    const path = join(this.root, 'catalog.json')
    if (!existsSync(path)) return []
    const rows: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (!Array.isArray(rows)) throw new Error('Workflow catalog is invalid.')
    return rows.map(row => {
      if (!row || !Number.isSafeInteger(row.id) || row.id < 1 || !Number.isSafeInteger(row.revision) || row.revision < 1 || !/^[a-f0-9]{64}$/.test(row.hash) || typeof row.directory !== 'string' || !/^\d+-[a-f0-9-]+$/.test(row.directory)) throw new Error('Workflow catalog is invalid.')
      const manifest = parseWorkflowManifest(row.manifest)
      return { ...row, manifest, entry: join(this.root, row.directory, manifest.entry) } as InstalledWorkflow
    }).filter(row => existsSync(row.entry))
  }

  read(id: number): InstalledWorkflow | undefined { return this.list().find(row => row.id === id) }

  source(id: number, max: number): WorkflowSource {
    const row = this.read(id)
    if (!row) throw new Error('Download this workflow before viewing its source.')
    const directory = join(this.root, row.directory)
    const name = safePackagePath(row.manifest.entry)
    const path = join(directory, name)
    // safePackagePath already rejects `..`; this keeps the read inside the package even if that ever changes.
    if (!path.startsWith(directory + sep) || path !== row.entry) throw new Error('Unsafe workflow entry path.')
    const info = statSync(path)
    if (!info.isFile()) throw new Error('The workflow entry file is missing.')
    if (!info.size) throw new Error('The workflow entry file is empty.')
    const buffer = Buffer.alloc(Math.min(info.size, max))
    const handle = openSync(path, 'r')
    let filled = 0
    try {
      while (filled < buffer.length) {
        const count = readSync(handle, buffer, filled, buffer.length - filled, filled)
        if (!count) break
        filled += count
      }
    } finally { closeSync(handle) }
    const data = buffer.subarray(0, filled)
    if (!data.length) throw new Error('The workflow entry file is empty.')
    if (data.includes(0)) throw new Error('The workflow entry file is not readable text.')
    return { path, name, text: data.toString('utf8'), bytes: info.size, truncated: info.size > max }
  }

  install(meta: Pick<CloudWorkflow, 'id' | 'revision' | 'size' | 'hash'>, bytes: Buffer, isCurrent: () => boolean = () => true): InstalledWorkflow {
    if (!Number.isSafeInteger(meta.id) || meta.id < 1 || !Number.isSafeInteger(meta.revision) || meta.revision < 1) throw new Error('Invalid workflow identity.')
    if (!bytes.length || bytes.length > WORKFLOW_LIMITS.compressed || bytes.length !== meta.size) throw new Error('Workflow archive size does not match the download.')
    if (!/^[a-f0-9]{64}$/.test(meta.hash) || createHash('sha256').update(bytes).digest('hex') !== meta.hash) throw new Error('Workflow archive SHA-256 does not match. Retry the download.')
    const entries = new AdmZip(bytes).getEntries()
    if (entries.length > WORKFLOW_LIMITS.files) throw new Error('Workflow archive contains more than 500 entries.')
    const names = new Map<string, boolean>()
    let expanded = 0
    for (const entry of entries) {
      const offset = entry.header.offset
      if (!Number.isSafeInteger(offset) || offset < 0 || offset + 30 > bytes.length || bytes.readUInt32LE(offset) !== 0x04034b50) throw new Error('Workflow archive local header is invalid.')
      if (bytes.readUInt16LE(offset + 6) !== entry.header.flags || bytes.readUInt16LE(offset + 8) !== entry.header.method) throw new Error('Workflow archive headers disagree.')
      if (!(entry.header.flags & 8) && (bytes.readUInt32LE(offset + 18) !== entry.header.compressedSize || bytes.readUInt32LE(offset + 22) !== entry.header.size || bytes.readUInt32LE(offset + 14) !== entry.header.crc)) throw new Error('Workflow archive sizes disagree.')
      const name = safePackagePath(entry.isDirectory ? entry.entryName.replace(/\/$/, '') : entry.entryName)
      const mode = (entry.attr >>> 16) & 0xf000
      if (mode !== 0 && mode !== (entry.isDirectory ? 0x4000 : 0x8000)) throw new Error('Workflow archive links and special files are not allowed.')
      const key = name.normalize('NFC').toLowerCase()
      if (names.has(key)) throw new Error('Workflow archive contains colliding paths.')
      names.set(key, entry.isDirectory)
      expanded += entry.header.size
      if (!Number.isSafeInteger(expanded) || expanded > WORKFLOW_LIMITS.expanded) throw new Error('Workflow archive expands beyond 100 MiB.')
    }
    for (const name of names.keys()) {
      const parts = name.split('/')
      while (parts.length > 1) {
        parts.pop()
        if (names.get(parts.join('/')) === false) throw new Error('Workflow archive file/directory collision.')
      }
    }
    const manifestEntry = entries.find(entry => entry.entryName === 'workflow.json' && !entry.isDirectory)
    if (!manifestEntry || manifestEntry.header.size > WORKFLOW_LIMITS.manifest) throw new Error('A workflow.json manifest of at most 256 KiB is required at the archive root.')
    const manifest = parseWorkflowManifest(JSON.parse(boundedData(manifestEntry).toString('utf8')))
    if (!entries.some(entry => entry.entryName === manifest.entry && !entry.isDirectory)) throw new Error('The workflow entry file is missing.')
    if (!isCurrent()) throw new Error('Workflow account or institution changed.')
    mkdirSync(this.root, { recursive: true })
    const directory = `${meta.id}-${randomUUID()}`
    const staging = join(this.root, `${directory}.staging`)
    const target = join(this.root, directory)
    mkdirSync(staging)
    try {
      for (const entry of entries) {
        const targetPath = join(staging, entry.entryName)
        if (entry.isDirectory) { mkdirSync(targetPath, { recursive: true }); continue }
        const data = boundedData(entry)
        if (data.length !== entry.header.size) throw new Error('Workflow archive expanded length is invalid.')
        mkdirSync(dirname(targetPath), { recursive: true })
        writeFileSync(targetPath, data, { flag: 'wx', mode: 0o600 })
      }
      if (!isCurrent()) throw new Error('Workflow account or institution changed.')
      renameSync(staging, target)
      const row: InstalledWorkflow = { id: meta.id, revision: meta.revision, hash: meta.hash, size: meta.size, directory, entry: join(target, manifest.entry), installedAt: new Date().toISOString(), manifest }
      const rows = this.list().filter(item => item.id !== meta.id)
      rows.push(row)
      this.save(rows)
      return row
    } catch (error) {
      rmSync(staging, { recursive: true, force: true })
      // This new directory was never referenced by a successful catalog commit.
      rmSync(target, { recursive: true, force: true })
      throw error
    }
  }

  remove(id: number): void {
    // Keep immutable revisions: an explicit runtime may still have their entry open.
    this.save(this.list().filter(row => row.id !== id))
  }

  private save(rows: InstalledWorkflow[]): void {
    mkdirSync(this.root, { recursive: true })
    const temporary = join(this.root, `catalog-${randomUUID()}.json`)
    try { writeFileSync(temporary, JSON.stringify(rows), { mode: 0o600 }); renameSync(temporary, join(this.root, 'catalog.json')) }
    finally { rmSync(temporary, { force: true }) }
  }
}
