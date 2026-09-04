import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import type { BigIntStats } from 'node:fs';
// `node:fs/promises`, not fs-extra, and deliberately: a delete grant pins its target by holding a
// `FileHandle` and re-`stat`ing it, which fs-extra's promisified `open` cannot give (it resolves to
// a raw descriptor), and fs-extra is CJS-only with undetectable named exports, so it cannot be
// bundled or externalized into the ESM harness these primitives are tested through.
import {
  link,
  lstat,
  mkdir,
  open,
  realpath,
  rename,
  rmdir,
  stat,
  rm,
  unlink,
  type FileHandle
} from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
  isOnlyPreviewPermissionError,
  normalizeOnlyPreviewRelativePath,
  OnlyPreviewContractError
} from '@shared/onlypreview/onlyPreview.contract';
import { validateOnlyPreviewEntryName } from '@shared/onlypreview/onlyPreviewEntryName.shared';
import type {
  OnlyPreviewFileAuthorityDeleteGrant,
  OnlyPreviewFileAuthorityDeleteResult,
  OnlyPreviewFileAuthorityTarget,
  OnlyPreviewFileAuthorityWorkspaceBinding,
  OnlyPreviewValidatedTarget
} from '@shared/onlypreview/onlyPreviewFileAuthorityRuntime.types';

interface ProjectWorkspaceAuthority {
  workspaceId: string;
  generation: number;
  rootRealPath: string;
  deviceId: bigint;
  inode: bigint;
}

interface ProjectFileIdentity {
  deviceId: bigint;
  inode: bigint;
  size: bigint;
  modifiedTimeNanoseconds: bigint;
}

interface PreparedDeleteGrant {
  grant: OnlyPreviewFileAuthorityDeleteGrant;
  canonicalPath: string;
  identity: ProjectFileIdentity;
  nodeKind: 'file' | 'directory';
  // A directory cannot be pinned by an open descriptor: `open()` on a directory fails on Windows.
  // Its identity is re-checked by `lstat` instead, and the isolate rename is what actually protects
  // the removal — once renamed, the subtree is unreachable by its original path.
  handle: FileHandle | null;
  handleClosed: boolean;
  expiryTimer: ReturnType<typeof setTimeout> | null;
  expiresAt: number;
}

interface IsolatedDeleteEntry {
  directoryPath: string;
  entryPath: string;
  originalPath: string;
}

export interface FileSearchProjectAuthorityFileOperations {
  lstat(path: string): Promise<BigIntStats>;
  realpath(path: string): Promise<string>;
  stat(path: string): Promise<BigIntStats>;
  open(path: string, flags: number): Promise<FileHandle>;
  mkdir(path: string, mode: number): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  link(existingPath: string, newPath: string): Promise<void>;
  unlink(path: string): Promise<void>;
  rmdir(path: string): Promise<void>;
  removeTree(path: string): Promise<void>;
}

export const projectAuthorityFileOperations: FileSearchProjectAuthorityFileOperations =
  Object.freeze({
    lstat: async (path) => await lstat(path, { bigint: true }),
    realpath: async (path) => await realpath(path),
    stat: async (path) => await stat(path, { bigint: true }),
    open: async (path, flags) => await open(path, flags),
    mkdir: async (path, mode) => await mkdir(path, { mode }),
    rename: async (oldPath, newPath) => await rename(oldPath, newPath),
    link: async (existingPath, newPath) => await link(existingPath, newPath),
    unlink: async (path) => await unlink(path),
    rmdir: async (path) => await rmdir(path),
    // `rm` unlinks a symbolic link rather than following it, so a link inside a deleted folder can
    // never reach its target.
    removeTree: async (path) => await rm(path, { recursive: true, force: false })
  });

const DELETE_GRANT_TTL_MS = 60_000;
const MAX_DELETE_GRANTS = 16;

const isContainedPath = (root: string, candidate: string): boolean => {
  const child = relative(root, candidate);
  return child === '' || (!child.startsWith(`..${sep}`) && child !== '..' && !isAbsolute(child));
};

const identityOf = (stats: BigIntStats): ProjectFileIdentity => ({
  deviceId: stats.dev,
  inode: stats.ino,
  size: stats.size,
  modifiedTimeNanoseconds: stats.mtimeNs
});

const sameIdentity = (left: ProjectFileIdentity, right: ProjectFileIdentity): boolean =>
  left.deviceId === right.deviceId &&
  left.inode === right.inode &&
  left.size === right.size &&
  left.modifiedTimeNanoseconds === right.modifiedTimeNanoseconds;

