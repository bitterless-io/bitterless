import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { inflateRawSync } from 'node:zlib'
import AdmZip from 'adm-zip'
import { safePackagePath, WORKFLOW_LIMITS } from '../../shared/workflowPackage'
import { DYNAMIC_ENTRY, DYNAMIC_ENTRY_ALTERNATIVES, parseDynamicWorkflow } from '../agent/workflowEngine/dynamic/dynamicLoader'

/**
 * Expand a workflow ZIP into the workflows root as a plain package directory.
 *
 * With the remote library gone, this is the only "someone sent me a package" entry point, so the
 * archive hardening the managed store used to apply is kept verbatim — a ZIP is still untrusted
 * input regardless of where the file came from. What is *not* kept is the immutable
 * `<revision>-<uuid>` copy and `catalog.json`: the owner edits this directory directly, so a second
 * copy would mean running something other than what they just saved.
 */
const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value
  for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
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
const PACKAGE_DIR = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const slug = (value: string): string => {
  const cleaned = value.trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[^A-Za-z0-9]+/, '').slice(0, 64)
  return PACKAGE_DIR.test(cleaned) ? cleaned : 'workflow'
}

/** Returns the directory name the package was expanded into. */
export const importWorkflowPackage = (root: string, bytes: Buffer): string => {
  if (!bytes.length || bytes.length > WORKFLOW_LIMITS.compressed) throw new Error('Choose a workflow ZIP smaller than 20 MiB.')
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
  // A package is a script. Validate the entry the same way the scanner will, so an archive that
  // would land as a broken package is refused at import instead of after it is on disk.
  const accepted: readonly string[] = [DYNAMIC_ENTRY, ...DYNAMIC_ENTRY_ALTERNATIVES]
  const scriptEntry = entries.find(entry => accepted.includes(entry.entryName) && !entry.isDirectory)
  if (!scriptEntry) throw new Error(`A ${DYNAMIC_ENTRY} exporting \`const meta\` is required at the archive root.`)
  if (scriptEntry.header.size > WORKFLOW_LIMITS.script) throw new Error(`${scriptEntry.entryName} is larger than ${WORKFLOW_LIMITS.script / 1024} KiB.`)
  const meta = parseDynamicWorkflow(boundedData(scriptEntry).toString('utf8'))
  mkdirSync(root, { recursive: true })
  // A name collision becomes a second package, not a silent overwrite of the one already installed.
  const base = slug(meta.name)
  let directory = base
  for (let suffix = 2; existsSync(join(root, directory)); suffix++) directory = slug(`${base}-${suffix}`)
  const staging = join(root, `.${directory}-${randomUUID()}.staging`)
  const target = join(root, directory)
  mkdirSync(staging)
  try {
    for (const entry of entries) {
      const path = join(staging, entry.entryName)
      if (entry.isDirectory) { mkdirSync(path, { recursive: true }); continue }
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, boundedData(entry), { flag: 'wx', mode: 0o600 })
    }
    renameSync(staging, target)
    return directory
  } catch (error) {
    rmSync(staging, { recursive: true, force: true })
    throw error
  }
}
