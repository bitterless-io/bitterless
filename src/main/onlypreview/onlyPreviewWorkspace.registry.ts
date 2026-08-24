import { constants } from 'node:fs';
import { lstat, open, realpath, stat, unlink, type FileHandle } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  isOnlyPreviewPermissionError,
  OnlyPreviewContractError,
  normalizeOnlyPreviewRelativePath,
  parseOnlyPreviewFileRef
} from '@shared/onlypreview/onlyPreview.contract';
import type {
  OnlyPreviewFileRef,
  OnlyPreviewWorkspace
} from '@shared/onlypreview/onlyPreview.types';
import {
  onlyPreviewHostRegistry,
  type OnlyPreviewHostCapability,
  type OnlyPreviewHostRegistry
} from './onlyPreviewHost.registry';

const MAX_WORKSPACES = 128;

const throwOnlyPreviewPathAccessError = (error: unknown, missingMessage: string): never => {
  if (isOnlyPreviewPermissionError(error)) {
    throw new OnlyPreviewContractError(
      'PATH_PERMISSION_DENIED',
      'Bitterless does not have permission to read this file or folder.'
    );
  }
  throw new OnlyPreviewContractError('PATH_NOT_FOUND', missingMessage);
};

const throwOnlyPreviewDeleteError = (error: unknown): never => {
  if (error instanceof OnlyPreviewContractError) throw error;
  if (isOnlyPreviewPermissionError(error)) {
    throw new OnlyPreviewContractError(
      'PATH_PERMISSION_DENIED',
      'Bitterless does not have permission to delete this file.'
    );
  }
  const code = (error as NodeJS.ErrnoException | null)?.code;
  if (code === 'ENOENT' || code === 'ENOTDIR') {
    throw new OnlyPreviewContractError(
      'PATH_NOT_FOUND',
      'The selected file is no longer available.'
    );
  }
  throw new OnlyPreviewContractError(
    'OPERATION_FAILED',
    'The selected file could not be deleted safely.'
  );
};

export interface OnlyPreviewWorkspaceRecord {
  workspaceId: string;
  hostToken: string;
  rootRealPath: string;
  rootName: string;
  displayPath: string;
  selectedRelativePath?: string;
  createdAt: number;
}

export interface ResolvedOnlyPreviewFile {
  host: OnlyPreviewHostCapability;
  workspace: OnlyPreviewWorkspaceRecord;
  relativePath: string;
  realPath: string;
  size: number;
  modifiedAt: number;
}

export interface ResolvedOnlyPreviewProjectItem extends ResolvedOnlyPreviewFile {
  nodeKind: 'file' | 'directory';
}

export interface OpenedOnlyPreviewFile extends ResolvedOnlyPreviewFile {
  fileHandle: FileHandle;
  deviceId: bigint;
  inode: bigint;
  modifiedTimeNanoseconds: bigint;
}

const isContainedPath = (root: string, candidate: string): boolean => {
  const child = relative(root, candidate);
  return child === '' || (!child.startsWith(`..${sep}`) && child !== '..' && !isAbsolute(child));
};

type WorkspaceRevocationListener = (workspace: OnlyPreviewWorkspaceRecord) => void;

const toSnapshot = (workspace: OnlyPreviewWorkspaceRecord): OnlyPreviewWorkspace => ({
  workspaceId: workspace.workspaceId,
  rootName: workspace.rootName,
  displayPath: workspace.displayPath,
  ...(workspace.selectedRelativePath
    ? { selectedRelativePath: workspace.selectedRelativePath }
    : {})
});

export class OnlyPreviewWorkspaceRegistry {
  private readonly workspaces = new Map<string, OnlyPreviewWorkspaceRecord>();
  private readonly latestWorkspaceByHost = new Map<string, string>();
  private readonly revocationListeners = new Set<WorkspaceRevocationListener>();

  constructor(private readonly hosts: OnlyPreviewHostRegistry) {
    hosts.onRevoke((host) => this.revokeHost(host.hostToken));
  }

