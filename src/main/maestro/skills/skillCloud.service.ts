import { inflateRawSync } from 'node:zlib'
import { safePackagePath } from '@shared/workflowPackage'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import AdmZip from 'adm-zip'
import { loadSkillSources, summarizeLoadedSkill } from './skillDiscovery.service'
import type { SkillInstitutionContext } from './skillScope.storage'

interface CloudRow { id: number; name: string; version: string; scope: 'GLOBAL' | 'INSTITUTION'; institution_id?: number | null; size: number; hash: string; content_revision: string | null }
interface Installed extends CloudRow { dir: string; origin: string }
interface CloudOptions {
  root: () => string
  session: () => { baseUrl: string; token: string } | null
  institution: () => SkillInstitutionContext | null
  authorize: () => Promise<unknown>
  changed: () => void
  fetch?: typeof fetch
}
class CloudHttpError extends Error { constructor(readonly status: number) { super(`Skills service returned ${status}.`) } }
const crcTable = Array.from({ length: 256 }, (_, value) => { let crc = value; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); return crc >>> 0 })
const archiveBytes = (entry: AdmZip.IZipEntry): Buffer => {
  if (entry.header.flags & 1 || ![0, 8].includes(entry.header.method)) throw new Error('Unsupported Skill ZIP compression.')
  const compressed = entry.getCompressedData()
  const bytes = entry.header.method === 0 ? compressed : inflateRawSync(compressed, { maxOutputLength: Math.max(1, entry.header.size) })
  if (bytes.length !== entry.header.size) throw new Error('Skill archive expanded size mismatch.')
  let crc = 0xffffffff; for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255]
  if (((crc ^ 0xffffffff) >>> 0) !== entry.header.crc) throw new Error('Skill ZIP checksum mismatch.')
  return bytes
}
const MAX_ZIP = 20 * 1024 * 1024
const validHash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)