// `dev` + `ino` identify the node; `size` and `mtime` describe its content. A directory's content
// changes whenever any child is added or removed, so comparing them would fail the confirmation for
// an ordinary background write instead of for a swap. The node identity is the part that matters.
const sameNodeIdentity = (
  left: ProjectFileIdentity,
  right: ProjectFileIdentity,
  nodeKind: 'file' | 'directory'
): boolean =>
  nodeKind === 'directory'
    ? left.deviceId === right.deviceId && left.inode === right.inode
    : sameIdentity(left, right);

type ProjectAuthorityAction = 'read' | 'delete' | 'author';

const toSafeProjectError = (error: unknown, action: ProjectAuthorityAction): never => {
  if (error instanceof OnlyPreviewContractError) throw error;
  if (isOnlyPreviewPermissionError(error)) {
    throw new OnlyPreviewContractError(
      'PATH_PERMISSION_DENIED',
      action === 'delete'
        ? 'Bitterless does not have permission to delete this file.'
        : action === 'author'
          ? 'Bitterless does not have permission to change this folder.'
          : 'Bitterless does not have permission to read this file or folder.'
    );
  }
  const code = (error as NodeJS.ErrnoException | null)?.code;
  if (code === 'ENOENT' || code === 'ENOTDIR') {
    throw new OnlyPreviewContractError(
      'PATH_NOT_FOUND',
      action === 'delete'
        ? 'The selected file is no longer available.'
        : action === 'author'
          ? 'The Project item being renamed is no longer available.'
          : 'The selected Project item is no longer available.'
    );
  }
  throw new OnlyPreviewContractError(
    'OPERATION_FAILED',
    action === 'delete'
      ? 'The selected file could not be deleted safely.'
      : action === 'author'
        ? 'The Project item could not be created or renamed safely.'
        : 'The selected Project item could not be authorized safely.'
  );
};

// The renderer validates the same rules for immediate feedback, but the renderer is not the
// contract: this is the last check before the syscall, so it runs again here on a value the
// renderer could have skipped.
const requireValidEntryName = (name: unknown): string => {
  const result = validateOnlyPreviewEntryName(name);
  if (!result.ok) {
    throw new OnlyPreviewContractError('NAME_INVALID', `The name is not usable: ${result.reason}.`);
  }
  return result.name;
};

const joinRelativePath = (parentRelativePath: string, name: string): string =>
  parentRelativePath ? `${parentRelativePath}/${name}` : name;

const parentRelativePathOf = (relativePath: string): string => {
  const separator = relativePath.lastIndexOf('/');
  return separator === -1 ? '' : relativePath.slice(0, separator);
};

export const inspectOnlyPreviewProjectTarget = async (
  absoluteTarget: string
): Promise<OnlyPreviewValidatedTarget> => {
  if (!isAbsolute(absoluteTarget) || absoluteTarget.includes('\0')) {
    throw new OnlyPreviewContractError('INVALID_INPUT', 'OnlyPreview target is invalid.');
  }
  try {
    const lexicalStats = await lstat(absoluteTarget, { bigint: true });
    if (lexicalStats.isSymbolicLink()) {
      throw new OnlyPreviewContractError(
        'PATH_NOT_REGULAR_FILE',
        'Symbolic links cannot be opened as OnlyPreview targets.'
      );
    }
    const targetRealPath = await realpath(absoluteTarget);
    const targetStats = await stat(targetRealPath, { bigint: true });
    if (!targetStats.isFile() && !targetStats.isDirectory()) {
      throw new OnlyPreviewContractError(
        'PATH_UNSUPPORTED_DEVICE',
        'Only regular files and directories can be opened.'
      );
    }
    if (
      lexicalStats.dev !== targetStats.dev ||
      lexicalStats.ino !== targetStats.ino ||
      lexicalStats.isFile() !== targetStats.isFile() ||
      lexicalStats.isDirectory() !== targetStats.isDirectory()
    ) {
      throw new OnlyPreviewContractError(
        'PATH_OUTSIDE_WORKSPACE',
        'The OnlyPreview target changed while it was inspected.'
      );
    }
    const rootRealPath = targetStats.isDirectory() ? targetRealPath : dirname(targetRealPath);
    return {
      rootRealPath,
      rootName: basename(rootRealPath) || rootRealPath,
      displayPath: rootRealPath,
      ...(targetStats.isFile() ? { selectedRelativePath: basename(targetRealPath) } : {})
    };
  } catch (error) {
    return toSafeProjectError(error, 'read');
  }
};

export class FileSearchProjectAuthority {
  private workspace: ProjectWorkspaceAuthority | null = null;
  private readonly deleteGrants = new Map<string, PreparedDeleteGrant>();
  private readonly activeDeletes = new Set<PreparedDeleteGrant>();
  private generation = 0;
  private authorityOperation = 0;

