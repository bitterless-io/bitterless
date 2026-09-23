import { assertSkillFilePath, canReadSkillPath, withSkillFileAccess } from '@maestro-main/skills/skillFileAccess.service'
import type { BrowserWindow } from 'electron'
import { dialog, shell } from 'electron'
import type { OpenDialogOptions } from 'electron'
import { createXpcMainEmitter, xpcMain } from 'electron-xpc/main'
import { homedir } from 'os'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'path'
import { existsSync, mkdirSync, realpathSync, statSync, writeFileSync, type Dirent } from 'fs'
import { readdir, readFile as readFileAsync, stat as statAsync } from 'fs/promises'
import { injectable } from 'inversify'
import { maestroDataRoot } from '@maestro-main/data/maestroDataRoot'
import { FileReadError } from '@maestro-main/files/fileReader.service'
import { readDocumentForAgent } from '@maestro-main/files/documentReader.service'
import {
  mdDirLink,
  WorkspaceArchiveService,
  type WorkspacePathResolution
} from '@maestro-main/files/workspaceArchive.service'
import { writeArtifactFromJson } from '@maestro-main/files/artifactWriter.service'
import { ensureDefaultWorkspace } from '@maestro-main/files/defaultWorkspace'
import type { AgentFileArtifact, FileStatusResult, WorkspaceRef, WorkspaceRefResult } from '@maestro-shared/coach.api'
import {
  WORKSPACE_CONFIG_DOMAIN,
  WORKSPACE_DEFAULT_KEY,
  type ConfigApi
} from '@maestro-shared/config.api'
import { CommonService } from '@maestro-shared/iocHelper/ioc.helper'
import { getMaestroPreviewOpener } from './previewOpener.registry'

const WORKSPACE_TEXT_SCAN_BYTES = 256 * 1024
const WORKSPACE_SEARCH_MAX_RESULTS = 60
const WORKSPACE_SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'out',
  'dist',
  'build',
  '.next',
  '.nuxt',
  'coverage',
  '.turbo',
  '.cache'
])

const WORKSPACE_TEXT_EXTS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.vue',
  '.svelte',
  '.css',
  '.less',
  '.scss',
  '.html',
  '.md',
  '.markdown',
  '.txt',
  '.json',
  '.jsonl',
  '.yaml',
  '.yml',
  '.xml',
  '.csv',
  '.tsv',
  '.sql',
  '.sh',
  '.zsh',
  '.env',
  '.gitignore'
])

interface WorkspaceSearchHit {
  path: string
  name: string
  kind: 'name' | 'content'
  line?: number
  preview?: string
  matches?: string[]
}

const isInsideRoot = (root: string, path: string): boolean => {
  const rel = relative(root, path)
  return rel === '' || (!!rel && !rel.startsWith('..') && !isAbsolute(rel))
}

const nearestExistingAncestor = (path: string): string => {
  let current = path
  while (!existsSync(current)) {
    const parent = dirname(current)
    if (parent === current) return current
    current = parent
  }
  return current
}

const isPermissionError = (err: unknown): boolean => {
  const code = (err as NodeJS.ErrnoException | undefined)?.code
  return code === 'EPERM' || code === 'EACCES'
}

const FOLDER_AUTH_HINT =
  process.platform === 'darwin'
    ? ' macOS is protecting this folder — approve the permission prompt if it appears, or grant access under System Settings › Privacy & Security › Files and Folders (or Full Disk Access), then ask me to try again.'
    : ''

const READ_SEARCH_MAX_DEPTH = 8
const READ_SEARCH_MAX_DIRS = 4000
const READ_SEARCH_BUDGET_MS = 20_000

const workspaceNameForPath = (path: string): string => basename(path) || path

const fileExtension = (path: string): string => {
  const name = basename(path)
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot).toLowerCase() : name.toLowerCase()
}

