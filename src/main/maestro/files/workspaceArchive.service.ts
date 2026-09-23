import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  rmdirSync,
  statSync
} from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
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

const isPermissionError = (error: unknown): boolean => {
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  return code === 'EPERM' || code === 'EACCES'
}

const assertSafeExtractedTree = (stageRoot: string, expectedRealStageRoot: string): void => {
  const stageStats = lstatSync(stageRoot)
  if (stageStats.isSymbolicLink() || !stageStats.isDirectory()) {
    throw new ArchiveError('The archive replaced its extraction directory.', 'refused')
  }
  const realStageRoot = realpathSync(stageRoot)
  if (realStageRoot !== expectedRealStageRoot) {
    throw new ArchiveError('The archive redirected its extraction directory.', 'refused')
  }
  const visit = (path: string): void => {
    const stats = lstatSync(path)
    if (stats.isSymbolicLink()) {
      throw new ArchiveError(
        'The archive contains a symbolic link or junction. For safety, Maestro does not extract archives containing links.',
        'refused'
      )
    }
    if (stats.isDirectory()) {
      if (!isInsideRoot(realStageRoot, realpathSync(path))) {
        throw new ArchiveError('The archive contains a directory that escapes the extraction area.', 'refused')
      }
      for (const name of readdirSync(path)) visit(join(path, name))
      return
    }
    if (!stats.isFile()) {
      throw new ArchiveError(
        'The archive contains a special filesystem entry. Only ordinary files and directories can be extracted.',
        'refused'
      )
    }
    // A hard-linked file is reported as an ordinary file by lstat, but has more than one link.
    if (stats.nlink !== 1) {
      throw new ArchiveError(
        'The archive contains hard-linked files. For safety, Maestro does not extract archives containing links.',
        'refused'
      )
    }
    if (!isInsideRoot(realStageRoot, realpathSync(path))) {
      throw new ArchiveError('The archive contains a file that escapes the extraction area.', 'refused')
    }
  }

  for (const name of readdirSync(stageRoot)) visit(join(stageRoot, name))
}

const installExtractedTree = (
  stageRoot: string,
  destination: string,
  workspaceRoot: string
): string => {
  const realWorkspaceRoot = realpathSync(workspaceRoot)
  if (resolve(destination) === resolve(workspaceRoot)) {
    throw new ArchiveError(
      'Extracting directly into the workspace root is refused. Choose a new destination folder.',
      'refused'
    )
  }

  const parent = dirname(destination)
  mkdirSync(parent, { recursive: true })
  const realParent = realpathSync(parent)
  if (!isInsideRoot(realWorkspaceRoot, realParent)) {
    throw new ArchiveError('The extraction destination escapes the workspace.', 'refused')
  }
  const installedDestination = join(realParent, basename(destination))

  if (existsSync(installedDestination)) {
    const destinationStats = lstatSync(installedDestination)
    if (destinationStats.isSymbolicLink() || !destinationStats.isDirectory()) {
      throw new ArchiveError(
        'The extraction destination must be a new folder or an existing empty directory.',
        'refused'
      )
    }
    if (!isInsideRoot(realWorkspaceRoot, realpathSync(installedDestination))) {
      throw new ArchiveError('The extraction destination escapes the workspace.', 'refused')
    }
    if (readdirSync(installedDestination).length > 0) {
      throw new ArchiveError(
        'The extraction destination is not empty. Choose a new or empty folder so archive files cannot overwrite existing content.',
        'refused'
      )
    }
    rmdirSync(installedDestination)
  }

  // stageRoot and destination live under the same workspace root, so rename installs the fully
  // audited tree without copying through any pre-existing destination entries.
  renameSync(stageRoot, installedDestination)
  if (!isInsideRoot(realWorkspaceRoot, realpathSync(installedDestination))) {
    throw new ArchiveError('The extracted directory escaped the workspace.', 'refused')
  }
  return installedDestination
}

const FOLDER_AUTH_HINT =
  process.platform === 'darwin'
    ? ' macOS is protecting this folder — approve the permission prompt if it appears, or grant access under System Settings › Privacy & Security › Files and Folders (or Full Disk Access), then ask me to try again.'
    : ''

/**
 * 悬浮时显示的那串 —— **可读的完整路径**。
 *
 * 目标是逐段 `encodeURIComponent` 过的(`Trial%201%20NPG`),没人想读它;渲染器的 tooltip
 * 优先取 `node.title`,所以 title 把路径按原样带回来(Ral 2026-09-23:「悬浮时,可以展示它
 * 完整的路径」,并要求「以 cowork 交互为准」)。
 *
 * `"` 与 `\\` 必须转义:一个裸 `"` 会提前闭合 title,**整条链接连目标一起解析失败** ——
 * 等于用一类断链换掉另一类。CommonMark 允许 title 里用反斜杠转义。
 */
const mdTitle = (absPath: string): string => absPath.replace(/\\/g, '\\\\').replace(/"/g, '\\"')

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
  return `[${label}](${target} "${mdTitle(absPath)}")`
}

export class WorkspaceArchiveService {
  constructor(private readonly host: WorkspaceArchiveHost) {}

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
    const dest = this.host.resolveWorkspacePath(sessionKey, destRel)
    if (!dest.ok || !dest.path) return `ERROR: ${dest.error || 'workspace unavailable'}`
    if (!isInsideRoot(dest.root, dest.path)) {
      return 'ERROR: the destination is outside the workspace.'
    }
    let stageRoot = ''
    try {
      if (!existsSync(target) || !statSync(target).isFile()) {
        return `ERROR: "${pathArg}" is not a file.`
      }
      const realWorkspaceRoot = dest.realRoot || realpathSync(dest.root)
      stageRoot = mkdtempSync(join(realWorkspaceRoot, '.maestro-extract-'))
      const expectedRealStageRoot = realpathSync(stageRoot)
      // ouch 0.8.2 rejects traversal and link escapes itself. Staging plus a complete lstat/realpath
      // audit is a second boundary: no archive member reaches its requested destination until every
      // extracted entry is known to be an ordinary in-tree file or directory.
      const output = await extractArchive(target, stageRoot, password)
      assertSafeExtractedTree(stageRoot, expectedRealStageRoot)
      const installedPath = installExtractedTree(stageRoot, dest.path, realWorkspaceRoot)
      const installedOutput = output.split(stageRoot).join(installedPath)
      stageRoot = ''
      return `${installedOutput}\n\nUnpacked into ${mdDirLink(installedPath)}. Use list_workspace_files to see what landed.`
    } catch (error) {
      return this.describeArchiveError(error, trimmed)
    } finally {
      if (stageRoot) rmSync(stageRoot, { recursive: true, force: true })
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
    const archive = this.host.resolveWorkspacePath(sessionKey, archiveRel)
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
