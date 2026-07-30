import type { BrowserWindow } from 'electron'
import { dialog, shell } from 'electron'
import type { OpenDialogOptions } from 'electron'
import { createXpcMainEmitter, xpcMain } from 'electron-xpc/main'
import { homedir } from 'os'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'path'
import { existsSync, mkdirSync, realpathSync, statSync, writeFileSync, type Dirent } from 'fs'
import { readdir, readFile as readFileAsync, stat as statAsync } from 'fs/promises'
import { injectable } from 'inversify'
import { readFileForAgent, FileReadError } from '@maestro-main/files/fileReader.service'
import { writeArtifactFromJson } from '@maestro-main/files/artifactWriter.service'
import { maestroDataRoot } from '@maestro-main/data/maestroDataRoot'
import type { AgentFileArtifact, FileStatusResult, WorkspaceRef, WorkspaceRefResult } from '@maestro-shared/coach.api'
import {
  WORKSPACE_CONFIG_DOMAIN,
  WORKSPACE_DEFAULT_KEY,
  type ConfigApi
} from '@maestro-shared/config.api'
import { CommonService } from '@maestro-shared/iocHelper/ioc.helper'

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

interface WorkspacePathResolution {
  ok: boolean
  root: string
  realRoot?: string
  path?: string
  rel?: string
  error?: string
}

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

  async chooseWorkspaceDirectory(params?: { sessionId?: string }): Promise<WorkspaceRefResult> {
    const options: OpenDialogOptions = {
      title: 'Choose workspace',
      properties: ['openDirectory', 'createDirectory']
    }
    const result = this._state.browserWindow
      ? await dialog.showOpenDialog(this._state.browserWindow, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths[0]) return { ok: false, error: 'cancelled' }
    return await this.setWorkspaceDirectory({ sessionId: params?.sessionId, path: result.filePaths[0] })
  }

  async setWorkspaceDirectory(params: { sessionId?: string; path?: string }): Promise<WorkspaceRefResult> {
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
      this.clearWorkspaceRef(key)
      await this.removeDefaultWorkspaceIfPathMatches(abs)
      return { ok: false, missing: true, error: 'workspace-not-found' }
    }
    const workspace = this.workspaceRefFromPath(abs)
    this.workspaceRefs.set(key, workspace)
    this.workspaceRefs.set('default', workspace)
    await this.persistDefaultWorkspace(workspace)
    this.broadcastWorkspaceChanged(key, workspace)
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
    const fresh = { ...workspace, exists: true, updatedAt: Date.now() }
    this.workspaceRefs.set(key, fresh)
    if (key === 'default') await this.persistDefaultWorkspace(fresh)
    this.broadcastWorkspaceChanged(key, fresh)
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
          size: stats.size
        }
      } catch {
        return {
          path: abs,
          exists: false,
          isFile: false,
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

  private async persistDefaultWorkspace(workspace?: WorkspaceRef): Promise<void> {
    if (!workspace?.path) {
      await configStore
        .remove({ domain: WORKSPACE_CONFIG_DOMAIN, key: WORKSPACE_DEFAULT_KEY })
        .catch(() => undefined)
      this.workspaceRefs.delete('default')
      this.broadcastWorkspaceChanged('default')
      return
    }
    const normalized = this.workspaceRefFromPath(workspace.path)
    this.workspaceRefs.set('default', normalized)
    await configStore
      .upsert({
        domain: WORKSPACE_CONFIG_DOMAIN,
        key: WORKSPACE_DEFAULT_KEY,
        options: normalized
      })
      .catch(() => undefined)
    this.broadcastWorkspaceChanged('default', normalized)
  }

  private async removeDefaultWorkspaceIfPathMatches(path?: string): Promise<void> {
    const target = path ? resolve(path) : ''
    const currentPath = this.workspaceRefs.get('default')?.path || (await this.readDefaultWorkspacePath())
    if (!currentPath || (target && resolve(currentPath) !== target)) return
    await this.persistDefaultWorkspace()
  }

  private resolveWorkspacePath(sessionKey: string, pathArg: string): WorkspacePathResolution {
    const workspace = this.workspaceRefs.get(sessionKey)
    if (!workspace) return { ok: false, root: '', error: 'no-workspace' }
    const root = resolve(workspace.path)
    let realRoot = root
    try {
      if (!statSync(root).isDirectory()) {
        this.clearWorkspaceRef(sessionKey)
        return { ok: false, root, error: 'workspace-not-found' }
      }
      realRoot = realpathSync(root)
    } catch {
      this.clearWorkspaceRef(sessionKey)
      return { ok: false, root, error: 'workspace-not-found' }
    }
    const cleaned = pathArg.trim().replace(/^@/, '')
    const target = cleaned ? (isAbsolute(cleaned) ? resolve(cleaned) : resolve(root, cleaned)) : root
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

  private resolveReadPath(sessionKey: string, pathArg: string): { path: string; root: string } {
    let cleaned = String(pathArg || '').trim().replace(/^@/, '')
    if (cleaned === '~') cleaned = homedir()
    else if (cleaned.startsWith('~/') || cleaned.startsWith('~\\')) {
      cleaned = join(homedir(), cleaned.slice(2))
    }
    const workspace = this.workspaceRefs.get(sessionKey)
    const workspaceRoot = workspace ? resolve(workspace.path) : ''
    const base = workspaceRoot || homedir()
    const path = !cleaned ? base : isAbsolute(cleaned) ? resolve(cleaned) : resolve(base, cleaned)
    const root = workspaceRoot && isInsideRoot(workspaceRoot, path) ? workspaceRoot : path
    return { path, root }
  }

  private broadcastWorkspaceChanged(sessionId: string, workspace?: WorkspaceRef): void {
    xpcMain.broadcast('coach/workspace-changed', {
      sessionId,
      workspace,
      ts: Date.now()
    })
  }

  private clearWorkspaceRef(sessionId: string): void {
    this.workspaceRefs.delete(sessionId)
    this.broadcastWorkspaceChanged(sessionId)
  }

  async toolReadFile(
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
      if (!stats.isFile()) return `ERROR: "${pathArg}" is not a file.`
      return await readFileForAgent(target, options)
    } catch (err) {
      if (err instanceof FileReadError) return `ERROR: ${err.message}`
      if (isPermissionError(err)) {
        return `ERROR: no permission to read "${trimmed}".${FOLDER_AUTH_HINT}`
      }
      return `ERROR: could not read "${trimmed}": ${err instanceof Error ? err.message : String(err)}`
    }
  }

  async toolListWorkspaceFiles(
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
        .filter((entry) => !entry.isDirectory() || !WORKSPACE_SKIP_DIRS.has(entry.name))
        .slice(0, maxEntries)
        .map((entry) => ({
          name: entry.name,
          path: relative(resolved.root, join(resolved.path, entry.name)) || entry.name,
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

  async toolSearchWorkspaceFiles(
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
        const rel = relative(resolved.root, abs)
        if (entry.isDirectory()) {
          if (depth < READ_SEARCH_MAX_DEPTH && !WORKSPACE_SKIP_DIRS.has(entry.name)) {
            await visit(abs, depth + 1)
          }
          continue
        }
        if (!entry.isFile()) continue
        if (workspaceTextMatches(`${entry.name}\n${rel}`, terms)) {
          pushHit({ path: rel, name: entry.name, kind: 'name' })
          if (hits.length >= maxResults) break
        }
        const extension = fileExtension(entry.name)
        if (!WORKSPACE_TEXT_EXTS.has(extension)) continue
        try {
          const stats = await statAsync(abs)
          if (stats.size > WORKSPACE_TEXT_SCAN_BYTES) continue
          const lines = (await readFileAsync(abs, 'utf8')).split(/\r?\n/)
          const index = lines.findIndex((line) => workspaceTextMatches(line, terms))
          if (index >= 0) {
            pushHit({
              path: rel,
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
