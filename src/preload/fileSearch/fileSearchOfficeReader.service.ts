import { constants, type BigIntStats } from 'node:fs';
import { lstat, open, realpath, stat, type FileHandle } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { OnlyPreviewContractError } from '@shared/onlypreview/onlyPreview.contract';
import {
  ONLY_PREVIEW_OFFICE_READ_CHUNK_BYTES,
  ONLY_PREVIEW_OFFICE_READ_MAX_BYTES,
  type OnlyPreviewOfficePrepareGrant,
  type OnlyPreviewOfficePrepareRuntimeResult,
  type OnlyPreviewOfficeReadChunkRuntimeResult,
  type OnlyPreviewOfficeReadOpenRuntimeResult
} from '@shared/onlypreview/onlyPreviewOfficeReadRuntime.types';

interface OfficeWorkspaceAuthority {
  workspaceId: string;
  generation: number;
  rootPath: string;
  deviceId: bigint;
  inode: bigint;
}

interface OfficeFileIdentity {
  deviceId: bigint;
  inode: bigint;
  size: bigint;
  modifiedTimeNanoseconds: bigint;
}

interface PreparedOfficeRead {
  grant: OnlyPreviewOfficePrepareGrant;
  workspaceGeneration: number;
  rootRealPath: string;
  fileRealPath: string;
  identity: OfficeFileIdentity;
  modifiedAt: number;
}

interface ActiveOfficeRead {
  generation: number;
  prepared: PreparedOfficeRead;
  handle: FileHandle;
  offset: number;
  cancelled: boolean;
}

const isContainedPath = (root: string, candidate: string): boolean => {
  const child = relative(root, candidate);
  return child === '' || (!child.startsWith(`..${sep}`) && child !== '..' && !isAbsolute(child));
};

const identityOf = (stats: BigIntStats): OfficeFileIdentity => ({
  deviceId: stats.dev,
  inode: stats.ino,
  size: stats.size,
  modifiedTimeNanoseconds: stats.mtimeNs
});

const sameIdentity = (left: OfficeFileIdentity, right: OfficeFileIdentity): boolean =>
  left.deviceId === right.deviceId &&
  left.inode === right.inode &&
  left.size === right.size &&
  left.modifiedTimeNanoseconds === right.modifiedTimeNanoseconds;

const secureOpenFlags = (): number => {
  if (typeof constants.O_NOFOLLOW !== 'number') {
    throw new OnlyPreviewContractError(
      'PATH_NOT_REGULAR_FILE',
      'Secure Office file reads are unavailable.'
    );
  }
  return constants.O_RDONLY | constants.O_NOFOLLOW | (constants.O_CLOEXEC ?? 0);
};

const resolveCandidate = (rootRealPath: string, relativePath: string): string => {
  if (!relativePath || isAbsolute(relativePath) || relativePath.includes('\0')) {
    throw new OnlyPreviewContractError('INVALID_INPUT', 'Office read grant is invalid.');
  }
  const candidate = resolve(rootRealPath, relativePath);
  if (!isContainedPath(rootRealPath, candidate)) {
    throw new OnlyPreviewContractError(
      'PATH_OUTSIDE_WORKSPACE',
      'The selected Office file is outside its workspace.'
    );
  }
  return candidate;
};

const toSafeReadError = (error: unknown, phase: 'prepare' | 'read'): never => {
  if (error instanceof OnlyPreviewContractError) throw error;
  throw new OnlyPreviewContractError(
    'PATH_NOT_FOUND',
    phase === 'prepare'
      ? 'The selected Office file could not be prepared safely.'
      : 'The selected Office file could not be read safely.'
  );
};

export class FileSearchOfficeReader {
  private workspace: OfficeWorkspaceAuthority | null = null;
  private prepared: PreparedOfficeRead | null = null;
  private active: ActiveOfficeRead | null = null;
  private generation = 0;
  private authorityOperation = 0;
  private pendingPrepare: OnlyPreviewOfficePrepareGrant | null = null;
  private pendingOpen: OnlyPreviewOfficePrepareGrant | null = null;
  private latestSelectionRevision = -1;