  constructor(
    private readonly fileOperations: FileSearchProjectAuthorityFileOperations = projectAuthorityFileOperations,
    private readonly now: () => number = () => Date.now(),
    private readonly deleteGrantTtlMs: number = DELETE_GRANT_TTL_MS
  ) {}

  async bindWorkspace(
    runtimeInstanceId: string,
    workspaceId: string,
    rootPath: string
  ): Promise<OnlyPreviewFileAuthorityWorkspaceBinding> {
    const operation = ++this.authorityOperation;
    this.workspace = null;
    await this.revokeDeleteGrants();
    try {
      const lexicalStats = await this.fileOperations.lstat(rootPath);
      if (lexicalStats.isSymbolicLink()) {
        throw new OnlyPreviewContractError(
          'PATH_NOT_REGULAR_FILE',
          'Symbolic links cannot be used as Project workspaces.'
        );
      }
      const rootRealPath = await this.fileOperations.realpath(rootPath);
      const rootStats = await this.fileOperations.stat(rootRealPath);
      if (
        !rootStats.isDirectory() ||
        lexicalStats.dev !== rootStats.dev ||
        lexicalStats.ino !== rootStats.ino
      ) {
        throw new OnlyPreviewContractError(
          'PATH_OUTSIDE_WORKSPACE',
          'The Project workspace authority changed.'
        );
      }
      if (operation !== this.authorityOperation) {
        throw new OnlyPreviewContractError(
          'OPERATION_FAILED',
          'The Project workspace binding was superseded.'
        );
      }
      const workspace: ProjectWorkspaceAuthority = {
        workspaceId,
        generation: ++this.generation,
        rootRealPath,
        deviceId: rootStats.dev,
        inode: rootStats.ino
      };
      this.workspace = workspace;
      return {
        runtimeInstanceId,
        workspaceId,
        workspaceGeneration: workspace.generation
      };
    } catch (error) {
      if (operation === this.authorityOperation) this.workspace = null;
      return toSafeProjectError(error, 'read');
    }
  }

  async revokeWorkspace(workspaceId: string, workspaceGeneration: number): Promise<void> {
    this.requireWorkspace(workspaceId, workspaceGeneration);
    this.authorityOperation += 1;
    this.generation += 1;
    this.workspace = null;
    await this.revokeDeleteGrants();
  }

  async authorizeItem(
    runtimeInstanceId: string,
    workspaceId: string,
    workspaceGeneration: number,
    relativePath: string
  ): Promise<OnlyPreviewFileAuthorityTarget> {
    try {
      const operation = this.authorityOperation;
      const workspace = this.requireWorkspace(workspaceId, workspaceGeneration);
      const item = await this.resolveItem(workspace, relativePath, operation);
      return this.toTarget(runtimeInstanceId, workspace, item);
    } catch (error) {
      return toSafeProjectError(error, 'read');
    }
  }

  async authorizeRoot(
    runtimeInstanceId: string,
    workspaceId: string,
    workspaceGeneration: number
  ): Promise<OnlyPreviewFileAuthorityTarget> {
    try {
      const operation = this.authorityOperation;
      const workspace = this.requireWorkspace(workspaceId, workspaceGeneration);
      const rootStats = await this.requireCurrentRoot(workspace, operation);
      const size = 0;
      const modifiedAt = Number(rootStats.mtimeMs);
      if (!Number.isFinite(modifiedAt)) {
        throw new OnlyPreviewContractError(
          'OPERATION_FAILED',
          'The Project root metadata is invalid.'
        );
      }
      return {
        runtimeInstanceId,
        workspaceId,
        workspaceGeneration,
        relativePath: '',
        name: basename(workspace.rootRealPath) || workspace.rootRealPath,
        nodeKind: 'directory',
        canonicalPath: workspace.rootRealPath,
        size,
        modifiedAt
      };
    } catch (error) {
      return toSafeProjectError(error, 'read');
    }
  }

