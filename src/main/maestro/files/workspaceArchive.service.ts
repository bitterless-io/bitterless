import { existsSync, mkdirSync, realpathSync, statSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { maestroDataRoot } from '@maestro-main/data/maestroDataRoot'
import {
  ArchiveError,
  createArchive,
  extractArchive,
  listArchive
} from '@maestro-main/files/archive.service'

export interface WorkspacePathResolution {
  ok: boolean
  root: string
  realRoot?: string
  path?: string
  rel?: string
  error?: string
}

export interface WorkspaceArchiveHost {
  resolveWorkspacePath(sessionKey: string, pathArg: string): WorkspacePathResolution
  resolveReadPath(sessionKey: string, pathArg: string): { path: string }
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

const isPermissionError = (error: unknown): boolean => {
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  return code === 'EPERM' || code === 'EACCES'
}

const FOLDER_AUTH_HINT =
  process.platform === 'darwin'
    ? ' macOS is protecting this folder — approve the permission prompt if it appears, or grant access under System Settings › Privacy & Security › Files and Folders (or Full Disk Access), then ask me to try again.'
    : ''

export const mdDirLink = (absPath: string): string => {
  // Keep the encoded destination recognizable as an absolute local path so the renderer can
  // intercept it. Forward slashes are also valid for Windows filesystem APIs.
  const target = absPath
    .replace(/\\/g, '/')
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
    .replace(/^([A-Za-z])%3A\//, '$1:/')
  const label = basename(absPath).replace(/([\\[\]])/g, '\\$1')
  return `[${label}](${target})`
}

export class WorkspaceArchiveService {
  constructor(private readonly host: WorkspaceArchiveHost) {}

  private sessionFallbackWorkspace(sessionKey: string): string {
    const sanitized = String(sessionKey || 'default')
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .slice(0, 96)
    const safe = sanitized && sanitized !== '.' && sanitized !== '..' ? sanitized : 'default'
    return join(maestroDataRoot(), 'chat_workspaces', safe)
  }

  // Archives and open_workspace_folder get a lazy per-chat fallback. The ordinary
  // write_file/create_artifact tools continue to require the explicitly selected workspace.
  resolveWritablePath(sessionKey: string, pathArg: string): WorkspacePathResolution {
    const direct = this.host.resolveWorkspacePath(sessionKey, pathArg)
    if (direct.ok || direct.error !== 'no-workspace') return direct

    const root = this.sessionFallbackWorkspace(sessionKey)
    mkdirSync(root, { recursive: true })
    const realRoot = realpathSync(root)
    const rel = String(pathArg || '').trim().replace(/^@/, '')
    const target = rel ? resolve(root, rel) : root
    if (!isInsideRoot(root, target)) {
      return { ok: false, root, realRoot, error: 'path-escapes-workspace' }
    }
    try {
      const realExisting = realpathSync(nearestExistingAncestor(target))
      if (!isInsideRoot(realRoot, realExisting)) {
        return { ok: false, root, realRoot, error: 'path-escapes-workspace' }
      }
    } catch {
      return { ok: false, root, realRoot, error: 'workspace-path-unavailable' }
    }
    return {
      ok: true,
      root,
      realRoot,
      path: target,
      rel: relative(root, target) || '.'
    }
  }

  async toolListArchive(
    sessionKey: string,
    pathArg: string,
    password?: string
  ): Promise<string> {
    const trimmed = String(pathArg || '').trim().replace(/^@/, '')
    if (!trimmed) return 'ERROR: list_archive needs a "path".'
    const target = this.host.resolveReadPath(sessionKey, trimmed).path
    try {
      if (!existsSync(target) || !statSync(target).isFile()) {
        return `ERROR: "${pathArg}" is not a file.`
      }
      return await listArchive(target, password)
    } catch (error) {
      return this.describeArchiveError(error, trimmed)
    }
  }

  async toolExtractArchive(
    sessionKey: string,
    pathArg: string,
    destArg?: string,
    password?: string
  ): Promise<string> {
    const trimmed = String(pathArg || '').trim().replace(/^@/, '')
    if (!trimmed) return 'ERROR: extract_archive needs a "path".'
    const target = this.host.resolveReadPath(sessionKey, trimmed).path
    const destRel = String(destArg || '').trim() || basename(target).replace(/\.[^.]+$/, '')
    const dest = this.resolveWritablePath(sessionKey, destRel)
    if (!dest.ok || !dest.path) return `ERROR: ${dest.error || 'workspace unavailable'}`
    if (!isInsideRoot(dest.root, dest.path)) {
      return 'ERROR: the destination is outside the workspace.'
    }
    try {
      if (!existsSync(target) || !statSync(target).isFile()) {
        return `ERROR: "${pathArg}" is not a file.`
      }
      mkdirSync(dest.path, { recursive: true })
      const output = await extractArchive(target, dest.path, password)
      return `${output}\n\nUnpacked into ${mdDirLink(dest.path)}. Use list_workspace_files to see what landed.`
    } catch (error) {
      return this.describeArchiveError(error, trimmed)
    }
  }

  async toolCreateArchive(
    sessionKey: string,
    archiveArg: string,
    inputsArg: string,
    password?: string
  ): Promise<string> {
    const archiveRel = String(archiveArg || '').trim()
    if (!archiveRel) {
      return 'ERROR: create_archive needs an "archive" path (its extension picks the format, e.g. out.zip / out.tar.gz).'
    }
    const archive = this.resolveWritablePath(sessionKey, archiveRel)
    if (!archive.ok || !archive.path) {
      return `ERROR: ${archive.error || 'workspace unavailable'}`
    }
    if (!isInsideRoot(archive.root, dirname(archive.path))) {
      return 'ERROR: the archive path is outside the workspace.'
    }
    const inputs = String(inputsArg || '')
      .split(/[\n,]/)
      .map((part) => part.trim().replace(/^@/, ''))
      .filter(Boolean)
      .map((part) => this.host.resolveReadPath(sessionKey, part).path)
    if (!inputs.length) {
      return 'ERROR: create_archive needs "inputs" — one or more paths, comma- or newline-separated.'
    }
    const missing = inputs.filter((path) => !existsSync(path))
    if (missing.length) return `ERROR: these inputs do not exist: ${missing.join(', ')}`
    try {
      mkdirSync(dirname(archive.path), { recursive: true })
      const output = await createArchive(archive.path, inputs, { password })
      return `${output}\n\nWrote ${mdDirLink(archive.path)}.`
    } catch (error) {
      return this.describeArchiveError(error, archiveRel)
    }
  }

  private describeArchiveError(error: unknown, target: string): string {
    if (error instanceof ArchiveError) {
      if (
        error.code === 'refused' ||
        error.code === 'unavailable' ||
        error.code === 'timeout'
      ) {
        return `ERROR: ${error.message}`
      }
      return `ERROR: could not process "${target}": ${error.message}\nIf it is encrypted, pass "password".`
    }
    if (isPermissionError(error)) {
      return `ERROR: no permission to read "${target}".${FOLDER_AUTH_HINT}`
    }
    return `ERROR: could not process "${target}": ${error instanceof Error ? error.message : String(error)}`
  }
}