  async bindWorkspace(workspaceId: string, rootPath: string): Promise<void> {
    const operation = ++this.authorityOperation;
    await this.cancelInternal();
    try {
      const pathStats = await lstat(rootPath);
      if (pathStats.isSymbolicLink()) {
        throw new OnlyPreviewContractError(
          'PATH_NOT_REGULAR_FILE',
          'Symbolic links cannot be used as Office workspaces.'
        );
      }
      const rootRealPath = await realpath(rootPath);
      const rootStats = await stat(rootRealPath, { bigint: true });
      const finalPathStats = await lstat(rootPath, { bigint: true });
      if (!rootStats.isDirectory()) {
        throw new OnlyPreviewContractError(
          'PATH_NOT_REGULAR_FILE',
          'The Office workspace root is not a directory.'
        );
      }
      if (
        finalPathStats.isSymbolicLink() ||
        finalPathStats.dev !== rootStats.dev ||
        finalPathStats.ino !== rootStats.ino
      ) {
        throw new OnlyPreviewContractError(
          'PATH_OUTSIDE_WORKSPACE',
          'The Office workspace authority changed.'
        );
      }
      if (operation !== this.authorityOperation) {
        throw new OnlyPreviewContractError(
          'OPERATION_FAILED',
          'The Office workspace was superseded.'
        );
      }
      this.workspace = {
        workspaceId,
        generation: (this.workspace?.generation ?? 0) + 1,
        rootPath: rootRealPath,
        deviceId: rootStats.dev,
        inode: rootStats.ino
      };
      this.latestSelectionRevision = -1;
    } catch (error) {
      return toSafeReadError(error, 'prepare');
    }
  }