  async createForTarget(
    hostToken: unknown,
    absoluteTarget: unknown
  ): Promise<OnlyPreviewWorkspace> {
    const host = this.hosts.require(hostToken, ['content']);
    if (typeof absoluteTarget !== 'string' || !isAbsolute(absoluteTarget)) {
      throw new OnlyPreviewContractError(
        'INVALID_INPUT',
        'OnlyPreview target must be an absolute Main-owned path.'
      );
    }
    const replacingOwnWorkspace = [...this.workspaces.values()].some(
      (workspace) => workspace.hostToken === host.hostToken
    );
    if (this.workspaces.size >= MAX_WORKSPACES && !replacingOwnWorkspace) {
      throw new OnlyPreviewContractError(
        'OPERATION_FAILED',
        'OnlyPreview has too many live workspaces.'
      );
    }

    let targetRealPath: string;
    try {
      targetRealPath = await realpath(absoluteTarget);
    } catch (error) {
      throwOnlyPreviewPathAccessError(error, 'The selected target is no longer available.');
    }

    let targetStat: Awaited<ReturnType<typeof stat>>;
    try {
      targetStat = await stat(targetRealPath);
    } catch (error) {
      throwOnlyPreviewPathAccessError(error, 'The selected target is no longer available.');
    }
    if (!targetStat.isFile() && !targetStat.isDirectory()) {
      throw new OnlyPreviewContractError(
        'PATH_UNSUPPORTED_DEVICE',
        'Only regular files and directories can be previewed.'
      );
    }

    let rootRealPath: string;
    try {
      rootRealPath = targetStat.isDirectory()
        ? targetRealPath
        : await realpath(dirname(targetRealPath));
    } catch (error) {
      throwOnlyPreviewPathAccessError(error, 'The selected target is no longer available.');
    }
    const selectedRelativePath = targetStat.isFile()
      ? normalizeOnlyPreviewRelativePath(basename(targetRealPath))
      : undefined;
    const record: OnlyPreviewWorkspaceRecord = {
      workspaceId: randomUUID(),
      hostToken: host.hostToken,
      rootRealPath,
      rootName: basename(rootRealPath) || rootRealPath,
      displayPath: rootRealPath,
      ...(selectedRelativePath ? { selectedRelativePath } : {}),
      createdAt: Date.now()
    };
    this.revokeHost(host.hostToken);
    this.workspaces.set(record.workspaceId, record);
    this.latestWorkspaceByHost.set(host.hostToken, record.workspaceId);
    return toSnapshot(record);
  }

  restore(hostToken: unknown): OnlyPreviewWorkspace | null {
    const host = this.hosts.require(hostToken, ['content']);
    const workspaceId = this.latestWorkspaceByHost.get(host.hostToken);
    if (!workspaceId) return null;
    const workspace = this.workspaces.get(workspaceId);
    return workspace ? toSnapshot(workspace) : null;
  }