export class SkillCloudService {
  revision = 0
  status = 'idle'
  error = ''
  private epoch = 0
  private pending?: Promise<void>
  private timer?: ReturnType<typeof setInterval>
  private abort = new AbortController()
  constructor(private readonly options: CloudOptions) {}
  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => { if (this.options.session()) void this.refresh() }, 60_000)
    this.timer.unref?.()
  }
  reset(): void { this.epoch++; this.abort.abort(); this.abort = new AbortController(); this.pending = undefined; this.status = 'idle'; this.error = ''; this.options.changed() }
  dispose(): void { if (this.timer) clearInterval(this.timer); this.timer = undefined; this.reset() }
  /**
   * Bring the cloud catalog up to date before a turn reads it — and **report**, never throw.
   *
   * Ral 2026-09-22:「cowork 聊天不依赖于技能同步成功，没同步应该也能跑」. This used to throw
   * `The institution Skills catalog is not ready: …` whenever the first sync had errored, and all three
   * callers are chat-side (maestroAgent.service.ts) — so one failed cloud round trip killed **every**
   * message. A round trip proves freshness, not authorization: an authoritative 401/403 sets `unauthorized`
   * and clears the host fence through `resetAuthorization`, which is what actually removes institution
   * skills from the catalog. An `error` status means stale, and stale is answered from disk.
   *
   * Workbench keeps its diagnostic without the throw — `skillCatalog()` already returns `cloudStatus` and
   * `cloudError` on the snapshot. Paired with micromeet-cowork; see
   * docs/issues/skill-cloud-sync-failure-blocks-chat.md.
   *
   * A settled `error` status deliberately does not re-run here: retrying a broken server once per message
   * would trade a dead chat for a slow one. The 60 s timer, focus and session/scope changes own recovery.
   */
  async ensureCatalog(): Promise<void> {
    if (this.status === 'idle' || this.status === 'syncing') await this.refresh()
  }
  async refresh(): Promise<void> {
    if (this.pending) return this.pending
    if (!this.options.session()) { this.status = 'unauthenticated'; return }
    const run = this.sync()
    this.pending = run
    try { await run } finally { if (this.pending === run) this.pending = undefined }
  }
  private async sync(): Promise<void> {
    const startedEpoch = this.epoch
    this.status = 'syncing'; this.error = ''; this.options.changed()
    try {
      await this.options.authorize()
      if (startedEpoch !== this.epoch) return
      const epoch = this.epoch, session = this.options.session()
      if (!session) return
      const institution = this.options.institution()
      const fence = (): void => {
        const now = this.options.session(), current = this.options.institution()
        if (epoch !== this.epoch || now?.token !== session.token || now?.baseUrl !== session.baseUrl || current?.generation !== institution?.generation || current?.institutionId !== institution?.institutionId) throw new Error('Skills account or institution changed.')
      }
      for (const scope of ['GLOBAL', ...(institution ? ['INSTITUTION'] : [])] as Array<'GLOBAL' | 'INSTITUTION'>) {
        const root = scope === 'GLOBAL' ? join(this.options.root(), 'shared', 'cloud') : join(this.options.root(), institution!.accountScope, institution!.institutionId, 'cloud')
        const body = scope === 'GLOBAL' ? { scope } : { scope, institution_id: Number(institution!.institutionId) }
        const rows: CloudRow[] = []
        for (let page = 1; ; page++) {
          const response = await this.api('/skill/catalog', { ...body, page, page_size: 100 }, fence) as { list: CloudRow[]; total: number; page: number }
          if (!Array.isArray(response.list) || !Number.isSafeInteger(response.total) || response.total < 0 || response.list.length === 0 && rows.length < response.total) throw new Error('Incomplete Skills catalog returned by server.')
          rows.push(...response.list)
          if (rows.length === response.total) break
          if (rows.length > response.total) throw new Error('Inconsistent Skills pagination.')
        }
        if (new Set(rows.map(row => row.id)).size !== rows.length) throw new Error('Duplicate IDs in Skills catalog.')
        const origin = createHash('sha256').update(session.baseUrl).digest('hex')
        const ledger = this.ledger(root), next: Record<string, Installed> = scope === 'GLOBAL' ? Object.fromEntries(Object.entries(ledger.skills).filter(([, value]) => value.origin !== origin)) : {}
        const visibleIds = new Set(rows.map(row => row.id))
        const remaining = Object.fromEntries(Object.entries(ledger.skills).filter(([, value]) => value.origin !== origin && scope === 'GLOBAL' || value.origin === origin && visibleIds.has(value.id)))
        this.activate(root, remaining, fence) // A broken update must not resurrect a removed package.
        for (const row of rows) {
          fence()
          if (!Number.isSafeInteger(row.id) || row.id <= 0 || row.scope !== scope || (scope === 'INSTITUTION' && String(row.institution_id) !== institution!.institutionId)) throw new Error('Invalid Skills source identity.')
          const key = `${origin}:${row.id}`
          const previous = ledger.skills[key]
          if (previous?.content_revision && previous.content_revision === row.content_revision && existsSync(join(root, previous.dir, 'SKILL.md'))) { next[key] = previous; continue }
          const result = await this.api('/skill/download-url', { ...body, id: row.id, version: row.version, ...(row.content_revision ? { content_revision: row.content_revision } : {}) }, fence) as CloudRow & { download_url: string }
          if (result.id !== row.id || result.scope !== scope || result.version !== row.version || result.institution_id !== row.institution_id || !validHash(result.hash) || result.content_revision !== `sha256:${result.hash}` || !Number.isSafeInteger(result.size) || result.size <= 0 || result.size > MAX_ZIP) throw new Error('Unverified Skills archive metadata.')
          const url = new URL(result.download_url)
          if (url.protocol !== 'https:' || !url.hostname.endsWith('.aliyuncs.com') || url.username || url.password) throw new Error('Unsupported Skills archive host.')
          const response = await (this.options.fetch || fetch)(url, { credentials: 'omit', redirect: 'error', signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(60_000)]) })
          if (!response.ok) throw new Error('Skill archive download failed.')
          const bytes = await this.bounded(response, result.size)
          fence()
          const installed = this.install(root, result, bytes, origin, fence)
          next[key] = installed
        }
        this.activate(root, next, fence)
      }
      fence(); this.status = 'ready'
    } catch (error) {
      if (startedEpoch !== this.epoch) return
      this.status = error instanceof CloudHttpError && [401,403].includes(error.status) ? 'unauthorized' : 'error'
      this.error = (error as Error).message
      // Authoritative denial clears the host authorization fence, while disk packages remain immutable.
      if (this.status === 'unauthorized') this.resetAuthorization?.()
    } finally { this.options.changed() }
  }
  resetAuthorization?: () => void
  private activate(root: string, skills: Record<string, Installed>, fence: () => void): void {
    fence()
    const entries = (value: Record<string, Installed>) => JSON.stringify(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
    if (entries(this.ledger(root).skills) === entries(skills)) return
    mkdirSync(root, { recursive: true })
    const temp = join(root, '.installed-' + randomUUID())
    try { writeFileSync(temp, JSON.stringify({ skills })); fence(); renameSync(temp, join(root, 'installed.json')); this.revision++ }
    finally { rmSync(temp, { force: true }) }
  }
  private ledger(root: string): { skills: Record<string, Installed> } {
    try { const value = JSON.parse(readFileSync(join(root, 'installed.json'), 'utf8')); return { skills: value.skills || {} } } catch { return { skills: {} } }
  }
  private install(root: string, row: CloudRow, bytes: Buffer, origin: string, fence: () => void): Installed {
    if (bytes.length !== row.size || createHash('sha256').update(bytes).digest('hex') !== row.hash) throw new Error('Skills archive checksum mismatch.')
    const zip = new AdmZip(bytes), entries = zip.getEntries()
    if (entries.length > 4096) throw new Error('Too many Skill archive entries.')
    let expanded = 0
    const names = new Set<string>()
    for (const entry of entries) {
      const offset = entry.header.offset
      if (!Number.isSafeInteger(offset) || offset < 0 || offset + 30 > bytes.length || bytes.readUInt32LE(offset) !== 0x04034b50) throw new Error('Invalid Skill ZIP header.')
      if (bytes.readUInt16LE(offset + 6) !== entry.header.flags || bytes.readUInt16LE(offset + 8) !== entry.header.method) throw new Error('Skill ZIP headers disagree.')
      if (!(entry.header.flags & 8) && (bytes.readUInt32LE(offset + 18) !== entry.header.compressedSize || bytes.readUInt32LE(offset + 22) !== entry.header.size || bytes.readUInt32LE(offset + 14) !== entry.header.crc)) throw new Error('Skill ZIP header sizes disagree.')
      const name = safePackagePath(entry.entryName.replace(/\/$/, ''))
      const mode = (entry.attr >>> 16) & 0xf000
      if (mode !== 0 && mode !== (entry.isDirectory ? 0x4000 : 0x8000)) throw new Error('Skill archive links and special files are not allowed.')
      if (!name || name.startsWith('/') || name.includes('\\') || name.split('/').some(part => part === '..' || part === '.') || /^[A-Za-z]:/.test(name) || names.has(name.normalize('NFC').toLowerCase())) throw new Error('Unsafe Skill ZIP entry.')
      names.add(name.normalize('NFC').toLowerCase()); expanded += entry.header.size
      if (expanded > 80 * 1024 * 1024) throw new Error('Expanded Skill archive exceeds limit.')
    }
    const skillEntries = entries.filter(entry => /(^|\/)SKILL.md$/.test(entry.entryName))
    if (skillEntries.length !== 1) throw new Error('Skill ZIP requires one SKILL.md.')
    const prefix = skillEntries[0].entryName.slice(0, -'SKILL.md'.length)
    if (entries.some(entry => !entry.isDirectory && !entry.entryName.startsWith(prefix))) throw new Error('Files outside Skill package root.')
    const stage = join(root, `.staging-${randomUUID()}`), relativeDir = `versions/${origin}/${row.id}/${row.hash}`, destination = join(root, relativeDir)
    try {
      mkdirSync(stage, { recursive: true })
      for (const entry of entries) {
        if (entry.isDirectory) continue
        const path = resolve(stage, entry.entryName.slice(prefix.length))
        if (!path.startsWith(resolve(stage) + sep)) throw new Error('Unsafe Skill archive path.')
        mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, archiveBytes(entry))
      }
      const summary = summarizeLoadedSkill(loadSkillSources([stage]).find(skill => skill.file === join(stage, 'SKILL.md')) || { file: join(stage, 'SKILL.md'), root: stage, error: 'Skill package is missing valid SKILL.md metadata.' }, { id: String(row.id), name: row.name, description: '', source: 'external', domain: '', path: '', updatedAt: 0, inputs: [], triggers: [] })
      if (summary.status !== 'ready') throw new Error(summary.error || 'Invalid downloaded Skill.')
      fence(); mkdirSync(dirname(destination), { recursive: true })
      if (!existsSync(destination)) renameSync(stage, destination)
      return { ...row, dir: relativeDir, origin }
    } finally { rmSync(stage, { recursive: true, force: true }) }
  }
  private async api(path: string, body: unknown, fence: () => void): Promise<unknown> {
    fence(); const session = this.options.session()!
    const response = await (this.options.fetch || fetch)(session.baseUrl + path, { method: 'POST', headers: { 'content-type': 'application/json', '-x-bl-token': session.token }, body: JSON.stringify(body), credentials: 'omit', redirect: 'error', signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(25_000)]) })
    fence(); if (!response.ok) throw new CloudHttpError(response.status)
    return JSON.parse((await this.bounded(response, 4 * 1024 * 1024)).toString('utf8'))
  }
  private async bounded(response: Response, max: number): Promise<Buffer> {
    if (!response.body || Number(response.headers.get('content-length')) > max) throw new Error('Skill response exceeds size limit.')
    const reader = response.body.getReader(), chunks: Buffer[] = []; let size = 0
    try { for (;;) { const value = await reader.read(); if (value.done) break; size += value.value.length; if (size > max) throw new Error('Skill response exceeds size limit.'); chunks.push(Buffer.from(value.value)) } }
    finally { await reader.cancel().catch(() => undefined); reader.releaseLock() }
    return Buffer.concat(chunks)
  }
}