const workspaceSearchTerms = (query: string): string[] =>
  Array.from(
    new Set(
      query
        .toLowerCase()
        .split(/[\s/\\:.#"'`()[\]{}<>|,;=+*&!?]+/)
        .map((term) => term.trim())
        .filter(Boolean)
    )
  ).slice(0, 12)

const workspaceTextMatches = (text: string, terms: string[]): boolean => {
  const haystack = text.toLowerCase()
  return terms.every((term) => haystack.includes(term))
}

export interface WorkspaceFileServiceState {
  browserWindow: BrowserWindow | null
  agentSessionKey(sessionId?: string): string
  recordAgentArtifact(artifact: AgentFileArtifact): void
}

const configStore = createXpcMainEmitter<ConfigApi>('ConfigDao')


@injectable()
export class WorkspaceFileService extends CommonService<WorkspaceFileServiceState> {
  private workspaceRefs = new Map<string, WorkspaceRef>()
  private defaultWorkspaceWrites: Promise<void> = Promise.resolve()
  private readonly workspaceArchive = new WorkspaceArchiveService({
    resolveWorkspacePath: (sessionKey, pathArg) =>
      this.resolveWorkspacePath(sessionKey, pathArg),
    resolveReadPath: (sessionKey, pathArg) => this.resolveReadPath(sessionKey, pathArg)
  })

  async chooseWorkspaceDirectory(params?: { sessionId?: string }): Promise<WorkspaceRefResult> {
    const options: OpenDialogOptions = {
      title: 'Choose workspace',
      properties: ['openDirectory', 'createDirectory']
    }
    const result = this._state.browserWindow
      ? await dialog.showOpenDialog(this._state.browserWindow, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths[0]) return { ok: false, error: 'cancelled' }
    const bound = await this.setWorkspaceDirectory({ sessionId: params?.sessionId, path: result.filePaths[0] })
    if (!bound.ok || !bound.workspace?.path) return bound
    // The picker is a human choice; set/get also serve restoration and must not open Preview.
    const preview = getMaestroPreviewOpener()
    if (!preview) return { ...bound, previewError: 'unavailable' }
    try {
      await preview.open(bound.workspace.path)
      return bound
    } catch {
      return { ...bound, previewError: 'open-failed' }
    }
  }

  async adoptPreviewWorkspaceDirectory(params: { sessionId: string }): Promise<WorkspaceRefResult> {
    const path = getMaestroPreviewOpener()?.currentProjectDirectory?.()
    if (!path) return { ok: true }
    return this.setWorkspaceDirectory({ sessionId: params.sessionId, path }, false)
  }

  // Undo an adoption its renderer fenced. Compare-and-release: only drops the binding while it is
  // still exactly what adoption set, so a newer explicit choice for the same session is never
  // clobbered. The remembered default is a separate concern and stays untouched.
  async releaseWorkspaceBinding(params: { sessionId: string; path: string }): Promise<{ ok: true }> {
    const key = this._state.agentSessionKey(params.sessionId)
    if (this.workspaceRefs.get(key)?.path === params.path) this.clearWorkspaceRef(key)
    return { ok: true }
  }

  // Login adoption commits in its renderer only after checking its account/selection generation.
  // The service-only flag suppresses both broadcasts and preserves an existing binding if its
  // Preview candidate disappeared. Ordinary setters keep their existing behavior.
  async setWorkspaceDirectory(params: { sessionId?: string; path?: string }, notify = true): Promise<WorkspaceRefResult> {
    const key = this._state.agentSessionKey(params.sessionId)
    const raw = String(params.path || '').trim()
    if (!raw) {
      this.clearWorkspaceRef(key)
      await this.persistDefaultWorkspace()
      return { ok: true }
    }
    const abs = resolve(raw)
    try {
      const stats = statSync(abs)
      if (!stats.isDirectory()) return { ok: false, error: 'not-a-directory' }
    } catch {
      if (!notify) return { ok: false, missing: true, error: 'workspace-not-found' }
      this.clearWorkspaceRef(key)
      await this.removeDefaultWorkspaceIfPathMatches(abs)
      return { ok: false, missing: true, error: 'workspace-not-found' }
    }
    const workspace = this.workspaceRefFromPath(abs)
    this.workspaceRefs.set(key, workspace)
    this.workspaceRefs.set('default', workspace)
    await this.persistDefaultWorkspace(workspace, notify)
    if (notify) this.broadcastWorkspaceChanged(key, workspace)
    return { ok: true, workspace }
  }

  async getWorkspaceDirectory(params?: { sessionId?: string }): Promise<WorkspaceRefResult> {
    const key = this._state.agentSessionKey(params?.sessionId)
    let workspace = this.workspaceRefs.get(key)
    if (!workspace && key === 'default') {
      workspace = await this.readDefaultWorkspace()
      if (workspace) this.workspaceRefs.set('default', workspace)
    }
    if (!workspace) return { ok: true }
    try {
      const stats = statSync(workspace.path)
      if (!stats.isDirectory()) {
        this.clearWorkspaceRef(key)
        await this.removeDefaultWorkspaceIfPathMatches(workspace.path)
        return { ok: false, missing: true, error: 'workspace-not-directory' }
      }
    } catch {
      this.clearWorkspaceRef(key)
      await this.removeDefaultWorkspaceIfPathMatches(workspace.path)
      return { ok: false, missing: true, error: 'workspace-not-found' }
    }
    // A read reports; it does not announce. This used to stamp a fresh `updatedAt`, persist it and
    // broadcast it as a change on EVERY call, which makes every reader look like a writer: any
    // subscriber that refetches on the notification closes a feedback loop and re-announces the same
    // unchanged workspace. Cowork had a caller that closed exactly that loop; this side never did,
    // which is luck rather than design (docs/issues/workspace-read-announces-a-change.md).
    const fresh = { ...workspace, exists: true }
    this.workspaceRefs.set(key, fresh)
    return { ok: true, workspace: fresh }
  }

  async getFileStatuses(params: { paths: string[] }): Promise<FileStatusResult[]> {
    return (params.paths || []).map((raw) => {
      const abs = resolve(String(raw || ''))
      try {
        const stats = statSync(abs)
        return {
          path: abs,
          exists: true,
          isFile: stats.isFile(),
          isDirectory: stats.isDirectory(),
          size: stats.size
        }
      } catch {
        return {
          path: abs,
          exists: false,
          isFile: false,
          isDirectory: false,
          error: 'not-found'
        }
      }
    })
  }

  async openFile(params: { path: string }): Promise<{ ok: boolean; path?: string; error?: string }> {
    const abs = resolve(String(params.path || ''))
    if (!abs || !existsSync(abs)) return { ok: false, path: abs, error: 'not-found' }
    const error = await shell.openPath(abs)
    return error ? { ok: false, path: abs, error } : { ok: true, path: abs }
  }

  async showFileInFolder(params: { path: string }): Promise<{ ok: boolean; path?: string; error?: string }> {
    const abs = resolve(String(params.path || ''))
    if (!abs || !existsSync(abs)) return { ok: false, path: abs, error: 'not-found' }
    shell.showItemInFolder(abs)
    return { ok: true, path: abs }
  }

  /** Explicit per-session project binding only; no default-directory creation or broadcasts. */
  projectRootForSession(sessionKey: string): string | undefined {
    return this.workspaceRefs.get(sessionKey)?.path
  }

  syncWorkspaceFromContext(sessionKey: string, workspace?: WorkspaceRef): void {
    if (!workspace?.path) return
    const current = this.workspaceRefs.get(sessionKey)
    if (current?.path === workspace.path) return
    const abs = resolve(workspace.path)
    try {
      if (!statSync(abs).isDirectory()) return
      this.workspaceRefs.set(sessionKey, {
        path: abs,
        name: workspaceNameForPath(abs),
        exists: true,
        updatedAt: Date.now()
      })
    } catch {
      this.clearWorkspaceRef(sessionKey)
    }
  }

  private workspaceRefFromPath(path: string): WorkspaceRef {
    const abs = resolve(path)
    return {
      path: abs,
      name: workspaceNameForPath(abs),
      exists: true,
      updatedAt: Date.now()
    }
  }

  private async readDefaultWorkspace(): Promise<WorkspaceRef | undefined> {
    const path = await this.readDefaultWorkspacePath()
    if (!path) return undefined
    const abs = resolve(path)
    try {
      if (!statSync(abs).isDirectory()) {
        await this.removeDefaultWorkspaceIfPathMatches(abs)
        return undefined
      }
      return this.workspaceRefFromPath(abs)
    } catch {
      await this.removeDefaultWorkspaceIfPathMatches(abs)
      return undefined
    }
  }

  private async readDefaultWorkspacePath(): Promise<string> {
    const entry = await configStore
      .get({ domain: WORKSPACE_CONFIG_DOMAIN, key: WORKSPACE_DEFAULT_KEY })
      .catch(() => null)
    const options = entry?.options as Partial<WorkspaceRef> | null | undefined
    return typeof options?.path === 'string' ? options.path : ''
  }

  private async persistDefaultWorkspace(workspace?: WorkspaceRef, notify = true): Promise<void> {
    const normalized = workspace?.path ? this.workspaceRefFromPath(workspace.path) : undefined
    // Edge-triggered for the same reason as `clearWorkspaceRef`: the value listeners care about is
    // the path, so re-announcing an identical one is noise a re-checking listener can loop on.
    const changed = this.workspaceRefs.get('default')?.path !== normalized?.path
    if (normalized) this.workspaceRefs.set('default', normalized)
    else this.workspaceRefs.delete('default')
    // A later explicit choice/clear must be the final durable value even if adoption is still saving.
    const write = this.defaultWorkspaceWrites.then(async () => {
      if (normalized) {
        await configStore.upsert({ domain: WORKSPACE_CONFIG_DOMAIN, key: WORKSPACE_DEFAULT_KEY, options: normalized }).catch(() => undefined)
      } else {
        await configStore.remove({ domain: WORKSPACE_CONFIG_DOMAIN, key: WORKSPACE_DEFAULT_KEY }).catch(() => undefined)
      }
    })
    // The chain only orders writes; a failed one must not stop every later write from running.
    this.defaultWorkspaceWrites = write.catch(() => undefined)
    await write
    if (notify && changed && this.workspaceRefs.get('default') === normalized) this.broadcastWorkspaceChanged('default', normalized)
  }

  private async removeDefaultWorkspaceIfPathMatches(path?: string): Promise<void> {
    const target = path ? resolve(path) : ''
    const currentPath = this.workspaceRefs.get('default')?.path || (await this.readDefaultWorkspacePath())
    if (!currentPath || (target && resolve(currentPath) !== target)) return
    await this.persistDefaultWorkspace()
  }

  /**
   * The root this session actually works in: its explicit binding, else the ONE shared default
   * workspace (ensured here). Owner decision 2026-09-10 — see
   * docs/features/maestro-default-workspace.md.
   */
  private effectiveWorkspaceRoot(sessionKey: string): string {
    const workspace = this.workspaceRefs.get(sessionKey)
    return workspace ? resolve(workspace.path) : ensureDefaultWorkspace()
  }

  private resolveWorkspacePath(sessionKey: string, pathArg: string): WorkspacePathResolution {
    const workspace = this.workspaceRefs.get(sessionKey)
    // Nothing bound is not an error: the shared default workspace answers, ensured on the way in.
    // Only an EXPLICIT reference can go stale, so only that one is cleared below.
    const root = workspace ? resolve(workspace.path) : ensureDefaultWorkspace()
    let realRoot = root
    try {
      if (!statSync(root).isDirectory()) {
        if (workspace) this.clearWorkspaceRef(sessionKey)
        return { ok: false, root, error: 'workspace-not-found' }
      }
      realRoot = realpathSync(root)
    } catch {
      if (workspace) this.clearWorkspaceRef(sessionKey)
      return { ok: false, root, error: 'workspace-not-found' }
    }
    const cleaned = pathArg.trim().replace(/^@/, '')
    const target = cleaned ? (isAbsolute(cleaned) ? resolve(cleaned) : resolve(root, cleaned)) : root
    if (!canReadSkillPath(maestroDataRoot(), target)) return { ok: false, root, error: 'skill-scope-unavailable' }
    if (!isInsideRoot(root, target)) return { ok: false, root, error: 'outside-workspace' }
    try {
      const existing = nearestExistingAncestor(target)
      const realExisting = realpathSync(existing)
      if (!isInsideRoot(realRoot, realExisting)) {
        return { ok: false, root, realRoot, error: 'outside-workspace' }
      }
    } catch {
      return { ok: false, root, realRoot, error: 'workspace-path-unavailable' }
    }
    return { ok: true, root, realRoot, path: target, rel: relative(root, target) || '.' }
  }

  private resolveReadPath(
    sessionKey: string,
    pathArg: string,
    skipSkillGate = false
  ): { path: string; root: string; insideWorkspace: boolean } {
    let cleaned = String(pathArg || '').trim().replace(/^@/, '')
    if (cleaned === '~') cleaned = homedir()
    else if (cleaned.startsWith('~/') || cleaned.startsWith('~\\')) {
      cleaned = join(homedir(), cleaned.slice(2))
    }
    // Same base as the write tools (explicit binding, else the shared default). It used to be
    // `homedir()` when nothing was bound, so an agent could write notes.md and then fail to read it
    // back by that name.
    const base = this.effectiveWorkspaceRoot(sessionKey)
    const path = !cleaned ? base : isAbsolute(cleaned) ? resolve(cleaned) : resolve(base, cleaned)
    const insideWorkspace = isInsideRoot(base, path)
    const root = insideWorkspace ? base : path
    if (!skipSkillGate) assertSkillFilePath(maestroDataRoot(), path)
    return { path, root, insideWorkspace }
  }

  private agentEntryPath(
    resolved: { root: string; insideWorkspace: boolean },
    abs: string
  ): string {
    return resolved.insideWorkspace ? relative(resolved.root, abs) || basename(abs) : abs
  }


  private broadcastWorkspaceChanged(sessionId: string, workspace?: WorkspaceRef): void {
    xpcMain.broadcast('coach/workspace-changed', {
      sessionId,
      workspace,
      ts: Date.now()
    })
  }

  // Edge-triggered: clearing what is already clear is not a change, and announcing it anyway lets
  // any caller that re-checks in response repeat the "transition" forever.
  private clearWorkspaceRef(sessionId: string): void {
    if (!this.workspaceRefs.delete(sessionId)) return
    this.broadcastWorkspaceChanged(sessionId)
  }

  async toolReadFile(sessionKey: string, pathArg: string, options: { offset?: number; limit?: number }): Promise<string> {
    const target = this.resolveReadPath(sessionKey, pathArg || '', true).path
    return await withSkillFileAccess(maestroDataRoot(), target, () => this.toolReadFileInScope(sessionKey, pathArg, options))
  }

  private async toolReadFileInScope(
    sessionKey: string,
    pathArg: string,
    options: { offset?: number; limit?: number }
  ): Promise<string> {
    const trimmed = pathArg.trim().replace(/^@/, '')
    if (!trimmed) {
      return 'ERROR: read_file needs a "path" (an attached @/abs/path, an absolute path, or a workspace-relative path).'
    }
    const target = this.resolveReadPath(sessionKey, trimmed).path
    try {
      const stats = statSync(target)
      if (stats.isDirectory()) {
        return `ERROR: "${pathArg}" is a folder, not a file. Use list_workspace_files with path "${target}" to see what is inside (or search_files to find something in it), then read_file the individual files it reports.`
      }
      if (!stats.isFile()) return `ERROR: "${pathArg}" is not a file.`
      // `readDocumentForAgent` 而不是 `readFileForAgent`:它在后者外面套了全文缓存 + 翻页
      // (docs/features/maestro-large-file-chunked-read.md #3)。没有它,offset/limit 只能在
      // 一份已经被截断的正文上翻,翻不到后面的内容。
      const result = await readDocumentForAgent(target, options)
      assertSkillFilePath(maestroDataRoot(), target)
      return result.text
    } catch (err) {
      if (err instanceof FileReadError) return `ERROR: ${err.message}`
      if (isPermissionError(err)) {
        return `ERROR: no permission to read "${trimmed}".${FOLDER_AUTH_HINT}`
      }
      return `ERROR: could not read "${trimmed}": ${err instanceof Error ? err.message : String(err)}`
    }
  }

  async toolListArchive(
    sessionKey: string,
    pathArg: string,
    password?: string
  ): Promise<string> {
    return await this.workspaceArchive.toolListArchive(sessionKey, pathArg, password)
  }

  async toolExtractArchive(
    sessionKey: string,
    pathArg: string,
    destArg?: string,
    password?: string
  ): Promise<string> {
    return await this.workspaceArchive.toolExtractArchive(
      sessionKey,
      pathArg,
      destArg,
      password
    )
  }

  async toolCreateArchive(
    sessionKey: string,
    archiveArg: string,
    inputsArg: string,
    password?: string
  ): Promise<string> {
    return await this.workspaceArchive.toolCreateArchive(
      sessionKey,
      archiveArg,
      inputsArg,
      password
    )
  }

  async toolListWorkspaceFiles(sessionKey: string, pathArg?: string, maxEntriesArg?: number): Promise<string> {
    const target = this.resolveReadPath(sessionKey, pathArg || '', true).path
    return await withSkillFileAccess(maestroDataRoot(), target, () => this.toolListWorkspaceFilesInScope(sessionKey, pathArg, maxEntriesArg))
  }

  private async toolListWorkspaceFilesInScope(
    sessionKey: string,
    pathArg?: string,
    maxEntriesArg?: number
  ): Promise<string> {
    const resolved = this.resolveReadPath(sessionKey, String(pathArg || ''))
    try {
      const stats = await statAsync(resolved.path)
      if (!stats.isDirectory()) return `ERROR: "${resolved.path}" is not a directory.`
      const maxEntries = Math.max(1, Math.min(300, Math.round(maxEntriesArg || 120)))
      const entries = (await readdir(resolved.path, { withFileTypes: true }))
        .filter((entry) => canReadSkillPath(maestroDataRoot(), join(resolved.path, entry.name)))
        .filter((entry) => !entry.isDirectory() || !WORKSPACE_SKIP_DIRS.has(entry.name))
        .slice(0, maxEntries)
        .map((entry) => ({
          name: entry.name,
          path: this.agentEntryPath(resolved, join(resolved.path, entry.name)),
          type: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other'
        }))
      return JSON.stringify({ ok: true, root: resolved.root, dir: resolved.path, entries }, null, 2)
    } catch (err) {
      if (isPermissionError(err)) {
        return `ERROR: no permission to list "${resolved.path}".${FOLDER_AUTH_HINT}`
      }
      return `ERROR: could not list "${resolved.path}": ${err instanceof Error ? err.message : String(err)}`
    }
  }

  async toolSearchWorkspaceFiles(sessionKey: string, queryArg: string, pathArg?: string, maxResultsArg?: number): Promise<string> {
    const target = this.resolveReadPath(sessionKey, pathArg || '', true).path
    return await withSkillFileAccess(maestroDataRoot(), target, () => this.toolSearchWorkspaceFilesInScope(sessionKey, queryArg, pathArg, maxResultsArg))
  }

  private async toolSearchWorkspaceFilesInScope(
    sessionKey: string,
    queryArg: string,
    pathArg?: string,
    maxResultsArg?: number
  ): Promise<string> {
    const query = String(queryArg || '').trim()
    if (!query) {
      return await this.toolListWorkspaceFiles(sessionKey, String(pathArg || ''), maxResultsArg)
    }
    const terms = workspaceSearchTerms(query)
    if (!terms.length) {
      return await this.toolListWorkspaceFiles(sessionKey, String(pathArg || ''), maxResultsArg)
    }
    const resolved = this.resolveReadPath(sessionKey, String(pathArg || ''))
    try {
      if (!(await statAsync(resolved.path)).isDirectory()) {
        return `ERROR: "${resolved.path}" is not a directory.`
      }
    } catch (err) {
      if (isPermissionError(err)) {
        return `ERROR: no permission to search "${resolved.path}".${FOLDER_AUTH_HINT}`
      }
      return `ERROR: could not search "${resolved.path}": ${err instanceof Error ? err.message : String(err)}`
    }
    const maxResults = Math.max(
      1,
      Math.min(
        WORKSPACE_SEARCH_MAX_RESULTS,
        Math.round(maxResultsArg || WORKSPACE_SEARCH_MAX_RESULTS)
      )
    )
    const deadline = Date.now() + READ_SEARCH_BUDGET_MS
    const hits: WorkspaceSearchHit[] = []
    let dirsVisited = 0
    let permissionBlocked = false
    let timedOut = false
    const pushHit = (hit: WorkspaceSearchHit): void => {
      if (hits.length >= maxResults) return
      hits.push({ ...hit, matches: terms })
    }
    const visit = async (dir: string, depth: number): Promise<void> => {
      if (!canReadSkillPath(maestroDataRoot(), dir)) return
      if (hits.length >= maxResults || dirsVisited >= READ_SEARCH_MAX_DIRS || timedOut) return
      if (Date.now() > deadline) {
        timedOut = true
        return
      }
      dirsVisited += 1
      let entries: Dirent[]
      try {
        entries = await readdir(dir, { withFileTypes: true })
      } catch (err) {
        if (isPermissionError(err)) permissionBlocked = true
        return
      }
      for (const entry of entries) {
        if (hits.length >= maxResults || timedOut) break
        if (Date.now() > deadline) {
          timedOut = true
          break
        }
        const abs = join(dir, entry.name)
        if (!canReadSkillPath(maestroDataRoot(), abs)) continue
        const rel = relative(resolved.root, abs)
        const agentPath = this.agentEntryPath(resolved, abs)
        if (entry.isDirectory()) {
          if (depth < READ_SEARCH_MAX_DEPTH && !WORKSPACE_SKIP_DIRS.has(entry.name)) {
            await visit(abs, depth + 1)
          }
          continue
        }
        if (!entry.isFile()) continue
        if (workspaceTextMatches(`${entry.name}\n${rel}`, terms)) {
          pushHit({ path: agentPath, name: entry.name, kind: 'name' })
          if (hits.length >= maxResults) break
        }
        const extension = fileExtension(entry.name)
        if (!WORKSPACE_TEXT_EXTS.has(extension)) continue
        try {
          const stats = await statAsync(abs)
          if (stats.size > WORKSPACE_TEXT_SCAN_BYTES) continue
          const lines = (await readFileAsync(abs, 'utf8')).split(/\r?\n/)
          if (!canReadSkillPath(maestroDataRoot(), abs)) continue
          const index = lines.findIndex((line) => workspaceTextMatches(line, terms))
          if (index >= 0) {
            pushHit({
              path: agentPath,
              name: entry.name,
              kind: 'content',
              line: index + 1,
              preview: lines[index].trim().slice(0, 220)
            })
          }
        } catch {
          // Skip unreadable files.
        }
      }
    }
    await visit(resolved.path, 0)
    const notes: string[] = []
    if (permissionBlocked) {
      notes.push(`Some subfolders were skipped for lack of permission.${FOLDER_AUTH_HINT}`)
    }
    if (timedOut) {
      notes.push(
        `Search stopped after ${Math.round(READ_SEARCH_BUDGET_MS / 1000)}s — narrow the path or query for complete results.`
      )
    }
    const note = notes.length ? notes.join(' ') : undefined
    return JSON.stringify(
      { ok: true, root: resolved.path, query, terms, results: hits, ...(note ? { note } : {}) },
      null,
      2
    )
  }

  toolWriteWorkspaceFile(sessionKey: string, pathArg: string, contentArg: string): string {
    const resolved = this.resolveWorkspacePath(sessionKey, String(pathArg || ''))
    if (!resolved.ok || !resolved.path) {
      return `ERROR: ${resolved.error || 'workspace unavailable'}`
    }
    if (resolved.path === resolved.root) {
      return 'ERROR: write_file needs a file path under the workspace, not the workspace directory itself.'
    }
    try {
      if (existsSync(resolved.path) && statSync(resolved.path).isDirectory()) {
        return `ERROR: "${resolved.rel}" is a directory. write_file can only create or update files.`
      }
      const parent = dirname(resolved.path)
      if (!isInsideRoot(resolved.root, parent)) {
        return 'ERROR: target directory is outside the workspace.'
      }
      const existed = existsSync(resolved.path)
      mkdirSync(parent, { recursive: true })
      writeFileSync(resolved.path, String(contentArg ?? ''), 'utf8')
      const stats = statSync(resolved.path)
      const artifact: AgentFileArtifact = {
        name: basename(resolved.path),
        path: resolved.path,
        action: existed ? 'updated' : 'created',
        size: stats.size
      }
      this._state.recordAgentArtifact(artifact)
      return JSON.stringify({ ok: true, file: artifact }, null, 2)
    } catch (err) {
      return `ERROR: could not write "${resolved.rel || pathArg}": ${err instanceof Error ? err.message : String(err)}`
    }
  }

  async toolCreateArtifact(sessionKey: string, artifactJson: string): Promise<string> {
    const workspace = this.resolveWorkspacePath(sessionKey, '')
    const workspaceRoot = workspace.ok ? workspace.root : undefined
    const result = await writeArtifactFromJson({
      userDataPath: maestroDataRoot(),
      sessionKey,
      workspaceRoot,
      artifactJson
    })
    if (!result.ok || !result.path) {
      return `ERROR: ${result.error || 'could not create artifact'}`
    }
    const artifact: AgentFileArtifact = {
      name: result.name || basename(result.path),
      path: result.path,
      action: result.action || 'created',
      size: result.size
    }
    this._state.recordAgentArtifact(artifact)
    return JSON.stringify(
      {
        ok: true,
        file: artifact,
        type: result.type,
        output_root: result.root,
        workspace: workspace.ok ? workspace.root : null
      },
      null,
      2
    )
  }

  async toolOpenWorkspaceFolder(sessionKey: string, pathArg?: string): Promise<string> {
    const rel = String(pathArg || '').trim().replace(/^@/, '')
    const resolved = this.resolveWorkspacePath(sessionKey, rel)
    if (!resolved.ok || !resolved.path) {
      return `ERROR: ${resolved.error || 'workspace unavailable'}`
    }
    const target = resolved.path
    if (!existsSync(target)) {
      return `ERROR: "${rel || '.'}" does not exist inside the workspace (${resolved.root}).`
    }
    try {
      // Showing the owner some files is what this tool is for, and this build has an application
      // that does that better than the OS file manager. The file manager stays the fallback for a
      // build with no preview application registered — which is what this tool did before one
      // existed. A registered opener that *fails* is reported, not silently swapped for Finder:
      // opening the wrong application is more confusing than an error.
      const preview = getMaestroPreviewOpener()
      if (preview) {
        await preview.open(target)
        return `Opened ${mdDirLink(target)} in ${preview.displayName}.`
      }
      if (statSync(target).isDirectory()) {
        const error = await shell.openPath(target)
        if (error) return `ERROR: could not open "${target}": ${error}`
        return `Opened ${mdDirLink(target)} in the file manager.`
      }
      shell.showItemInFolder(target)
      return `Revealed ${mdDirLink(target)} in the file manager.`
    } catch (err) {
      if (isPermissionError(err)) {
        return `ERROR: no permission to open "${target}".${FOLDER_AUTH_HINT}`
      }
      return `ERROR: could not open "${target}": ${err instanceof Error ? err.message : String(err)}`
    }
  }

  /**
   * 在应用内把一个文件/目录摆到人面前。
   *
   * Main routes against the effective Workspace: local files inside open there; outside files use
   * IndiPreview. The Chat session directory only resolves relative paths, never chooses the host.
   *
   * 和 `open_workspace_folder` 的区别:那个只认工作区内的路径(`resolveWorkspacePath` 对区外直接
   * 返回 `outside-workspace`),而这个用 `resolveReadPath` —— 和 `read_file` 同一套,够得到 `~`
   * 和任意绝对路径。会话里出现的 `file:line` 多数就在工作区外。
   */
  async toolPreviewFile(sessionKey: string, pathArg?: string, line?: number): Promise<string> {
    const trimmed = String(pathArg || '').trim().replace(/^@/, '')
    if (!trimmed) {
      return 'ERROR: preview_file needs a "path" (an attached @/abs/path, an absolute path, a ~ path, or a workspace-relative path).'
    }
    const resolved = this.resolveReadPath(sessionKey, trimmed)
    const target = resolved.path
    let isDirectory = false
    try {
      isDirectory = statSync(target).isDirectory()
    } catch (err) {
      if (isPermissionError(err)) return `ERROR: no permission to read "${target}".${FOLDER_AUTH_HINT}`
      return `ERROR: "${trimmed}" does not exist (resolved to ${target}).`
    }
    const preview = getMaestroPreviewOpener()
    if (!preview) {
      // 没有注册预览应用的构建 —— 退回文件管理器,和 `open_workspace_folder` 同一个退路。
      if (isDirectory) {
        const error = await shell.openPath(target)
        if (error) return `ERROR: could not open "${target}": ${error}`
        return `Opened ${mdDirLink(target)} in the file manager.`
      }
      shell.showItemInFolder(target)
      return `Revealed ${mdDirLink(target)} in the file manager.`
    }
    try {
      // Main's preview scope is the single routing authority, independent of the Chat session CWD.
      await preview.open(target, { line: isDirectory ? undefined : line })
    } catch (err) {
      if (isPermissionError(err)) return `ERROR: no permission to open "${target}".${FOLDER_AUTH_HINT}`
      return `ERROR: could not preview "${target}": ${err instanceof Error ? err.message : String(err)}`
    }
    const where = preview.displayName
    if (isDirectory) return `Opened ${mdDirLink(target)} in ${where} — the user can browse it in the app.`
    // 如实说「请求跳到第 N 行」而非「已跳到」:能不能跳取决于文件类型和实际行数,这里拿不到结果。
    return line
      ? `Opened ${mdDirLink(target)} in ${where} at line ${line} — the user can see it in the app.`
      : `Opened ${mdDirLink(target)} in ${where} — the user can see it in the app.`
  }

  async toolWorkspaceContext(sessionKey: string, actionArg: string): Promise<string> {
    const action = String(actionArg || 'status').trim().toLowerCase()
    if (action === 'clear' || action === 'remove' || action === 'unset') {
      this.clearWorkspaceRef(sessionKey)
      return JSON.stringify({ ok: true, action: 'clear', workspace: null }, null, 2)
    }
    if (action === 'choose' || action === 'switch' || action === 'set') {
      const result = await this.chooseWorkspaceDirectory({ sessionId: sessionKey })
      return JSON.stringify({ action: 'choose', ...result }, null, 2)
    }
    const result = await this.getWorkspaceDirectory({ sessionId: sessionKey })
    return JSON.stringify(
      { action: 'status', ...result, workspace: result.workspace || null },
      null,
      2
    )
  }

  reset(): void {
    this.workspaceRefs.clear()
  }
}