  requireWorkspace(hostToken: unknown, workspaceId: unknown): OnlyPreviewWorkspaceRecord {
    const host = this.hosts.require(hostToken, ['content']);
    if (typeof workspaceId !== 'string' || workspaceId.length < 16 || workspaceId.length > 256) {
      throw new OnlyPreviewContractError('INVALID_INPUT', 'Workspace capability is invalid.');
    }
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) {
      throw new OnlyPreviewContractError(
        'WORKSPACE_NOT_FOUND',
        'OnlyPreview workspace is no longer available.'
      );
    }
    if (workspace.hostToken !== host.hostToken) {
      throw new OnlyPreviewContractError(
        'WORKSPACE_ACCESS_DENIED',
        'Workspace belongs to another OnlyPreview host.'
      );
    }
    return workspace;
  }

  async resolveProjectItem(
    hostToken: unknown,
    value: unknown
  ): Promise<ResolvedOnlyPreviewProjectItem> {
    const host = this.hosts.require(hostToken, ['content']);
    const fileRef = parseOnlyPreviewFileRef(value);
    const workspace = this.requireWorkspace(host.hostToken, fileRef.workspaceId);
    const candidate = resolve(workspace.rootRealPath, ...fileRef.relativePath.split('/'));
    if (!isContainedPath(workspace.rootRealPath, candidate)) {
      throw new OnlyPreviewContractError(
        'PATH_OUTSIDE_WORKSPACE',
        'File reference leaves its workspace.'
      );
    }

    let candidateRealPath: string;
    let candidateStat: Awaited<ReturnType<typeof lstat>>;
    try {
      candidateStat = await lstat(candidate);
      candidateRealPath = await realpath(candidate);
    } catch (error) {
      throwOnlyPreviewPathAccessError(error, 'The selected file is no longer available.');
    }
    if (!isContainedPath(workspace.rootRealPath, candidateRealPath)) {
      throw new OnlyPreviewContractError(
        'PATH_OUTSIDE_WORKSPACE',
        'Symbolic link leaves its workspace.'
      );
    }
    if (candidateStat.isSymbolicLink()) {
      throw new OnlyPreviewContractError(
        'PATH_NOT_REGULAR_FILE',
        'Symbolic links cannot be used as Project items.'
      );
    }
    let itemStat: Awaited<ReturnType<typeof stat>>;
    try {
      itemStat = await stat(candidateRealPath);
    } catch (error) {
      throwOnlyPreviewPathAccessError(error, 'The selected Project item is no longer available.');
    }
    if (!itemStat.isFile() && !itemStat.isDirectory()) {
      throw new OnlyPreviewContractError(
        'PATH_UNSUPPORTED_DEVICE',
        'Only regular files and directories can be used as Project items.'
      );
    }
    return {
      host,
      workspace,
      relativePath: fileRef.relativePath,
      realPath: candidateRealPath,
      size: itemStat.size,
      modifiedAt: itemStat.mtimeMs,
      nodeKind: itemStat.isFile() ? 'file' : 'directory'
    };
  }

  async resolveFile(hostToken: unknown, value: unknown): Promise<ResolvedOnlyPreviewFile> {
    const item = await this.resolveProjectItem(hostToken, value);
    if (item.nodeKind !== 'file') {
      throw new OnlyPreviewContractError(
        'PATH_NOT_REGULAR_FILE',
        'Directories cannot be rendered as files.'
      );
    }
    return {
      host: item.host,
      workspace: item.workspace,
      relativePath: item.relativePath,
      realPath: item.realPath,
      size: item.size,
      modifiedAt: item.modifiedAt
    };
  }

  async openFile(hostToken: unknown, value: unknown): Promise<OpenedOnlyPreviewFile> {
    const file = await this.resolveFile(hostToken, value);
    const flags = constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW);
    let fileHandle: FileHandle | null = null;
    try {
      fileHandle = await open(file.realPath, flags);
      const openedStat = await fileHandle.stat({ bigint: true });
      if (!openedStat.isFile()) {
        throw new OnlyPreviewContractError(
          'PATH_NOT_REGULAR_FILE',
          'Only regular files can be previewed.'
        );
      }

      const postOpenRealPath = await realpath(file.realPath);
      if (
        postOpenRealPath !== file.realPath ||
        !isContainedPath(file.workspace.rootRealPath, postOpenRealPath)
      ) {
        throw new OnlyPreviewContractError(
          'PATH_OUTSIDE_WORKSPACE',
          'File identity changed outside its workspace while it was opened.'
        );
      }
      const pathStat = await stat(postOpenRealPath, { bigint: true });
      if (pathStat.dev !== openedStat.dev || pathStat.ino !== openedStat.ino) {
        throw new OnlyPreviewContractError(
          'PATH_NOT_FOUND',
          'The selected file changed while it was opened.'
        );
      }

      return {
        ...file,
        size: Number(openedStat.size),
        modifiedAt: Number(openedStat.mtimeMs),
        deviceId: openedStat.dev,
        inode: openedStat.ino,
        modifiedTimeNanoseconds: openedStat.mtimeNs,
        fileHandle
      };
    } catch (error) {
      await fileHandle?.close().catch(() => undefined);
      if (error instanceof OnlyPreviewContractError) throw error;
      throwOnlyPreviewPathAccessError(error, 'The selected file could not be opened safely.');
    }
  }

  async assertOpenedFileCurrent(file: OpenedOnlyPreviewFile): Promise<void> {
    const openedStat = await file.fileHandle.stat({ bigint: true });
    if (
      !openedStat.isFile() ||
      openedStat.dev !== file.deviceId ||
      openedStat.ino !== file.inode ||
      openedStat.size !== BigInt(file.size) ||
      openedStat.mtimeNs !== file.modifiedTimeNanoseconds
    ) {
      throw new OnlyPreviewContractError(
        'PATH_NOT_FOUND',
        'The selected file changed while it was being read.'
      );
    }

    const current = await this.openFile(file.host.hostToken, {
      workspaceId: file.workspace.workspaceId,
      relativePath: file.relativePath
    });
    try {
      if (
        current.realPath !== file.realPath ||
        current.size !== file.size ||
        current.deviceId !== file.deviceId ||
        current.inode !== file.inode ||
        current.modifiedTimeNanoseconds !== file.modifiedTimeNanoseconds
      ) {
        throw new OnlyPreviewContractError(
          'PATH_NOT_FOUND',
          'The selected file was replaced while it was being read.'
        );
      }
    } finally {
      await current.fileHandle.close().catch(() => undefined);
    }
  }

  async deleteOpenedFile(file: OpenedOnlyPreviewFile): Promise<ResolvedOnlyPreviewFile> {
    let deletionContext: {
      host: OnlyPreviewHostCapability;
      fileRef: OnlyPreviewFileRef;
      workspace: OnlyPreviewWorkspaceRecord;
      candidate: string;
    };
    try {
      const host = this.hosts.require(file.host.hostToken, ['content']);
      const fileRef = parseOnlyPreviewFileRef({
        workspaceId: file.workspace.workspaceId,
        relativePath: file.relativePath
      });
      const workspace = this.requireWorkspace(host.hostToken, fileRef.workspaceId);
      const candidate = resolve(workspace.rootRealPath, ...fileRef.relativePath.split('/'));
      if (!isContainedPath(workspace.rootRealPath, candidate)) {
        throw new OnlyPreviewContractError(
          'PATH_OUTSIDE_WORKSPACE',
          'File reference leaves its workspace.'
        );
      }
      deletionContext = { host, fileRef, workspace, candidate };
    } catch (error) {
      await file.fileHandle.close().catch(() => undefined);
      throw error;
    }
    const { host, fileRef, workspace, candidate } = deletionContext;

    let openedStat: Awaited<ReturnType<FileHandle['stat']>>;
    try {
      openedStat = await file.fileHandle.stat({ bigint: true });
      if (
        !openedStat.isFile() ||
        openedStat.dev !== file.deviceId ||
        openedStat.ino !== file.inode ||
        openedStat.size !== BigInt(file.size) ||
        openedStat.mtimeNs !== file.modifiedTimeNanoseconds
      ) {
        throw new OnlyPreviewContractError(
          'PATH_NOT_FOUND',
          'The selected file changed before it could be deleted.'
        );
      }
    } catch (error) {
      throwOnlyPreviewDeleteError(error);
    } finally {
      await file.fileHandle.close().catch(() => undefined);
    }

    try {
      const pathStat = await lstat(candidate, { bigint: true });
      if (pathStat.isSymbolicLink() || !pathStat.isFile()) {
        throw new OnlyPreviewContractError(
          'PATH_NOT_REGULAR_FILE',
          'Only regular files can be deleted.'
        );
      }
      const candidateRealPath = await realpath(candidate);
      if (
        candidateRealPath !== file.realPath ||
        !isContainedPath(workspace.rootRealPath, candidateRealPath)
      ) {
        throw new OnlyPreviewContractError(
          'PATH_OUTSIDE_WORKSPACE',
          'File identity changed outside its workspace before deletion.'
        );
      }
      if (
        pathStat.dev !== openedStat.dev ||
        pathStat.ino !== openedStat.ino ||
        pathStat.size !== openedStat.size ||
        pathStat.mtimeNs !== openedStat.mtimeNs
      ) {
        throw new OnlyPreviewContractError(
          'PATH_NOT_FOUND',
          'The selected file was replaced before it could be deleted.'
        );
      }
      await unlink(candidate);
    } catch (error) {
      throwOnlyPreviewDeleteError(error);
    }

    return {
      host,
      workspace,
      relativePath: fileRef.relativePath,
      realPath: file.realPath,
      size: file.size,
      modifiedAt: file.modifiedAt
    };
  }

  select(hostToken: unknown, value: OnlyPreviewFileRef): void {
    const fileRef = parseOnlyPreviewFileRef(value);
    const workspace = this.requireWorkspace(hostToken, fileRef.workspaceId);
    workspace.selectedRelativePath = fileRef.relativePath;
    this.latestWorkspaceByHost.set(workspace.hostToken, workspace.workspaceId);
  }

  clearSelection(hostToken: unknown, value: OnlyPreviewFileRef): boolean {
    const fileRef = parseOnlyPreviewFileRef(value);
    const workspace = this.requireWorkspace(hostToken, fileRef.workspaceId);
    if (workspace.selectedRelativePath !== fileRef.relativePath) return false;
    delete workspace.selectedRelativePath;
    return true;
  }

  revokeHost(hostToken: string): void {
    for (const workspace of [...this.workspaces.values()]) {
      if (workspace.hostToken === hostToken) this.revokeWorkspace(workspace.workspaceId);
    }
    this.latestWorkspaceByHost.delete(hostToken);
  }

  revokeWorkspace(workspaceId: string): boolean {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) return false;
    this.workspaces.delete(workspaceId);
    if (this.latestWorkspaceByHost.get(workspace.hostToken) === workspaceId) {
      this.latestWorkspaceByHost.delete(workspace.hostToken);
    }
    for (const listener of this.revocationListeners) listener(workspace);
    return true;
  }

  onRevoke(listener: WorkspaceRevocationListener): () => void {
    this.revocationListeners.add(listener);
    return () => this.revocationListeners.delete(listener);
  }

  clear(): void {
    for (const workspaceId of [...this.workspaces.keys()]) this.revokeWorkspace(workspaceId);
  }
}

export const onlyPreviewWorkspaceRegistry = new OnlyPreviewWorkspaceRegistry(
  onlyPreviewHostRegistry
);