  async createDirectory(
    runtimeInstanceId: string,
    workspaceId: string,
    workspaceGeneration: number,
    parentRelativePath: string,
    name: string
  ): Promise<OnlyPreviewFileAuthorityTarget> {
    try {
      const entryName = requireValidEntryName(name);
      const operation = this.authorityOperation;
      const workspace = this.requireWorkspace(workspaceId, workspaceGeneration);
      const parent = await this.resolveDirectory(workspace, parentRelativePath, operation);
      const canonicalTarget = join(parent.canonicalPath, entryName);
      if (!isContainedPath(workspace.rootRealPath, canonicalTarget)) {
        throw new OnlyPreviewContractError(
          'PATH_OUTSIDE_WORKSPACE',
          'The new folder would be outside its workspace.'
        );
      }
      this.requireActiveWorkspace(workspace, operation);
      try {
        await this.fileOperations.mkdir(canonicalTarget, 0o777);
      } catch (error) {
        // `mkdir` without `recursive` is the collision check: it is atomic, so it cannot be raced
        // the way a separate existence probe can.
        if ((error as NodeJS.ErrnoException | null)?.code === 'EEXIST') {
          throw new OnlyPreviewContractError(
            'NAME_EXISTS',
            'An item with this name already exists in this folder.'
          );
        }
        throw error;
      }
      const created = await this.resolveItem(
        workspace,
        joinRelativePath(parent.relativePath, entryName),
        operation
      );
      return this.toTarget(runtimeInstanceId, workspace, created);
    } catch (error) {
      return toSafeProjectError(error, 'author');
    }
  }

  async renameEntry(
    runtimeInstanceId: string,
    workspaceId: string,
    workspaceGeneration: number,
    relativePath: string,
    name: string
  ): Promise<OnlyPreviewFileAuthorityTarget> {
    try {
      const entryName = requireValidEntryName(name);
      const operation = this.authorityOperation;
      const workspace = this.requireWorkspace(workspaceId, workspaceGeneration);
      const item = await this.resolveItem(workspace, relativePath, operation);
      if (!item.relativePath) {
        throw new OnlyPreviewContractError(
          'PATH_OUTSIDE_WORKSPACE',
          'The Project root cannot be renamed from here.'
        );
      }
      if (item.name === entryName) return this.toTarget(runtimeInstanceId, workspace, item);
      const canonicalTarget = join(dirname(item.canonicalPath), entryName);
      if (!isContainedPath(workspace.rootRealPath, canonicalTarget)) {
        throw new OnlyPreviewContractError(
          'PATH_OUTSIDE_WORKSPACE',
          'The renamed item would be outside its workspace.'
        );
      }
      // `rename` overwrites silently, so the destination has to be checked. A case-only change on a
      // case-insensitive filesystem resolves to the item itself, and that is a legitimate rename —
      // only a *different* entry is a collision.
      const existing = await this.fileOperations.lstat(canonicalTarget).catch(() => null);
      if (
        existing &&
        (existing.dev !== item.identity.deviceId || existing.ino !== item.identity.inode)
      ) {
        throw new OnlyPreviewContractError(
          'NAME_EXISTS',
          'An item with this name already exists in this folder.'
        );
      }
      this.requireActiveWorkspace(workspace, operation);
      await this.fileOperations.rename(item.canonicalPath, canonicalTarget);
      const renamed = await this.resolveItem(
        workspace,
        joinRelativePath(parentRelativePathOf(item.relativePath), entryName),
        operation
      );
      return this.toTarget(runtimeInstanceId, workspace, renamed);
    } catch (error) {
      return toSafeProjectError(error, 'author');
    }
  }

  async prepareDelete(
    runtimeInstanceId: string,
    workspaceId: string,
    workspaceGeneration: number,
    relativePath: string
  ): Promise<OnlyPreviewFileAuthorityDeleteGrant> {
    let handle: FileHandle | null = null;
    try {
      await this.pruneExpiredGrants();
      if (this.deleteGrants.size + this.activeDeletes.size >= MAX_DELETE_GRANTS) {
        throw new OnlyPreviewContractError(
          'OPERATION_FAILED',
          'Too many Delete confirmations are pending.'
        );
      }
      const operation = this.authorityOperation;
      const workspace = this.requireWorkspace(workspaceId, workspaceGeneration);
      const item = await this.resolveItem(workspace, relativePath, operation);
      if (item.nodeKind !== 'file' && item.nodeKind !== 'directory') {
        throw new OnlyPreviewContractError(
          'PATH_NOT_REGULAR_FILE',
          'Only files and folders can be deleted.'
        );
      }
      if (item.nodeKind === 'file') {
        handle = await this.openPinnedDeleteHandle(item.canonicalPath, item.identity);
      } else {
        await this.requireDirectoryDeleteIdentity(item.canonicalPath, item.identity);
      }
      this.requireActiveWorkspace(workspace, operation);
      const grant: OnlyPreviewFileAuthorityDeleteGrant = {
        runtimeInstanceId,
        workspaceId,
        workspaceGeneration,
        relativePath: item.relativePath,
        name: item.name,
        grantId: randomUUID(),
        size: item.size,
        modifiedAt: item.modifiedAt
      };
      const prepared: PreparedDeleteGrant = {
        grant,
        canonicalPath: item.canonicalPath,
        identity: item.identity,
        nodeKind: item.nodeKind,
        handle,
        handleClosed: false,
        expiryTimer: null,
        expiresAt: this.now() + this.deleteGrantTtlMs
      };
      prepared.expiryTimer = setTimeout(() => {
        if (this.deleteGrants.get(grant.grantId) !== prepared) return;
        this.deleteGrants.delete(grant.grantId);
        void this.closePreparedDeleteGrant(prepared);
      }, this.deleteGrantTtlMs);
      prepared.expiryTimer.unref?.();
      this.deleteGrants.set(grant.grantId, prepared);
      handle = null;
      return grant;
    } catch (error) {
      if (handle) await handle.close().catch(() => undefined);
      return toSafeProjectError(error, 'delete');
    }
  }

