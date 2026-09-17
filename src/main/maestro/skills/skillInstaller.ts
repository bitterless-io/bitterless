import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { Readable } from 'node:stream'
import AdmZip from 'adm-zip'
import { Parser } from 'tar'
import { maxSatisfying, valid, validRange } from 'semver'
import { parse as parseYaml } from 'yaml'
import minimatch from 'minimatch'

export type SourceKind = 'github' | 'npm' | 'git'
export interface SkillSourceInput { source: string; ref?: string; path?: string; skills?: string[] }
export interface ParsedSkillInput { input: SkillSourceInput; scopeHint?: 'shared'; requestedScope?: 'shared'; listOnly?: boolean; cliVersion?: string }
export interface SkillCandidate { name: string; description: string; path: string }
export interface ResolvedSkillSource {
  kind: SourceKind; identity: string; requested: string; requestedRef?: string; requestedVersion?: string
  resolvedCommit?: string; version?: string; integrity?: string; path?: string
}
export interface SkillInspection { id: string; source: ResolvedSkillSource; candidates: SkillCandidate[]; suggestedSkills: string[]; scopeHint?: 'shared'; listOnly?: boolean }
export interface SkillInstallation {
  id: string; destination: string; source: ResolvedSkillSource; skills: SkillCandidate[]; digest: string
  installedAt: string; updatedAt: string; status: 'installed' | 'modified' | 'missing'
}
export interface InstallerLimits { downloadBytes: number; unpackedBytes: number; files: number; metadataBytes: number; depth: number; timeoutMs: number }
export interface GitSourceFetcher {
  (request: { url: string; ref?: string; destination: string; signal?: AbortSignal; limits: InstallerLimits }): Promise<{ commit: string }>
}
export interface SkillInstallerOptions {
  authoringRoot: string; stateRoot: string; fetch?: typeof globalThis.fetch; git?: GitSourceFetcher; limits?: Partial<InstallerLimits>
  guard?: () => void | Promise<void>
}
export class SkillInstallError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = 'SkillInstallError' }
}
const fail = (code: string, message: string): never => { throw new SkillInstallError(code, message) }
const defaults: InstallerLimits = { downloadBytes: 40 * 1024 * 1024, unpackedBytes: 100 * 1024 * 1024, files: 10000, metadataBytes: 8 * 1024 * 1024, depth: 30, timeoutMs: 60000 }
const checkAbort = (signal?: AbortSignal) => { if (signal?.aborted) fail('cancelled', 'Skill installation cancelled.') }
const inside = (root: string, path: string) => path === root || path.startsWith(root + sep)
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
const exists = async (path: string) => { try { await fs.lstat(path); return true } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false; throw e } }
const safeId = (id: string) => { if (!/^[a-f0-9-]{36}$/.test(id)) fail('invalid-id', 'Invalid installation identifier.'); return id }
const safePart = (name: string) => {
  if (!name || name === '.' || name === '..' || /[<>:"\\|?*\x00-\x1f]/.test(name) || /[. ]$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) fail('unsafe-path', 'The package contains an unsafe file path.')
}
function safeRelative(value: string): string {
  if (value === '' || value === '.') return '.'
  if (isAbsolute(value) || value.includes('\\')) fail('unsafe-path', 'Expected a package-relative path.')
  const pieces = value.replace(/\/$/, '').split('/'); pieces.forEach(safePart); return pieces.join('/')
}
function httpsUrl(value: string): URL {
  let url: URL
  try { url = new URL(value) } catch { return fail('invalid-source', 'Invalid source URL.') }
  if (url.protocol !== 'https:' || url.username || url.password || [...url.searchParams.keys()].some(key => /token|password|secret|auth|credential/i.test(key))) fail('invalid-source', 'Use an HTTPS source URL without embedded credentials.')
  return url
}
function words(command: string): string[] {
  const out: string[] = []; let token = '', quote = '', started = false
  for (let i = 0; i < command.length; i++) {
    const c = command[i]
    if (/[$`\n\r\x00]/.test(c)) fail('unsupported-command', 'Shell expansion and multiple commands are not supported.')
    if (quote) { if (c === quote) quote = ''; else token += c; started = true; continue }
    if (c === '"' || c === "'") { quote = c; started = true; continue }
    if (/[;|&<>]/.test(c)) fail('unsupported-command', 'Shell operators are not supported.')
    if (/\s/.test(c)) { if (started) { out.push(token); token = ''; started = false }; continue }
    if (c === '\\') { if (++i >= command.length) fail('unsupported-command', 'Invalid command escaping.'); token += command[i]; started = true; continue }
    token += c; started = true
  }
  if (quote) fail('unsupported-command', 'Unclosed command quote.')
  if (started) out.push(token)
  return out
}
function normalizeRequest(request: SkillSourceInput): SkillSourceInput {
  let source = request.source.trim(), ref = request.ref, path = request.path, skills = request.skills
  if (!source.startsWith('npm:')) {
    const fragmentAt = source.indexOf('#')
    if (fragmentAt >= 0) {
      const fragment = source.slice(fragmentAt + 1), at = fragment.indexOf('@')
      source = source.slice(0, fragmentAt)
      try { ref ||= decodeURIComponent(at < 0 ? fragment : fragment.slice(0, at)); if (!skills?.length && at >= 0) skills = [decodeURIComponent(fragment.slice(at + 1))] }
      catch { fail('invalid-source', 'Invalid source ref encoding.') }
    }
    source = source.replace(/^github:/, '')
    const shorthand = /^([\w.-]+)\/([\w.-]+)(?:@(.+)|\/(.+))?$/.exec(source)
    if (shorthand) { source = `${shorthand[1]}/${shorthand[2]}`; if (shorthand[3] && !skills?.length) skills = [shorthand[3]]; path ||= shorthand[4] }
  }
  if (path) safeRelative(path)
  return { source, ref, path, skills: skills ? [...skills] : undefined }
}
export function parseSkillInstallInput(input: string | SkillSourceInput): ParsedSkillInput {
  if (typeof input !== 'string') {
    if (!input || typeof input.source !== 'string') fail('invalid-source', 'A skill source is required.')
    return { input: normalizeRequest(input) }
  }
  const text = input.trim()
  if (!/^(npx|bunx|bun\s+x|yarn\s+dlx)\s/.test(text)) {
    if (/\s/.test(text) && !text.startsWith('npm:')) fail('invalid-source', 'Use a source URL or a supported skills add command.')
    return { input: normalizeRequest({ source: text }) }
  }
  const tokens = words(text); const first = tokens.shift()
  if (first === 'yarn') { if (tokens.shift() !== 'dlx') fail('unsupported-command', 'Only yarn dlx skills add is supported.') }
  if (first === 'bun') { if (tokens.shift() !== 'x') fail('unsupported-command', 'Only bun x skills add is supported.') }
  while (tokens[0] === '-y' || tokens[0] === '--yes' || tokens[0] === '--bun') tokens.shift()
  const cli = tokens.shift() || ''
  if (!/^skills(?:@[^\s]+)?$/.test(cli) || tokens.shift() !== 'add') fail('unsupported-command', 'Only the known skills add installer is supported.')
  let source = ''; const skills: string[] = []; let scopeHint: 'shared' | undefined, listOnly = false
  while (tokens.length) {
    const arg = tokens.shift()!
    if (arg === '-g' || arg === '--global') { scopeHint = 'shared'; continue }
    if (arg === '-y' || arg === '--yes' || arg === '--copy') continue
    if (arg === '-l' || arg === '--list') { listOnly = true; continue }
    const match = /^(--skill|-s|--agent|-a)(?:=(.*))?$/.exec(arg)
    if (match) {
      const values: string[] = match[2] === undefined ? [] : [match[2]]
      while (tokens.length && !tokens[0].startsWith('-')) values.push(tokens.shift()!)
      if (!values.length) fail('unsupported-command', 'A skill or agent selection is missing.')
      if (match[1] === '--skill' || match[1] === '-s') skills.push(...values)
      continue
    }
    if (arg.startsWith('-')) fail('unsupported-command', 'This installer flag is not supported.')
    if (source) fail('unsupported-command', 'Only one source is supported per installation.')
    source = arg
  }
  if (!source) fail('invalid-source', 'A skill source is required.')
  return { input: normalizeRequest({ source, skills: skills.length ? skills : undefined }), scopeHint, requestedScope: scopeHint, listOnly, cliVersion: cli.includes('@') ? cli.slice(7) : undefined }
}

interface InspectionRecord extends SkillInspection { request: SkillSourceInput; digest: string }
interface Ledger { version: 1; root: string; installations: SkillInstallation[] }
interface Journal { id: string; operation: 'install' | 'update' | 'remove'; next: Ledger; previous: Ledger }
interface FileRow { path: string; mode: number; size: number; directory?: boolean }
async function inventory(root: string, limits: InstallerLimits, signal?: AbortSignal): Promise<{ rows: FileRow[]; digest: string }> {
  const rows: FileRow[] = []; const names = new Set<string>(); let bytes = 0; const digest = createHash('sha256')
  const visit = async (dir: string, parts: string[]) => {
    checkAbort(signal)
    if (parts.length > limits.depth) fail('limit', 'Package nesting exceeds the installation limit.')
    for (const name of (await fs.readdir(dir)).sort()) {
      safePart(name)
      if (name === '.git') continue
      const path = [...parts, name].join('/'), key = path.normalize('NFC').toLowerCase()
      if (names.has(key)) fail('unsafe-path', 'Package file names collide across supported filesystems.')
      names.add(key)
      if (names.size > limits.files) fail('limit', 'Package has too many files.')
      const file = join(dir, name), stat = await fs.lstat(file)
      if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) fail('unsafe-path', 'Package links and special files are unsupported.')
      if (stat.isDirectory()) { rows.push({ path, mode: stat.mode & 0o777, size: 0, directory: true }); digest.update(`D\0${path}\0`); await visit(file, [...parts, name]); continue }
      bytes += stat.size; if (bytes > limits.unpackedBytes) fail('limit', 'Unpacked package exceeds the installation limit.')
      const content = await fs.readFile(file)
      if (content.length < 2048 && content.subarray(0, 80).toString().startsWith('version https://git-lfs.github.com/spec/v1')) fail('unsupported-resources', 'Git LFS pointer files require an archive containing the actual resources.')
      digest.update(`F\0${path}\0${stat.mode & 0o111}\0${content.length}\0`).update(content)
      rows.push({ path, mode: stat.mode & 0o777, size: stat.size })
    }
  }
  await visit(root, [])
  return { rows, digest: digest.digest('hex') }
}
async function canonicalDirectory(path: string): Promise<string> {
  if (!isAbsolute(path)) fail('invalid-root', 'Installer roots must be absolute paths.')
  await fs.mkdir(path, { recursive: true }); return fs.realpath(path)
}
async function atomicJson(path: string, data: unknown) {
  const temp = path + '.' + randomUUID() + '.tmp'
  try { await fs.writeFile(temp, JSON.stringify(data, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); await fs.rename(temp, path) }
  finally { await fs.rm(temp, { force: true }) }
}
async function copyTree(source: string, target: string, limits: InstallerLimits, signal?: AbortSignal) {
  const { rows } = await inventory(source, limits, signal)
  await fs.mkdir(target, { recursive: false })
  for (const row of rows) {
    checkAbort(signal); const dest = join(target, row.path)
    if (row.directory) { await fs.mkdir(dest, { recursive: true }); continue }
    await fs.mkdir(dirname(dest), { recursive: true })
    const before = await fs.lstat(join(source, row.path)); if (!before.isFile() || before.isSymbolicLink()) fail('unsafe-path', 'Source changed during installation.')
    await fs.copyFile(join(source, row.path), dest, 1); await fs.chmod(dest, row.mode)
  }
}
export class SkillInstaller {
  private readonly http: typeof globalThis.fetch
  private readonly limits: InstallerLimits
  private ready?: Promise<void>
  private rootIdentity = ''
  private root = ''; private state = ''; private inspections = ''; private ledgerPath = ''; private journalPath = ''
  constructor(private readonly options: SkillInstallerOptions) { this.http = options.fetch || globalThis.fetch; this.limits = { ...defaults, ...options.limits } }
  private async init() {
    await this.options.guard?.()
    if (!this.ready) this.ready = (async () => {
      this.root = await canonicalDirectory(this.options.authoringRoot)
      const rootStat = await fs.stat(this.root); this.rootIdentity = `${rootStat.dev}:${rootStat.ino}`
      this.state = await canonicalDirectory(this.options.stateRoot)
      if (inside(this.root, this.state) || inside(this.state, this.root)) fail('invalid-root', 'Installer state and skill roots must be separate.')
      this.inspections = join(this.state, 'inspections'); await fs.mkdir(this.inspections, { recursive: true })
      this.ledgerPath = join(this.state, 'installed.json'); this.journalPath = join(this.state, 'transaction.json')
      const ownerFile = join(this.state, 'owner.json')
      if (await exists(ownerFile)) { const owner = JSON.parse(await fs.readFile(ownerFile, 'utf8')); if (owner.root !== this.root) fail('scope-mismatch', 'Installer state belongs to a different skill root.') }
      else { try { await fs.writeFile(ownerFile, JSON.stringify({ root: this.root }), { flag: 'wx' }) } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; const owner = JSON.parse(await fs.readFile(ownerFile, 'utf8')); if (owner.root !== this.root) fail('scope-mismatch', 'Installer state belongs to a different skill root.') } }
    })()
    await this.ready
    await this.assertRoots()
  }
  private async assertRoots() {
    if (await fs.realpath(this.options.authoringRoot) !== this.root || await fs.realpath(this.options.stateRoot) !== this.state) fail('scope-mismatch', 'Installer scope changed.')
    const rootStat = await fs.stat(this.root)
    if (`${rootStat.dev}:${rootStat.ino}` !== this.rootIdentity) fail('scope-mismatch', 'Installer destination was replaced.')
  }
  private async locked<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    await this.init(); checkAbort(signal)
    const lock = join(this.state, 'operation.lock'); let handle
    try { handle = await fs.open(lock, 'wx'); await handle.writeFile(JSON.stringify({ pid: process.pid, token: randomUUID() })) }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
      // Only an exited owner can release a stale lock. An active process is never displaced.
      let owner: { pid?: number }
      try { owner = JSON.parse(await fs.readFile(lock, 'utf8')) } catch { return fail('busy', 'Another skill operation is in progress.') }
      if (!Number.isInteger(owner.pid) || !owner.pid || owner.pid < 1) return fail('busy', 'Another skill operation is in progress.')
      try { process.kill(owner.pid, 0); return fail('busy', 'Another skill operation is in progress.') }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error }
      await fs.unlink(lock); return this.locked(operation, signal)
    }
    try { await this.recover(); return await operation() }
    finally { await handle?.close(); await fs.rm(lock, { force: true }) }
  }
  private emptyLedger(): Ledger { return { version: 1, root: this.root, installations: [] } }
  private async ledger(): Promise<Ledger> {
    if (!await exists(this.ledgerPath)) return this.emptyLedger()
    let ledger: Ledger
    try { ledger = JSON.parse(await fs.readFile(this.ledgerPath, 'utf8')) } catch { return fail('state-corrupt', 'Skill installation state is unreadable.') }
    if (ledger.version !== 1 || ledger.root !== this.root || !Array.isArray(ledger.installations)) fail('state-corrupt', 'Skill installation state is invalid.')
    for (const record of ledger.installations) { safeId(record.id); if (record.destination !== this.destination(record.id)) fail('state-corrupt', 'Installation path does not belong to this root.') }
    return ledger
  }
  private destination(id: string) { return join(this.root, 'skill-source-' + safeId(id)) }
  private temp(id: string) { return join(this.root, '.skill-stage-' + safeId(id)) }
  private backup(id: string) { return join(this.root, '.skill-backup-' + safeId(id)) }
  private async recover() {
    await this.assertRoots()
    if (!await exists(this.journalPath)) return
    let tx: Journal
    try { tx = JSON.parse(await fs.readFile(this.journalPath, 'utf8')) } catch { return fail('state-corrupt', 'Skill transaction state is unreadable.') }
    safeId(tx.id)
    if (!['install', 'update', 'remove'].includes(tx.operation) || tx.next.root !== this.root || tx.previous.root !== this.root) fail('state-corrupt', 'Invalid skill transaction state.')
    const current = await this.ledger(), committed = JSON.stringify(current) === JSON.stringify(tx.next)
    const dest = this.destination(tx.id), backup = this.backup(tx.id), stage = this.temp(tx.id)
    if (!committed) {
      if (await exists(backup)) { await fs.rm(dest, { recursive: true, force: true }); await fs.rename(backup, dest) }
      else if (tx.operation === 'install') await fs.rm(dest, { recursive: true, force: true })
      await atomicJson(this.ledgerPath, tx.previous)
    }
    await fs.rm(stage, { recursive: true, force: true }); await fs.rm(backup, { recursive: true, force: true }); await fs.rm(this.journalPath, { force: true })
  }
  private async status(record: SkillInstallation): Promise<SkillInstallation> {
    if (!await exists(record.destination)) return { ...record, status: 'missing' }
    try { const stat = await fs.lstat(record.destination); if (!stat.isDirectory() || stat.isSymbolicLink()) return { ...record, status: 'modified' }; const actual = await inventory(record.destination, this.limits); return { ...record, status: actual.digest === record.digest ? 'installed' : 'modified' } }
    catch { return { ...record, status: 'modified' } }
  }
  async list(): Promise<SkillInstallation[]> { return this.locked(async () => Promise.all((await this.ledger()).installations.map(record => this.status(record)))) }
  async inspect(input: string | SkillSourceInput, options: { signal?: AbortSignal } = {}): Promise<SkillInspection> {
    return this.locked(() => this.inspectInternal(input, options.signal), options.signal)
  }
  async getInspection(id: string): Promise<SkillInspection> { return this.locked(async () => this.publicInspection(await this.readInspection(id))) }
  private async inspectInternal(input: string | SkillSourceInput, signal?: AbortSignal): Promise<SkillInspection> {
    const parsed = parseSkillInstallInput(input), id = randomUUID(), dir = join(this.inspections, id), tree = join(dir, 'tree')
    await this.options.guard?.()
    await fs.mkdir(dir)
    try {
      const source = await this.acquire(parsed.input, tree, signal)
      await this.options.guard?.()
    const scan = await inventory(tree, this.limits, signal)
      const candidates = await this.candidates(tree, scan.rows, parsed.input.path || source.path)
      if (!candidates.length) fail('no-skills', 'The source contains no valid standard skills in the requested path.')
      const record: InspectionRecord = { id, source, candidates, suggestedSkills: parsed.input.skills || [], scopeHint: parsed.scopeHint, listOnly: parsed.listOnly, request: parsed.input, digest: scan.digest }
      await atomicJson(join(dir, 'inspection.json'), record)
      return this.publicInspection(record)
    } catch (e) { await fs.rm(dir, { recursive: true, force: true }); throw this.safeError(e) }
  }
  private publicInspection(record: InspectionRecord): SkillInspection { const { request: _request, digest: _digest, ...view } = record; return view }
  private safeError(error: unknown): Error { return error instanceof SkillInstallError ? error : new SkillInstallError('source-failed', 'The skill source could not be fetched or processed.') }
  private async readInspection(id: string): Promise<InspectionRecord> {
    safeId(id); const dir = join(this.inspections, id)
    let record: InspectionRecord
    try { record = JSON.parse(await fs.readFile(join(dir, 'inspection.json'), 'utf8')) } catch { return fail('inspection-missing', 'Inspect this source before installing it.') }
    if (record.id !== id || !Array.isArray(record.candidates)) fail('state-corrupt', 'Inspection state is invalid.')
    if ((await inventory(join(dir, 'tree'), this.limits)).digest !== record.digest) fail('inspection-changed', 'Inspected source files changed; inspect again.')
    return record
  }
  private select(record: InspectionRecord, names?: string[]): SkillCandidate[] {
    const selection = names?.length ? names : record.suggestedSkills
    if (!selection.length) { if (record.candidates.length === 1) return this.validateSelection(record.candidates); return fail('selection-required', 'Select one or more skills from this source.') }
    if (selection.includes('*')) return this.validateSelection(record.candidates)
    const selected: SkillCandidate[] = []
    for (const name of selection) {
      const matches = record.candidates.filter(skill => skill.name === name || skill.path === name)
      if (!matches.length) fail('skill-not-found', 'A selected skill is no longer available.')
      if (matches.length !== 1) fail('ambiguous-skill', 'Duplicate skill names require selection by source-relative path.')
      if (!selected.some(skill => skill.path === matches[0].path)) selected.push(matches[0])
    }
    return this.validateSelection(selected)
  }
  private validateSelection(skills: SkillCandidate[]): SkillCandidate[] {
    for (const skill of skills) {
      if (skill.path.split('/').some(piece => piece === 'node_modules' || (piece !== '.' && piece.startsWith('.')))) fail('unsupported-layout', 'Selected skill is inside a directory the native skill loader ignores.')
      if (skills.some(other => other !== skill && (other.path === '.' || skill.path.startsWith(other.path + '/')))) fail('overlapping-skills', 'Choose either the parent skill or its nested skills; the native loader stops at a parent SKILL.md.')
    }
    return skills
  }
  async install(options: { inspectionId: string; skills?: string[]; signal?: AbortSignal }): Promise<SkillInstallation> {
    return this.locked(async () => {
      const record = await this.readInspection(options.inspectionId), skills = this.select(record, options.skills), ledger = await this.ledger()
      if (ledger.installations.some(item => item.source.identity === record.source.identity && (item.source.path || '.') === (record.source.path || '.'))) fail('already-installed', 'This source is already installed; update its existing installation.')
      return this.publish(record, skills, randomUUID(), ledger, undefined, options.signal)
    }, options.signal)
  }
  async update(id: string, options: { signal?: AbortSignal; confirm?: (previous: SkillInstallation, next: SkillInspection) => Promise<boolean> } = {}): Promise<SkillInstallation> {
    return this.locked(async () => {
      safeId(id); const ledger = await this.ledger(), old = ledger.installations.find(item => item.id === id)
      if (!old) fail('not-owned', 'This installation is not owned by this installer.')
      if ((await this.status(old!)).status !== 'installed') fail('local-conflict', 'Installed files were modified or removed; preserve those changes before updating.')
      const request: SkillSourceInput = { source: old!.source.requested, ref: old!.source.requestedRef, path: old!.source.path, skills: old!.skills.map(skill => skill.path) }
      const inspected = await this.inspectInternal(request, options.signal), record = await this.readInspection(inspected.id), skills = this.select(record, request.skills)
      if (options.confirm && !await options.confirm(old!, this.publicInspection(record))) fail('denied', 'Skill source update was not approved.')
      return this.publish(record, skills, id, ledger, old, options.signal)
    }, options.signal)
  }
  async remove(id: string, options: { signal?: AbortSignal } = {}): Promise<void> {
    return this.locked(async () => {
      safeId(id); const ledger = await this.ledger(), old = ledger.installations.find(item => item.id === id)
      if (!old) fail('not-owned', 'This installation is not owned by this installer.')
      const status = (await this.status(old!)).status
      if (status === 'modified') fail('local-conflict', 'Installed files were modified; preserve those changes before removing.')
      const next = { ...ledger, installations: ledger.installations.filter(item => item.id !== id) }
      checkAbort(options.signal)
      await this.options.guard?.()
      await atomicJson(this.journalPath, { id, operation: 'remove', previous: ledger, next } satisfies Journal)
      try {
        if (status !== 'missing') await fs.rename(this.destination(id), this.backup(id))
        checkAbort(options.signal); await this.options.guard?.(); await atomicJson(this.ledgerPath, next)
        await this.recover()
      } catch (e) { await this.recover(); throw e }
    }, options.signal)
  }
  private async publish(record: InspectionRecord, skills: SkillCandidate[], id: string, ledger: Ledger, old?: SkillInstallation, signal?: AbortSignal): Promise<SkillInstallation> {
    const stage = this.temp(id), dest = this.destination(id)
    if (await exists(stage) || await exists(this.backup(id)) || (!old && await exists(dest))) fail('path-conflict', 'Installation destination is already in use.')
    try {
      await copyTree(join(this.inspections, record.id, 'tree'), stage, this.limits, signal)
      // Keep package-relative support resources but activate only explicitly selected entry points.
      const chosen = new Set(skills.map(skill => skill.path))
      const rows = (await inventory(stage, this.limits, signal)).rows
      for (const row of rows) if (basename(row.path) === 'SKILL.md' && !chosen.has(dirname(row.path).split(sep).join('/'))) await fs.rm(join(stage, row.path))
      const digest = (await inventory(stage, this.limits, signal)).digest, now = new Date().toISOString()
      const item: SkillInstallation = { id, destination: dest, source: record.source, skills, digest, installedAt: old?.installedAt || now, updatedAt: now, status: 'installed' }
      const next: Ledger = { ...ledger, installations: [...ledger.installations.filter(row => row.id !== id), item] }
      if (old && (await this.status(old)).status !== 'installed') fail('local-conflict', 'Installed files changed while fetching the update.')
      await this.init(); checkAbort(signal)
      await atomicJson(this.journalPath, { id, operation: old ? 'update' : 'install', previous: ledger, next } satisfies Journal)
      try {
        if (old) await fs.rename(dest, this.backup(id))
        await fs.rename(stage, dest); checkAbort(signal); await this.options.guard?.(); await atomicJson(this.ledgerPath, next)
        await this.recover(); return item
      } catch (e) { await this.recover(); throw e }
    } finally { await fs.rm(stage, { recursive: true, force: true }) }
  }
  private async fetchBytes(url: string, limit: number, signal?: AbortSignal): Promise<Buffer> {
    checkAbort(signal)
    const timeout = AbortSignal.timeout(this.limits.timeoutMs)
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
    try {
    let target = httpsUrl(url).href
    for (let redirects = 0; redirects < 6; redirects++) {
      const response = await this.http(target, { signal: combined, redirect: 'manual', headers: { Accept: 'application/vnd.github+json, application/json, application/octet-stream', 'User-Agent': 'skill-source-installer' } })
      if ([301, 302, 303, 307, 308].includes(response.status)) { const location = response.headers.get('location'); if (!location) return fail('download-failed', 'Source redirect is missing a destination.'); target = httpsUrl(new URL(location, target).href).href; continue }
      if (!response.ok) fail(response.status === 404 ? 'source-not-found' : response.status === 401 || response.status === 403 ? 'source-access' : 'download-failed', 'The skill source is unavailable or access was refused.')
      if (Number(response.headers.get('content-length') || 0) > limit) fail('limit', 'Source download exceeds the installation limit.')
      const reader = response.body?.getReader(); if (!reader) return Buffer.alloc(0)
      const chunks: Uint8Array[] = []; let length = 0
      try { for (;;) { checkAbort(signal); const result = await reader.read(); if (result.done) break; length += result.value.length; if (length > limit) fail('limit', 'Source download exceeds the installation limit.'); chunks.push(result.value) } }
      finally { await reader.cancel().catch(() => {}) }
      return Buffer.concat(chunks)
    }
    return fail('download-failed', 'Source has too many redirects.')
    } catch (e) { if (signal?.aborted) fail('cancelled', 'Skill source download cancelled.'); if (timeout.aborted) fail('timeout', 'Skill source download timed out.'); throw e }
  }
  private async json(url: string, signal?: AbortSignal): Promise<any> { try { return JSON.parse((await this.fetchBytes(url, this.limits.metadataBytes, signal)).toString('utf8')) } catch (e) { if (e instanceof SkillInstallError) throw e; return fail('invalid-source', 'Source metadata is invalid.') } }
  private async acquire(request: SkillSourceInput, tree: string, signal?: AbortSignal): Promise<ResolvedSkillSource> {
    const raw = request.source.trim()
    if (raw.startsWith('npm:')) return this.npm(raw, request, tree, signal)
    let source = raw.replace(/^git:/, '')
    if (source.startsWith('github.com/')) source = 'https://' + source
    if (/^[\w.-]+\/[\w.-]+@[^\s]+$/.test(source)) {
      const at = source.indexOf('@'); request = { ...request, ref: request.ref || source.slice(at + 1) }; source = source.slice(0, at)
    }
    if (/^[\w.-]+\/[\w.-]+$/.test(source)) source = 'https://github.com/' + source
    const url = httpsUrl(source)
    if (url.hostname === 'github.com') return this.github(url, request, tree, signal)
    if (!this.options.git) fail('git-unavailable', 'This application has not enabled the HTTPS Git source adapter.')
    if (url.search || url.hash) fail('invalid-source', 'Use a plain HTTPS Git repository URL and a separate ref.')
    const result = await this.options.git!({ url: url.href, ref: request.ref, destination: tree, signal, limits: this.limits })
    if (!/^[a-f0-9]{40,64}$/i.test(result.commit)) fail('invalid-source', 'Git source did not resolve an exact commit.')
    await fs.rm(join(tree, '.git'), { recursive: true, force: true })
    return { kind: 'git', identity: url.href.replace(/\.git$/, ''), requested: url.href, requestedRef: request.ref, resolvedCommit: result.commit, path: request.path }
  }
  private async github(url: URL, request: SkillSourceInput, tree: string, signal?: AbortSignal): Promise<ResolvedSkillSource> {
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent), owner = parts[0], repo = parts[1]?.replace(/\.git$/, '')
    if (!owner || !repo || !/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) fail('invalid-source', 'Invalid GitHub repository source.')
    const endpoint = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
    let ref = request.ref, path = request.path
    if (parts.length > 2) {
      if (!['tree', 'blob'].includes(parts[2]) || ref || path) fail('invalid-source', 'Use a GitHub repository URL with separate ref/path, or a tree URL.')
      // Resolve longest existing ref first; branch names may contain slashes.
      for (let count = parts.length - 3; count >= 1; count--) {
        const candidate = parts.slice(3, 3 + count).join('/')
        try { await this.json(`${endpoint}/commits/${encodeURIComponent(candidate)}`, signal); ref = candidate; path = parts.slice(3 + count).join('/'); break }
        catch (e) { if (!(e instanceof SkillInstallError) || e.code !== 'source-not-found') throw e }
      }
      if (!ref) fail('source-not-found', 'GitHub branch or tag was not found.')
    }
    if (!ref) ref = String((await this.json(endpoint, signal)).default_branch || '')
    if (!ref) fail('invalid-source', 'GitHub repository has no default branch.')
    const commit = await this.json(`${endpoint}/commits/${encodeURIComponent(ref)}`, signal)
    if (!/^[a-f0-9]{40,64}$/i.test(commit.sha)) fail('invalid-source', 'GitHub did not return an exact commit.')
    if (path?.endsWith('/SKILL.md') || path === 'SKILL.md') path = path === 'SKILL.md' ? '.' : path.slice(0, -9)
    if (path) safeRelative(path)
    const archive = await this.fetchBytes(`${endpoint}/zipball/${commit.sha}`, this.limits.downloadBytes, signal)
    await this.unpack(archive, 'zip', tree, true, signal)
    return { kind: 'github', identity: `https://github.com/${owner.toLowerCase()}/${repo.toLowerCase()}`, requested: `https://github.com/${owner}/${repo}`, requestedRef: request.ref || (parts.length > 2 ? ref : undefined), resolvedCommit: commit.sha, path }
  }
  private async npm(raw: string, request: SkillSourceInput, tree: string, signal?: AbortSignal): Promise<ResolvedSkillSource> {
    const match = /^npm:((?:@[a-z0-9._-]+\/)?[a-z0-9._-]+)(?:@(.+))?$/i.exec(raw)
    if (!match || request.ref) fail('invalid-source', 'Use npm:package@version, tag, or semver range.')
    const name = match![1], spec = match![2] || 'latest', metadata = await this.json('https://registry.npmjs.org/' + encodeURIComponent(name), signal)
    const versions = metadata.versions || {}, tagged = metadata['dist-tags']?.[spec]
    const version = tagged || (valid(spec) ? spec : validRange(spec) ? maxSatisfying(Object.keys(versions), spec) : null)
    const pkg = version && versions[version]
    if (!pkg || pkg.name !== name || pkg.version !== version || !pkg.dist?.tarball) fail('source-not-found', 'Requested npm package version was not found.')
    const bytes = await this.fetchBytes(pkg.dist.tarball, this.limits.downloadBytes, signal)
    let integrity = pkg.dist.integrity as string | undefined
    if (integrity) {
      const supported = integrity.split(/\s+/).map(value => /^(sha512|sha384|sha256)-([A-Za-z0-9+/]+={0,2})$/.exec(value)).filter(Boolean) as RegExpExecArray[]
      if (!supported.length || !supported.some(entry => createHash(entry[1]).update(bytes).digest('base64') === entry[2])) fail('integrity', 'npm package integrity verification failed.')
    } else if (/^[a-f0-9]{40}$/i.test(pkg.dist.shasum || '')) {
      if (createHash('sha1').update(bytes).digest('hex') !== pkg.dist.shasum.toLowerCase()) fail('integrity', 'npm package checksum verification failed.')
      integrity = 'sha1-' + createHash('sha1').update(bytes).digest('base64')
    } else fail('integrity', 'npm package has no supported integrity checksum.')
    await this.unpack(bytes, 'tar', tree, true, signal)
    return { kind: 'npm', identity: 'npm:' + name, requested: raw, requestedVersion: spec, version, integrity, path: request.path }
  }
  private async unpack(bytes: Buffer, kind: 'zip' | 'tar', root: string, stripRoot: boolean, signal?: AbortSignal) {
    await fs.mkdir(root)
    const names = new Set<string>(); let total = 0, count = 0, prefix: string | undefined
    const pathFor = (raw: string, directory: boolean) => {
      const clean = raw.replace(/\/$/, ''), safe = safeRelative(clean), parts = safe.split('/')
      if (stripRoot) { if (!prefix) prefix = parts[0]; if (prefix !== parts[0]) fail('unsafe-path', 'Archive has multiple package roots.'); parts.shift() }
      if (!parts.length) { if (!directory) fail('unsafe-path', 'Archive root must be a directory.'); return null }
      const path = parts.join('/'); if (parts.length > this.limits.depth) fail('limit', 'Archive nesting exceeds the installation limit.')
      if (parts.includes('.git')) return null
      const key = path.normalize('NFC').toLowerCase(); if (names.has(key)) fail('unsafe-path', 'Archive contains duplicate or conflicting entries.'); names.add(key)
      if (++count > this.limits.files) fail('limit', 'Archive has too many entries.')
      return join(root, path)
    }
    const write = async (raw: string, directory: boolean, mode: number, content: Buffer) => {
      checkAbort(signal); const dest = pathFor(raw, directory); if (!dest) return
      total += content.length; if (total > this.limits.unpackedBytes) fail('limit', 'Unpacked archive exceeds the installation limit.')
      if (directory) await fs.mkdir(dest, { recursive: true })
      else { await fs.mkdir(dirname(dest), { recursive: true }); await fs.writeFile(dest, content, { flag: 'wx', mode: (mode & 0o777) || 0o644 }) }
    }
    if (kind === 'zip') {
      const zip = new AdmZip(bytes)
      for (const entry of zip.getEntries()) {
        checkAbort(signal); const mode = entry.attr >>> 16, type = mode & 0o170000
        if (type && type !== 0o100000 && type !== 0o040000) fail('unsafe-path', 'Archive links and special files are unsupported.')
        if (total + entry.header.size > this.limits.unpackedBytes) fail('limit', 'Unpacked archive exceeds the installation limit.')
        await write(entry.entryName, entry.isDirectory, mode, entry.isDirectory ? Buffer.alloc(0) : entry.getData())
      }
      return
    }
    // Parse instead of extracting: all output paths and types are checked before writing.
    const pending: Promise<void>[] = []; let parseError: unknown, declaredSize = 0, declaredCount = 0
    const parser = new Parser({ onReadEntry: entry => {
      if (parseError) { entry.resume(); return }
      if (!['File', 'OldFile', 'Directory'].includes(entry.type)) { parseError = new SkillInstallError('unsafe-path', 'Archive links and special files are unsupported.'); entry.resume(); return }
      declaredSize += entry.size; declaredCount++
      if (declaredSize > this.limits.unpackedBytes || declaredCount > this.limits.files) { parseError = new SkillInstallError('limit', 'Unpacked archive exceeds the installation limit.'); entry.resume(); return }
      const task = (async () => { const chunks: Buffer[] = []; let size = 0; for await (const chunk of entry) { checkAbort(signal); size += chunk.length; if (size > this.limits.unpackedBytes) fail('limit', 'Archive entry exceeds the installation limit.'); chunks.push(Buffer.from(chunk)) }; await write(entry.path, entry.type === 'Directory', entry.mode || 0o644, Buffer.concat(chunks)) })().catch(e => { parseError = e })
      pending.push(task)
    } })
    await new Promise<void>((resolveParse, reject) => { parser.on('error', reject); parser.on('end', resolveParse); Readable.from(bytes).pipe(parser) })
    await Promise.all(pending); if (parseError) throw parseError
  }
  private async candidates(root: string, rows: FileRow[], path?: string): Promise<SkillCandidate[]> {
    const subpath = path ? safeRelative(path) : '.'; const result: SkillCandidate[] = []
    let manifest: any
    if (await exists(join(root, 'package.json'))) { try { manifest = JSON.parse(await fs.readFile(join(root, 'package.json'), 'utf8')).pi } catch { fail('invalid-package', 'Package manifest is invalid.') } }
    // Manifest paths remain package-relative; only its skills resources are candidates.
    const allowed = Array.isArray(manifest?.skills) ? manifest.skills as string[] : undefined
    const patternMatches = (pattern: string, file: string): boolean => {
      const normalized = pattern.replace(/^\.\//, '').replace(/\/$/, '')
      if (normalized.includes('..') || isAbsolute(normalized)) fail('invalid-package', 'Pi skill resource path escapes its package.')
      return minimatch(file, normalized) || minimatch(dirname(file).split(sep).join('/'), normalized) || (!/[?*\[\]{}]/.test(normalized) && file.startsWith(normalized + '/'))
    }
    for (const row of rows) {
      if (row.directory || basename(row.path) !== 'SKILL.md' || (!allowed && row.path.split('/').some(piece => piece === 'node_modules' || piece.startsWith('.')))) continue
      const dir = dirname(row.path).split(sep).join('/')
      if (subpath !== '.' && dir !== subpath && !dir.startsWith(subpath + '/')) continue
      if (allowed && (!allowed.some(p => !p.startsWith('!') && patternMatches(p, row.path)) || allowed.some(p => p.startsWith('!') && patternMatches(p.slice(1), row.path)))) continue
      const text = await fs.readFile(join(root, row.path), 'utf8'), front = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)
      if (!front) continue
      let data: any; try { data = parseYaml(front[1]) } catch { continue }
      if (typeof data?.name !== 'string' || typeof data?.description !== 'string' || !data.name.trim() || !data.description.trim()) continue
      result.push({ name: data.name.trim(), description: data.description.trim(), path: dir })
    }
    return result.sort((a, b) => a.path.localeCompare(b.path))
  }
}