  async prepare(
    grant: OnlyPreviewOfficePrepareGrant
  ): Promise<OnlyPreviewOfficePrepareRuntimeResult> {
    const operation = ++this.authorityOperation;
    const workspace = this.workspace;
    if (
      !workspace ||
      grant.workspaceId !== workspace.workspaceId ||
      !Number.isSafeInteger(grant.selectionRevision) ||
      grant.selectionRevision <= this.latestSelectionRevision
    ) {
      throw new OnlyPreviewContractError(
        'WORKSPACE_ACCESS_DENIED',
        'Office read grant does not match the active workspace.'
      );
    }
    if (
      !Number.isSafeInteger(grant.maxBytes) ||
      grant.maxBytes < 0 ||
      grant.maxBytes > ONLY_PREVIEW_OFFICE_READ_MAX_BYTES
    ) {
      throw new OnlyPreviewContractError(
        'TEXT_TOO_LARGE',
        'The selected Office file exceeds the preview limit.'
      );
    }
    this.latestSelectionRevision = grant.selectionRevision;
    this.pendingPrepare = grant;
    await this.cancelInternal();
    try {
      this.requireAuthorityOperation(operation, workspace);
      const rootRealPath = await realpath(workspace.rootPath);
      this.requireAuthorityOperation(operation, workspace);
      const rootStats = await stat(rootRealPath, { bigint: true });
      this.requireAuthorityOperation(operation, workspace);
      if (
        !rootStats.isDirectory() ||
        rootStats.dev !== workspace.deviceId ||
        rootStats.ino !== workspace.inode
      ) {
        throw new OnlyPreviewContractError(
          'PATH_OUTSIDE_WORKSPACE',
          'The Office workspace authority changed.'
        );
      }
      const candidate = resolveCandidate(rootRealPath, grant.relativePath);
      const fileRealPath = await realpath(candidate);
      this.requireAuthorityOperation(operation, workspace);
      if (fileRealPath !== candidate || !isContainedPath(rootRealPath, fileRealPath)) {
        throw new OnlyPreviewContractError(
          'PATH_OUTSIDE_WORKSPACE',
          'The selected Office file is outside its workspace.'
        );
      }
      const handle = await open(candidate, secureOpenFlags());
      try {
        const stats = await handle.stat({ bigint: true });
        const postOpenRealPath = await realpath(candidate);
        const postOpenStats = await stat(postOpenRealPath, { bigint: true });
        this.requireAuthorityOperation(operation, workspace);
        if (!stats.isFile()) {
          throw new OnlyPreviewContractError(
            'PATH_NOT_REGULAR_FILE',
            'Only regular Office files can be previewed.'
          );
        }
        if (
          postOpenRealPath !== fileRealPath ||
          !isContainedPath(rootRealPath, postOpenRealPath) ||
          postOpenStats.dev !== stats.dev ||
          postOpenStats.ino !== stats.ino
        ) {
          throw new OnlyPreviewContractError(
            'PATH_OUTSIDE_WORKSPACE',
            'The Office file authority changed.'
          );
        }
        if (
          stats.size > BigInt(grant.maxBytes) ||
          stats.size > BigInt(ONLY_PREVIEW_OFFICE_READ_MAX_BYTES)
        ) {
          throw new OnlyPreviewContractError(
            'TEXT_TOO_LARGE',
            'The selected Office file exceeds the preview limit.'
          );
        }
        const size = Number(stats.size);
        const modifiedAt = Number(stats.mtimeMs);
        if (!Number.isSafeInteger(size) || !Number.isFinite(modifiedAt)) {
          throw new OnlyPreviewContractError(
            'TEXT_TOO_LARGE',
            'The selected Office file exceeds the preview limit.'
          );
        }
        const prepared: PreparedOfficeRead = {
          grant,
          workspaceGeneration: workspace.generation,
          rootRealPath,
          fileRealPath,
          identity: identityOf(stats),
          modifiedAt
        };
        this.requireAuthorityOperation(operation, workspace);
        this.prepared = prepared;
        if (this.pendingPrepare === grant) this.pendingPrepare = null;
        return {
          grantId: grant.grantId,
          runtimeId: grant.runtimeId,
          selectionRevision: grant.selectionRevision,
          kind: grant.kind,
          size,
          modifiedAt
        };
      } finally {
        await handle.close().catch(() => undefined);
      }
    } catch (error) {
      if (operation === this.authorityOperation) this.prepared = null;
      if (this.pendingPrepare === grant) this.pendingPrepare = null;
      return toSafeReadError(error, 'prepare');
    }
  }

  async open(
    grantId: string,
    runtimeId: string,
    selectionRevision: number
  ): Promise<OnlyPreviewOfficeReadOpenRuntimeResult> {
    const operation = this.authorityOperation;
    const prepared = this.prepared;
    const workspace = this.workspace;
    if (
      !prepared ||
      !workspace ||
      prepared.workspaceGeneration !== workspace.generation ||
      prepared.grant.grantId !== grantId ||
      prepared.grant.runtimeId !== runtimeId ||
      prepared.grant.selectionRevision !== selectionRevision
    ) {
      throw new OnlyPreviewContractError('INVALID_INPUT', 'Office read grant is unavailable.');
    }
    this.pendingOpen = prepared.grant;
    this.prepared = null;
    await this.cancelActive();
    let handle: FileHandle | null = null;
    try {
      this.requireAuthorityOperation(operation, workspace);
      const rootRealPath = await realpath(workspace.rootPath);
      this.requireAuthorityOperation(operation, workspace);
      const rootStats = await stat(rootRealPath, { bigint: true });
      this.requireAuthorityOperation(operation, workspace);
      const fileRealPath = await realpath(prepared.fileRealPath);
      this.requireAuthorityOperation(operation, workspace);
      if (
        rootRealPath !== prepared.rootRealPath ||
        !rootStats.isDirectory() ||
        rootStats.dev !== workspace.deviceId ||
        rootStats.ino !== workspace.inode ||
        fileRealPath !== prepared.fileRealPath ||
        !isContainedPath(rootRealPath, fileRealPath)
      ) {
        throw new OnlyPreviewContractError(
          'PATH_OUTSIDE_WORKSPACE',
          'The Office read authority changed.'
        );
      }
      handle = await open(prepared.fileRealPath, secureOpenFlags());
      this.requireAuthorityOperation(operation, workspace);
      const stats = await handle.stat({ bigint: true });
      this.requireAuthorityOperation(operation, workspace);
      const postOpenRealPath = await realpath(prepared.fileRealPath);
      this.requireAuthorityOperation(operation, workspace);
      const postOpenStats = await stat(postOpenRealPath, { bigint: true });
      this.requireAuthorityOperation(operation, workspace);
      if (
        !stats.isFile() ||
        postOpenRealPath !== prepared.fileRealPath ||
        !isContainedPath(prepared.rootRealPath, postOpenRealPath) ||
        !sameIdentity(prepared.identity, identityOf(stats)) ||
        !sameIdentity(prepared.identity, identityOf(postOpenStats))
      ) {
        throw new OnlyPreviewContractError(
          'PATH_NOT_FOUND',
          'The selected Office file changed before it could be read.'
        );
      }
      const active: ActiveOfficeRead = {
        generation: ++this.generation,
        prepared,
        handle,
        offset: 0,
        cancelled: false
      };
      this.requireAuthorityOperation(operation, workspace);
      handle = null;
      this.active = active;
      if (this.pendingOpen === prepared.grant) this.pendingOpen = null;
      return { grantId, runtimeId, selectionRevision, totalBytes: Number(stats.size) };
    } catch (error) {
      if (this.pendingOpen === prepared.grant) this.pendingOpen = null;
      await handle?.close().catch(() => undefined);
      return toSafeReadError(error, 'read');
    }
  }