  async commitDelete(
    runtimeInstanceId: string,
    workspaceId: string,
    workspaceGeneration: number,
    grantId: string,
    relativePath: string
  ): Promise<OnlyPreviewFileAuthorityDeleteResult> {
    const prepared = this.deleteGrants.get(grantId);
    this.deleteGrants.delete(grantId);
    if (prepared) this.activeDeletes.add(prepared);
    let isolated: IsolatedDeleteEntry | null = null;
    try {
      if (
        !prepared ||
        prepared.expiresAt <= this.now() ||
        prepared.grant.runtimeInstanceId !== runtimeInstanceId ||
        prepared.grant.workspaceId !== workspaceId ||
        prepared.grant.workspaceGeneration !== workspaceGeneration ||
        prepared.grant.relativePath !== relativePath
      ) {
        throw new OnlyPreviewContractError('INVALID_INPUT', 'Delete grant is unavailable.');
      }
      const operation = this.authorityOperation;
      const workspace = this.requireWorkspace(workspaceId, workspaceGeneration);
      await this.requireCurrentRoot(workspace, operation);
      await this.requirePinnedDeleteIdentity(prepared);
      isolated = await this.isolateDeleteEntry(prepared.canonicalPath);
      await this.requireIsolatedDeleteIdentity(prepared, isolated, workspace);
      await this.requireCurrentRoot(workspace, operation);
      // After the isolate rename the original path is gone by design. A file is still pinned by its
      // open descriptor, which follows the inode; a directory has no descriptor, so re-checking its
      // old path would ENOENT every time — the isolated check above and below is its identity.
      await this.requirePinnedDeleteIdentity(prepared, { isolated: true });
      await this.requireIsolatedDeleteIdentity(prepared, isolated, workspace);
      this.requireActiveWorkspace(workspace, operation);
      if (prepared.nodeKind === 'directory') {
        await this.fileOperations.removeTree(isolated.entryPath);
      } else {
        await this.fileOperations.unlink(isolated.entryPath);
      }
      const isolatedDirectory = isolated.directoryPath;
      isolated = null;
      await this.fileOperations.rmdir(isolatedDirectory).catch(() => undefined);
      return {
        runtimeInstanceId,
        workspaceId,
        workspaceGeneration,
        relativePath: prepared.grant.relativePath,
        grantId,
        size: prepared.grant.size,
        modifiedAt: prepared.grant.modifiedAt
      };
    } catch (error) {
      if (isolated) {
        await this.restoreIsolatedDeleteEntry(isolated, prepared?.nodeKind ?? 'file');
        // Whether or not the entry could be put back, the recovery directory itself is ours and has
        // no business being left in the owner's Project.
        await this.fileOperations.rmdir(isolated.directoryPath).catch(() => undefined);
      }
      return toSafeProjectError(error, 'delete');
    } finally {
      if (prepared) {
        this.activeDeletes.delete(prepared);
        await this.closePreparedDeleteGrant(prepared);
      }
    }
  }

  async cancelDelete(
    runtimeInstanceId: string,
    workspaceId: string,
    workspaceGeneration: number,
    grantId: string,
    relativePath: string
  ): Promise<void> {
    const prepared = this.deleteGrants.get(grantId);
    if (
      prepared?.grant.runtimeInstanceId === runtimeInstanceId &&
      prepared.grant.workspaceId === workspaceId &&
      prepared.grant.workspaceGeneration === workspaceGeneration &&
      prepared.grant.relativePath === relativePath
    ) {
      this.deleteGrants.delete(grantId);
      await this.closePreparedDeleteGrant(prepared);
    }
  }

  dispose(): void {
    this.authorityOperation += 1;
    this.generation += 1;
    this.workspace = null;
    const prepared = [...this.deleteGrants.values(), ...this.activeDeletes];
    this.deleteGrants.clear();
    this.activeDeletes.clear();
    for (const grant of prepared) void this.closePreparedDeleteGrant(grant);
  }

  private requireWorkspace(
    workspaceId: string,
    workspaceGeneration: number
  ): ProjectWorkspaceAuthority {
    const workspace = this.workspace;
    if (
      !workspace ||
      workspace.workspaceId !== workspaceId ||
      workspace.generation !== workspaceGeneration
    ) {
      throw new OnlyPreviewContractError(
        'WORKSPACE_ACCESS_DENIED',
        'Project authority does not match the active workspace.'
      );
    }
    return workspace;
  }

  private async requireCurrentRoot(
    workspace: ProjectWorkspaceAuthority,
    operation: number
  ): Promise<BigIntStats> {
    const lexicalStats = await this.fileOperations.lstat(workspace.rootRealPath);
    const rootRealPath = await this.fileOperations.realpath(workspace.rootRealPath);
    const rootStats = await this.fileOperations.stat(rootRealPath);
    if (
      lexicalStats.isSymbolicLink() ||
      rootRealPath !== workspace.rootRealPath ||
      !rootStats.isDirectory() ||
      lexicalStats.dev !== workspace.deviceId ||
      lexicalStats.ino !== workspace.inode ||
      rootStats.dev !== workspace.deviceId ||
      rootStats.ino !== workspace.inode
    ) {
      throw new OnlyPreviewContractError(
        'PATH_OUTSIDE_WORKSPACE',
        'The Project workspace authority changed.'
      );
    }
    this.requireActiveWorkspace(workspace, operation);
    return rootStats;
  }

  private async resolveDirectory(
    workspace: ProjectWorkspaceAuthority,
    parentRelativePath: unknown,
    operation: number
  ): Promise<{ relativePath: string; canonicalPath: string }> {
    if (typeof parentRelativePath !== 'string') {
      throw new OnlyPreviewContractError('INVALID_INPUT', 'The parent folder is invalid.');
    }
    if (!normalizeOnlyPreviewRelativePath(parentRelativePath)) {
      await this.requireCurrentRoot(workspace, operation);
      this.requireActiveWorkspace(workspace, operation);
      return { relativePath: '', canonicalPath: workspace.rootRealPath };
    }
    const parent = await this.resolveItem(workspace, parentRelativePath, operation);
    if (parent.nodeKind !== 'directory') {
      throw new OnlyPreviewContractError(
        'PATH_NOT_REGULAR_FILE',
        'A new folder can only be created inside a folder.'
      );
    }
    return { relativePath: parent.relativePath, canonicalPath: parent.canonicalPath };
  }

  private async resolveItem(
    workspace: ProjectWorkspaceAuthority,
    relativePath: string,
    operation: number
  ): Promise<{
    relativePath: string;
    name: string;
    nodeKind: 'file' | 'directory';
    canonicalPath: string;
    size: number;
    modifiedAt: number;
    identity: ProjectFileIdentity;
  }> {
    await this.requireCurrentRoot(workspace, operation);
    const normalizedPath = normalizeOnlyPreviewRelativePath(relativePath);
    const candidate = resolve(workspace.rootRealPath, ...normalizedPath.split('/'));
    if (!isContainedPath(workspace.rootRealPath, candidate)) {
      throw new OnlyPreviewContractError(
        'PATH_OUTSIDE_WORKSPACE',
        'The Project item is outside its workspace.'
      );
    }
    const lexicalStats = await this.fileOperations.lstat(candidate);
    if (lexicalStats.isSymbolicLink()) {
      throw new OnlyPreviewContractError(
        'PATH_NOT_REGULAR_FILE',
        'Symbolic links cannot be used as Project items.'
      );
    }
    const canonicalPath = await this.fileOperations.realpath(candidate);
    const itemStats = await this.fileOperations.stat(canonicalPath);
    if (canonicalPath !== candidate || !isContainedPath(workspace.rootRealPath, canonicalPath)) {
      throw new OnlyPreviewContractError(
        'PATH_OUTSIDE_WORKSPACE',
        'The Project item is outside its workspace.'
      );
    }
    if (!itemStats.isFile() && !itemStats.isDirectory()) {
      throw new OnlyPreviewContractError(
        'PATH_UNSUPPORTED_DEVICE',
        'Only regular files and directories can be used as Project items.'
      );
    }
    if (
      lexicalStats.dev !== itemStats.dev ||
      lexicalStats.ino !== itemStats.ino ||
      lexicalStats.isFile() !== itemStats.isFile() ||
      lexicalStats.isDirectory() !== itemStats.isDirectory()
    ) {
      throw new OnlyPreviewContractError(
        'PATH_NOT_FOUND',
        'The selected Project item changed while it was authorized.'
      );
    }
    const size = itemStats.isDirectory() ? 0 : Number(itemStats.size);
    const modifiedAt = Number(itemStats.mtimeMs);
    if (!Number.isSafeInteger(size) || !Number.isFinite(modifiedAt)) {
      throw new OnlyPreviewContractError(
        'OPERATION_FAILED',
        'The selected Project item metadata is invalid.'
      );
    }
    this.requireActiveWorkspace(workspace, operation);
    return {
      relativePath: normalizedPath,
      name: basename(canonicalPath),
      nodeKind: itemStats.isFile() ? 'file' : 'directory',
      canonicalPath,
      size,
      modifiedAt,
      identity: identityOf(itemStats)
    };
  }