  async readNext(
    grantId: string,
    runtimeId: string,
    selectionRevision: number,
    offset: number
  ): Promise<OnlyPreviewOfficeReadChunkRuntimeResult> {
    const active = this.active;
    if (
      !active ||
      active.prepared.grant.grantId !== grantId ||
      active.prepared.grant.runtimeId !== runtimeId ||
      active.prepared.grant.selectionRevision !== selectionRevision ||
      !Number.isSafeInteger(offset) ||
      offset !== active.offset
    ) {
      throw new OnlyPreviewContractError('INVALID_INPUT', 'Office read offset is invalid.');
    }
    try {
      this.requireCurrent(active);
      const totalBytes = Number(active.prepared.identity.size);
      const requestedBytes = Math.min(
        ONLY_PREVIEW_OFFICE_READ_CHUNK_BYTES,
        totalBytes - active.offset
      );
      const bytes = new Uint8Array(requestedBytes);
      let filled = 0;
      while (filled < requestedBytes) {
        this.requireCurrent(active);
        const { bytesRead } = await active.handle.read(
          bytes,
          filled,
          requestedBytes - filled,
          active.offset + filled
        );
        this.requireCurrent(active);
        if (bytesRead <= 0) {
          throw new OnlyPreviewContractError(
            'PATH_NOT_FOUND',
            'The selected Office file changed while it was being read.'
          );
        }
        filled += bytesRead;
      }
      const responseOffset = active.offset;
      active.offset += filled;
      const eof = active.offset === totalBytes;
      if (eof) await this.validateAndClose(active);
      return {
        grantId,
        runtimeId,
        selectionRevision,
        offset: responseOffset,
        bytes: bytes.buffer,
        eof
      };
    } catch (error) {
      await this.closeActive(active);
      return toSafeReadError(error, 'read');
    }
  }