  private toTarget(
    runtimeInstanceId: string,
    workspace: ProjectWorkspaceAuthority,
    item: Awaited<ReturnType<FileSearchProjectAuthority['resolveItem']>>
  ): OnlyPreviewFileAuthorityTarget {
    return {
      runtimeInstanceId,
      workspaceId: workspace.workspaceId,
      workspaceGeneration: workspace.generation,
      relativePath: item.relativePath,
      name: item.name,
      nodeKind: item.nodeKind,
      canonicalPath: item.canonicalPath,
      size: item.size,
      modifiedAt: item.modifiedAt
    };
  }

  private async openPinnedDeleteHandle(
    canonicalPath: string,
    identity: ProjectFileIdentity
  ): Promise<FileHandle> {
    const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0;
    let handle: FileHandle;
    try {
      handle = await this.fileOperations.open(canonicalPath, constants.O_RDONLY | noFollow);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | null)?.code;
      if (!noFollow || !['EINVAL', 'ENOTSUP', 'EOPNOTSUPP'].includes(String(code))) throw error;
      handle = await this.fileOperations.open(canonicalPath, constants.O_RDONLY);
    }
    try {
      const lexicalStats = await this.fileOperations.lstat(canonicalPath);
      const currentRealPath = await this.fileOperations.realpath(canonicalPath);
      const currentStats = await this.fileOperations.stat(currentRealPath);
      const handleStats = await handle.stat({ bigint: true });
      if (
        lexicalStats.isSymbolicLink() ||
        !lexicalStats.isFile() ||
        currentRealPath !== canonicalPath ||
        !currentStats.isFile() ||
        !handleStats.isFile() ||
        !sameIdentity(identity, identityOf(lexicalStats)) ||
        !sameIdentity(identity, identityOf(currentStats)) ||
        !sameIdentity(identity, identityOf(handleStats))
      ) {
        throw new OnlyPreviewContractError(
          'PATH_NOT_FOUND',
          'The selected file changed before Delete confirmation.'
        );
      }
      return handle;
    } catch (error) {
      await handle.close().catch(() => undefined);
      throw error;
    }
  }

  private async requirePinnedDeleteIdentity(
    prepared: PreparedDeleteGrant,
    options: { isolated?: boolean } = {}
  ): Promise<void> {
    if (prepared.handleClosed) {
      throw new OnlyPreviewContractError('INVALID_INPUT', 'Delete grant is unavailable.');
    }
    if (prepared.nodeKind === 'directory' || !prepared.handle) {
      // Nothing to check at the original path once the entry has been moved out of it.
      if (options.isolated) return;
      await this.requireDirectoryDeleteIdentity(prepared.canonicalPath, prepared.identity);
      return;
    }
    const handleStats = await prepared.handle.stat({ bigint: true });
    if (!handleStats.isFile() || !sameIdentity(prepared.identity, identityOf(handleStats))) {
      throw new OnlyPreviewContractError(
        'PATH_NOT_FOUND',
        'The selected file changed before it could be deleted.'
      );
    }
  }

  // The directory counterpart of the pinned handle. It runs immediately before the isolate rename
  // and again after it, so a directory swapped in between is refused rather than removed.
  private async requireDirectoryDeleteIdentity(
    canonicalPath: string,
    identity: ProjectFileIdentity
  ): Promise<void> {
    const lexicalStats = await this.fileOperations.lstat(canonicalPath);
    const currentRealPath = await this.fileOperations.realpath(canonicalPath);
    const currentStats = await this.fileOperations.stat(currentRealPath);
    if (
      lexicalStats.isSymbolicLink() ||
      !lexicalStats.isDirectory() ||
      currentRealPath !== canonicalPath ||
      !currentStats.isDirectory() ||
      !sameNodeIdentity(identity, identityOf(lexicalStats), 'directory') ||
      !sameNodeIdentity(identity, identityOf(currentStats), 'directory')
    ) {
      throw new OnlyPreviewContractError(
        'PATH_NOT_FOUND',
        'The selected folder changed before it could be deleted.'
      );
    }
  }

  private async isolateDeleteEntry(canonicalPath: string): Promise<IsolatedDeleteEntry> {
    let directoryPath = '';
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const candidate = join(dirname(canonicalPath), `.bitterless-delete-recovery-${randomUUID()}`);
      try {
        await this.fileOperations.mkdir(candidate, 0o700);
        directoryPath = candidate;
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException | null)?.code !== 'EEXIST') throw error;
      }
    }
    if (!directoryPath) {
      throw new OnlyPreviewContractError(
        'OPERATION_FAILED',
        'A private Delete recovery entry could not be reserved.'
      );
    }
    try {
      const isolated = {
        directoryPath,
        entryPath: join(directoryPath, 'entry'),
        originalPath: canonicalPath
      };
      await this.fileOperations.rename(canonicalPath, isolated.entryPath);
      return isolated;
    } catch (error) {
      await this.fileOperations.rmdir(directoryPath).catch(() => undefined);
      throw error;
    }
  }

  private async requireIsolatedDeleteIdentity(
    prepared: PreparedDeleteGrant,
    isolated: IsolatedDeleteEntry,
    workspace: ProjectWorkspaceAuthority
  ): Promise<void> {
    const lexicalStats = await this.fileOperations.lstat(isolated.entryPath);
    const isolatedRealPath = await this.fileOperations.realpath(isolated.entryPath);
    const isolatedStats = await this.fileOperations.stat(isolatedRealPath);
    const isExpectedKind = (stats: BigIntStats): boolean =>
      prepared.nodeKind === 'directory' ? stats.isDirectory() : stats.isFile();
    if (
      lexicalStats.isSymbolicLink() ||
      !isExpectedKind(lexicalStats) ||
      isolatedRealPath !== isolated.entryPath ||
      !isContainedPath(workspace.rootRealPath, isolatedRealPath) ||
      !isExpectedKind(isolatedStats) ||
      !sameNodeIdentity(prepared.identity, identityOf(lexicalStats), prepared.nodeKind) ||
      !sameNodeIdentity(prepared.identity, identityOf(isolatedStats), prepared.nodeKind)
    ) {
      throw new OnlyPreviewContractError(
        'PATH_NOT_FOUND',
        'The selected item was replaced before it could be deleted.'
      );
    }
  }

  private async restoreIsolatedDeleteEntry(
    isolated: IsolatedDeleteEntry,
    nodeKind: 'file' | 'directory'
  ): Promise<void> {
    try {
      await this.fileOperations.lstat(isolated.entryPath);
    } catch {
      return;
    }
    if (nodeKind === 'file') {
      try {
        await this.fileOperations.link(isolated.entryPath, isolated.originalPath);
      } catch {
        // The private recovery entry remains intact and no concurrent candidate is overwritten.
      }
      return;
    }
    // A directory cannot be hard-linked, so it is renamed back — but only onto a name nothing has
    // taken in the meantime, because `rename` would otherwise replace a concurrent candidate.
    try {
      await this.fileOperations.lstat(isolated.originalPath);
      return;
    } catch {
      // Nothing is there, which is the only case where moving it back is safe.
    }
    try {
      await this.fileOperations.rename(isolated.entryPath, isolated.originalPath);
    } catch {
      // The private recovery entry remains intact.
    }
  }

  private requireActiveWorkspace(workspace: ProjectWorkspaceAuthority, operation: number): void {
    if (operation !== this.authorityOperation || this.workspace !== workspace) {
      throw new OnlyPreviewContractError(
        'WORKSPACE_ACCESS_DENIED',
        'Project authority does not match the active workspace.'
      );
    }
  }

  private async closePreparedDeleteGrant(prepared: PreparedDeleteGrant): Promise<void> {
    if (prepared.handleClosed) return;
    prepared.handleClosed = true;
    if (prepared.expiryTimer) clearTimeout(prepared.expiryTimer);
    prepared.expiryTimer = null;
    await prepared.handle?.close().catch(() => undefined);
  }

  private async revokeDeleteGrants(): Promise<void> {
    const prepared = [...this.deleteGrants.values(), ...this.activeDeletes];
    this.deleteGrants.clear();
    for (const grant of prepared) await this.closePreparedDeleteGrant(grant);
  }

  private async pruneExpiredGrants(): Promise<void> {
    const now = this.now();
    for (const [grantId, prepared] of this.deleteGrants) {
      if (prepared.expiresAt > now) continue;
      this.deleteGrants.delete(grantId);
      await this.closePreparedDeleteGrant(prepared);
    }
  }
}