  async cancel(grantId?: string, runtimeId?: string, selectionRevision?: number): Promise<void> {
    const scoped =
      grantId !== undefined || runtimeId !== undefined || selectionRevision !== undefined;
    if (
      scoped &&
      !this.matchesGrant(this.pendingPrepare, grantId, runtimeId, selectionRevision) &&
      !this.matchesGrant(this.pendingOpen, grantId, runtimeId, selectionRevision) &&
      !this.matchesGrant(this.prepared?.grant ?? null, grantId, runtimeId, selectionRevision) &&
      !this.matchesGrant(this.active?.prepared.grant ?? null, grantId, runtimeId, selectionRevision)
    ) {
      return;
    }
    this.authorityOperation += 1;
    if (this.matchesGrant(this.pendingPrepare, grantId, runtimeId, selectionRevision)) {
      this.pendingPrepare = null;
    }
    if (this.matchesGrant(this.pendingOpen, grantId, runtimeId, selectionRevision)) {
      this.pendingOpen = null;
    }
    await this.cancelInternal(grantId, runtimeId, selectionRevision);
  }

  private async cancelInternal(
    grantId?: string,
    runtimeId?: string,
    selectionRevision?: number
  ): Promise<void> {
    const prepared = this.prepared;
    if (
      prepared &&
      (grantId === undefined || prepared.grant.grantId === grantId) &&
      (runtimeId === undefined || prepared.grant.runtimeId === runtimeId) &&
      (selectionRevision === undefined || prepared.grant.selectionRevision === selectionRevision)
    ) {
      this.prepared = null;
    }
    await this.cancelActive(grantId, runtimeId, selectionRevision);
  }

  async dispose(): Promise<void> {
    this.authorityOperation += 1;
    this.pendingPrepare = null;
    this.pendingOpen = null;
    await this.cancelInternal();
    this.workspace = null;
    this.latestSelectionRevision = -1;
  }

  private async validateAndClose(active: ActiveOfficeRead): Promise<void> {
    const stats = await active.handle.stat({ bigint: true });
    this.requireCurrent(active);
    const fileRealPath = await realpath(active.prepared.fileRealPath);
    this.requireCurrent(active);
    const pathStats = await stat(fileRealPath, { bigint: true });
    this.requireCurrent(active);
    if (
      !sameIdentity(active.prepared.identity, identityOf(stats)) ||
      !sameIdentity(active.prepared.identity, identityOf(pathStats)) ||
      fileRealPath !== active.prepared.fileRealPath ||
      !isContainedPath(active.prepared.rootRealPath, fileRealPath)
    ) {
      throw new OnlyPreviewContractError(
        'PATH_NOT_FOUND',
        'The selected Office file changed while it was being read.'
      );
    }
    await this.closeActive(active);
  }

  private async cancelActive(
    grantId?: string,
    runtimeId?: string,
    selectionRevision?: number
  ): Promise<void> {
    const active = this.active;
    if (!active) return;
    if (grantId !== undefined && active.prepared.grant.grantId !== grantId) return;
    if (runtimeId !== undefined && active.prepared.grant.runtimeId !== runtimeId) return;
    if (
      selectionRevision !== undefined &&
      active.prepared.grant.selectionRevision !== selectionRevision
    ) {
      return;
    }
    active.cancelled = true;
    this.generation += 1;
    await this.closeActive(active);
  }

  private requireCurrent(active: ActiveOfficeRead): void {
    if (active.cancelled || this.active !== active || active.generation !== this.generation) {
      throw new OnlyPreviewContractError('OPERATION_FAILED', 'The Office read was superseded.');
    }
  }

  private requireAuthorityOperation(operation: number, workspace: OfficeWorkspaceAuthority): void {
    if (operation !== this.authorityOperation || this.workspace !== workspace) {
      throw new OnlyPreviewContractError(
        'OPERATION_FAILED',
        'The Office authority was superseded.'
      );
    }
  }

  private matchesGrant(
    grant: OnlyPreviewOfficePrepareGrant | null,
    grantId?: string,
    runtimeId?: string,
    selectionRevision?: number
  ): boolean {
    return Boolean(
      grant &&
      (grantId === undefined || grant.grantId === grantId) &&
      (runtimeId === undefined || grant.runtimeId === runtimeId) &&
      (selectionRevision === undefined || grant.selectionRevision === selectionRevision)
    );
  }

  private async closeActive(active: ActiveOfficeRead): Promise<void> {
    if (this.active === active) this.active = null;
    await active.handle.close().catch(() => undefined);
  }
}
