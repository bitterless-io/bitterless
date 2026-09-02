import { constants, type BigIntStats } from 'node:fs';
import { lstat, open, realpath, stat, type FileHandle } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import {
  OnlyPreviewContractError,
  normalizeOnlyPreviewRelativePath
} from '@shared/onlypreview/onlyPreview.contract';
import {
  ONLY_PREVIEW_MAX_DOCUMENT_RESOURCE_BYTES,
  ONLY_PREVIEW_MAX_DOCUMENT_TOTAL_BYTES,
  ONLY_PREVIEW_MAX_HTML_BYTES,
  type OnlyPreviewDescriptor
} from '@shared/onlypreview/onlyPreview.types';
import {
  ONLY_PREVIEW_MAX_DOCUMENT_RESOURCE_IDENTITIES,
  ONLY_PREVIEW_READ_CHUNK_BYTES,
  type OnlyPreviewPreviewReadChunkResult,
  type OnlyPreviewPreviewReadDocumentResource,
  type OnlyPreviewPreviewReadOpenRequest,
  type OnlyPreviewPreviewReadOpenResult,
  type OnlyPreviewPreviewReadPrepareGrant,
  type OnlyPreviewPreviewReadPreparedSelection
} from '@shared/onlypreview/onlyPreviewPreviewReadRuntime.types';
import { getOnlyPreviewOfficePackageKind } from '@shared/onlypreview/onlyPreviewOfficeReadRuntime.types';
import {
  classifyOnlyPreviewExtension,
  getOnlyPreviewSignatureBytes,
  getOnlyPreviewTextAdapter,
  onlyPreviewClassifierService
} from '@main/onlypreview/onlyPreviewClassifier.service';

const MAX_SELECTION_GRANTS = 8;
const MAX_READ_SESSIONS = 256;

interface PreviewWorkspaceAuthority {
  workspaceId: string;
  workspaceGeneration: number;
  rootRealPath: string;
  deviceId: bigint;
  inode: bigint;
}

interface PreviewFileIdentity {
  deviceId: bigint;
  inode: bigint;
  size: bigint;
  modifiedTimeNanoseconds: bigint;
}

interface PreparedPreviewSelection {
  grant: OnlyPreviewPreviewReadPrepareGrant;
  descriptor: OnlyPreviewDescriptor;
  rootRealPath: string;
  fileRealPath: string;
  identity: PreviewFileIdentity;
  entryDirectory:
    | {
        relativePath: string;
        realPath: string;
        deviceId: bigint;
        inode: bigint;
        entryRequestPath: string;
      }
    | null;
  resourceIdentities: Map<string, { realPath: string; identity: PreviewFileIdentity }>;
  acceptedDocumentBytes: number;
}

interface ActivePreviewRead {
  sessionId: string;
  grantId: string;
  selectionRevision: number;
  handle: FileHandle;
  fileRealPath: string;
  identity: PreviewFileIdentity;
  offset: number;
  end: number;
  pending: boolean;
  cancelled: boolean;
}

interface PendingPreviewOpen {
  sessionId: string;
  grantId: string;
  selectionRevision: number;
  cancelled: boolean;
}

const isContainedPath = (root: string, candidate: string): boolean => {
  const child = relative(root, candidate);
  return child === '' || (!child.startsWith(`..${sep}`) && child !== '..' && !isAbsolute(child));
};

const identityOf = (stats: BigIntStats): PreviewFileIdentity => ({
  deviceId: stats.dev,
  inode: stats.ino,
  size: stats.size,
  modifiedTimeNanoseconds: stats.mtimeNs
});

const sameIdentity = (left: PreviewFileIdentity, right: PreviewFileIdentity): boolean =>
  left.deviceId === right.deviceId &&
  left.inode === right.inode &&
  left.size === right.size &&
  left.modifiedTimeNanoseconds === right.modifiedTimeNanoseconds;

const secureOpenFlags = (): number => {
  if (typeof constants.O_NOFOLLOW !== 'number') {
    throw new OnlyPreviewContractError(
      'PATH_NOT_REGULAR_FILE',
      'Secure Preview file reads are unavailable.'
    );
  }
  return constants.O_RDONLY | constants.O_NOFOLLOW | (constants.O_CLOEXEC ?? 0);
};

const toSafeReadError = (error: unknown, fallback: string): never => {
  if (error instanceof OnlyPreviewContractError) throw error;
  const code = (error as NodeJS.ErrnoException | null)?.code;
  if (code === 'EACCES' || code === 'EPERM') {
    throw new OnlyPreviewContractError(
      'PATH_PERMISSION_DENIED',
      'Bitterless does not have permission to read this Preview file.'
    );
  }
  throw new OnlyPreviewContractError('PATH_NOT_FOUND', fallback);
};

const resolveCandidate = (rootRealPath: string, relativePath: string): string => {
  const normalized = normalizeOnlyPreviewRelativePath(relativePath);
  const candidate = resolve(rootRealPath, ...normalized.split('/'));
  if (!isContainedPath(rootRealPath, candidate)) {
    throw new OnlyPreviewContractError(
      'PATH_OUTSIDE_WORKSPACE',
      'The selected Preview file is outside its workspace.'
    );
  }
  return candidate;
};

const descriptorNeedsSignature = (descriptor: OnlyPreviewDescriptor): boolean =>
  descriptor.size > 0 &&
  (descriptor.kind === 'pdf' ||
    descriptor.kind === 'image' ||
    descriptor.kind === 'audio' ||
    descriptor.kind === 'video');

const validateRange = (size: number, start: number, end: number): void => {
  if (size === 0) {
    if (start !== 0 || end !== -1) {
      throw new OnlyPreviewContractError('INVALID_INPUT', 'Preview byte range is invalid.');
    }
    return;
  }
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start ||
    end >= size
  ) {
    throw new OnlyPreviewContractError('INVALID_INPUT', 'Preview byte range is invalid.');
  }
};

export class FileSearchPreviewReader {
  private workspace: PreviewWorkspaceAuthority | null = null;
  private readonly selections = new Map<string, PreparedPreviewSelection>();
  private readonly sessions = new Map<string, ActivePreviewRead>();
  private readonly pendingOpens = new Map<string, PendingPreviewOpen>();
  private authorityOperation = 0;
  private latestSelectionRevision = -1;
  private pendingPrepare: OnlyPreviewPreviewReadPrepareGrant | null = null;

  async bindWorkspace(
    workspaceId: string,
    workspaceGeneration: number,
    rootPath: string
  ): Promise<void> {
    const operation = ++this.authorityOperation;
    this.revokeAllSelections();
    this.workspace = null;
    try {
      if (!Number.isSafeInteger(workspaceGeneration) || workspaceGeneration < 1) {
        throw new OnlyPreviewContractError(
          'WORKSPACE_ACCESS_DENIED',
          'Preview Read workspace generation is invalid.'
        );
      }
      const lexical = await lstat(rootPath, { bigint: true });
      const rootRealPath = await realpath(rootPath);
      const rootStats = await stat(rootRealPath, { bigint: true });
      if (
        lexical.isSymbolicLink() ||
        !rootStats.isDirectory() ||
        lexical.dev !== rootStats.dev ||
        lexical.ino !== rootStats.ino
      ) {
        throw new OnlyPreviewContractError(
          'PATH_OUTSIDE_WORKSPACE',
          'The Preview Read workspace authority changed.'
        );
      }
      if (operation !== this.authorityOperation) {
        throw new OnlyPreviewContractError(
          'OPERATION_FAILED',
          'The Preview Read workspace binding was superseded.'
        );
      }
      this.workspace = {
        workspaceId,
        workspaceGeneration,
        rootRealPath,
        deviceId: rootStats.dev,
        inode: rootStats.ino
      };
      this.latestSelectionRevision = -1;
    } catch (error) {
      return toSafeReadError(error, 'The Preview Read workspace could not be bound safely.');
    }
  }

  revokeWorkspace(workspaceId: string, workspaceGeneration: number): void {
    this.requireWorkspace(workspaceId, workspaceGeneration);
    this.authorityOperation += 1;
    this.workspace = null;
    this.pendingPrepare = null;
    this.revokeAllSelections();
  }

  async prepare(
    runtimeInstanceId: string,
    grant: OnlyPreviewPreviewReadPrepareGrant
  ): Promise<OnlyPreviewPreviewReadPreparedSelection> {
    if (getOnlyPreviewOfficePackageKind(grant.relativePath)) {
      throw new OnlyPreviewContractError(
        'INVALID_INPUT',
        'Office files require the independent Office reader.'
      );
    }
    const workspace = this.requireWorkspace(grant.workspaceId, grant.workspaceGeneration);
    if (
      !Number.isSafeInteger(grant.selectionRevision) ||
      grant.selectionRevision <= this.latestSelectionRevision
    ) {
      throw new OnlyPreviewContractError(
        'WORKSPACE_ACCESS_DENIED',
        'Preview Read selection is stale.'
      );
    }
    if (this.selections.size >= MAX_SELECTION_GRANTS) this.revokeAllSelections();
    const operation = ++this.authorityOperation;
    this.latestSelectionRevision = grant.selectionRevision;
    this.pendingPrepare = grant;
    this.revokeAllSelections();
    let handle: FileHandle | null = null;
    try {
      await this.requireCurrentRoot(workspace, operation);
      const candidate = resolveCandidate(workspace.rootRealPath, grant.relativePath);
      const lexical = await lstat(candidate, { bigint: true });
      if (lexical.isSymbolicLink()) {
        throw new OnlyPreviewContractError(
          'PATH_NOT_REGULAR_FILE',
          'Symbolic links cannot be previewed.'
        );
      }
      const fileRealPath = await realpath(candidate);
      if (fileRealPath !== candidate || !isContainedPath(workspace.rootRealPath, fileRealPath)) {
        throw new OnlyPreviewContractError(
          'PATH_OUTSIDE_WORKSPACE',
          'The selected Preview file is outside its workspace.'
        );
      }
      handle = await open(fileRealPath, secureOpenFlags());
      const opened = await handle.stat({ bigint: true });
      const pathStats = await stat(fileRealPath, { bigint: true });
      this.requireActive(workspace, operation);
      if (
        !opened.isFile() ||
        !lexical.isFile() ||
        !sameIdentity(identityOf(opened), identityOf(pathStats)) ||
        !sameIdentity(identityOf(opened), identityOf(lexical))
      ) {
        throw new OnlyPreviewContractError(
          'PATH_NOT_REGULAR_FILE',
          'Only regular files can be previewed.'
        );
      }
      const size = Number(opened.size);
      const modifiedAt = Number(opened.mtimeMs);
      if (!Number.isSafeInteger(size) || size < 0 || !Number.isFinite(modifiedAt)) {
        throw new OnlyPreviewContractError(
          'TEXT_TOO_LARGE',
          'The selected Preview file exceeds the supported size.'
        );
      }
      const metadata = {
        workspaceId: grant.workspaceId,
        relativePath: grant.relativePath,
        size,
        modifiedAt
      };
      const kind = classifyOnlyPreviewExtension(grant.relativePath);
      const initialDescriptor = onlyPreviewClassifierService.describe(metadata);
      let sample: Uint8Array | undefined;
      if (descriptorNeedsSignature(initialDescriptor)) {
        const sampleSize = Math.min(size, getOnlyPreviewSignatureBytes(initialDescriptor.extension));
        sample = new Uint8Array(sampleSize);
        const { bytesRead } = await handle.read(sample, 0, sampleSize, 0);
        if (bytesRead !== sampleSize) {
          throw new OnlyPreviewContractError(
            'PATH_NOT_FOUND',
            'The selected Preview file changed while it was inspected.'
          );
        }
      }
      const descriptor = descriptorNeedsSignature(initialDescriptor)
        ? onlyPreviewClassifierService.describe(metadata, sample)
        : initialDescriptor;
      if (kind === 'sheet' || kind === 'document' || kind === 'presentation') {
        throw new OnlyPreviewContractError(
          'INVALID_INPUT',
          'Office files require the independent Office reader.'
        );
      }
      const finalStats = await handle.stat({ bigint: true });
      const finalRealPath = await realpath(fileRealPath);
      const finalPathStats = await stat(finalRealPath, { bigint: true });
      this.requireActive(workspace, operation);
      const identity = identityOf(opened);
      if (
        finalRealPath !== fileRealPath ||
        !sameIdentity(identity, identityOf(finalStats)) ||
        !sameIdentity(identity, identityOf(finalPathStats))
      ) {
        throw new OnlyPreviewContractError(
          'PATH_NOT_FOUND',
          'The selected Preview file changed while it was inspected.'
        );
      }

      let entryDirectory: PreparedPreviewSelection['entryDirectory'] = null;
      if (descriptor.extension === '.html' || descriptor.extension === '.htm') {
        const directoryRealPath = await realpath(dirname(fileRealPath));
        const directoryStats = await stat(directoryRealPath, { bigint: true });
        this.requireActive(workspace, operation);
        if (
          !directoryStats.isDirectory() ||
          directoryRealPath !== dirname(fileRealPath) ||
          !isContainedPath(workspace.rootRealPath, directoryRealPath)
        ) {
          throw new OnlyPreviewContractError(
            'PATH_OUTSIDE_WORKSPACE',
            'The HTML entry directory is no longer available.'
          );
        }
        const separator = grant.relativePath.lastIndexOf('/');
        entryDirectory = {
          relativePath: separator < 0 ? '' : grant.relativePath.slice(0, separator),
          realPath: directoryRealPath,
          deviceId: directoryStats.dev,
          inode: directoryStats.ino,
          entryRequestPath: separator < 0 ? grant.relativePath : grant.relativePath.slice(separator + 1)
        };
      }
      const selection: PreparedPreviewSelection = {
        grant,
        descriptor,
        rootRealPath: workspace.rootRealPath,
        fileRealPath,
        identity,
        entryDirectory,
        resourceIdentities: new Map(),
        acceptedDocumentBytes: 0
      };
      this.requireActive(workspace, operation);
      if (this.pendingPrepare !== grant) {
        throw new OnlyPreviewContractError(
          'OPERATION_FAILED',
          'The Preview Read selection was superseded.'
        );
      }
      this.pendingPrepare = null;
      this.selections.set(grant.grantId, selection);
      return { ...grant, runtimeInstanceId, descriptor };
    } catch (error) {
      if (this.pendingPrepare === grant) this.pendingPrepare = null;
      return toSafeReadError(error, 'The selected Preview file could not be prepared safely.');
    } finally {
      await handle?.close().catch(() => undefined);
    }
  }

  async inspectDocumentResource(
    runtimeInstanceId: string,
    grantId: string,
    selectionRevision: number,
    requestPath: string
  ): Promise<OnlyPreviewPreviewReadDocumentResource> {
    try {
      const selection = this.requireSelection(grantId, selectionRevision);
      const target = await this.resolveDocumentResource(selection, requestPath, true);
      return {
        runtimeInstanceId,
        grantId,
        selectionRevision,
        requestPath,
        size: Number(target.identity.size)
      };
    } catch (error) {
      return toSafeReadError(error, 'The HTML resource could not be inspected safely.');
    }
  }

  async open(
    runtimeInstanceId: string,
    request: Omit<OnlyPreviewPreviewReadOpenRequest, 'capability' | 'runtimeInstanceId'>
  ): Promise<OnlyPreviewPreviewReadOpenResult> {
    let handle: FileHandle | null = null;
    let pendingOpen: PendingPreviewOpen | null = null;
    try {
      if (this.sessions.size + this.pendingOpens.size >= MAX_READ_SESSIONS) {
        throw new OnlyPreviewContractError(
          'OPERATION_FAILED',
          'Too many Preview Read sessions are active.'
        );
      }
      const selection = this.requireSelection(request.grantId, request.selectionRevision);
      if (this.sessions.has(request.sessionId) || this.pendingOpens.has(request.sessionId)) {
        throw new OnlyPreviewContractError(
          'INVALID_INPUT',
          'Preview Read session is already active.'
        );
      }
      pendingOpen = {
        sessionId: request.sessionId,
        grantId: request.grantId,
        selectionRevision: request.selectionRevision,
        cancelled: false
      };
      this.pendingOpens.set(request.sessionId, pendingOpen);
      const isHtmlSelection =
        selection.descriptor.kind === 'text' &&
        (selection.descriptor.extension === '.html' ||
          selection.descriptor.extension === '.htm');
      if (
        (request.source.kind === 'selection' && isHtmlSelection) ||
        (request.source.kind === 'document' && !isHtmlSelection)
      ) {
        throw new OnlyPreviewContractError(
          'INVALID_INPUT',
          'Preview Read source does not match the prepared adapter.'
        );
      }
      const target =
        request.source.kind === 'selection'
          ? { realPath: selection.fileRealPath, identity: selection.identity }
          : await this.resolveDocumentResource(selection, request.source.requestPath, false);
      const size = Number(target.identity.size);
      validateRange(size, request.start, request.end);
      if (request.source.kind === 'selection') {
        const adapter = getOnlyPreviewTextAdapter(selection.grant.relativePath);
        if (
          selection.descriptor.kind === 'text' &&
          adapter &&
          (request.method !== 'GET' || request.start !== 0 || request.end !== size - 1)
        ) {
          throw new OnlyPreviewContractError(
            'INVALID_INPUT',
            'Text Preview reads must request the exact complete file.'
          );
        }
      } else if (request.method === 'GET' && size > 0) {
        const acceptedBytes = request.end - request.start + 1;
        if (
          selection.acceptedDocumentBytes + acceptedBytes >
          ONLY_PREVIEW_MAX_DOCUMENT_TOTAL_BYTES
        ) {
          throw new OnlyPreviewContractError(
            'OPERATION_FAILED',
            'The HTML revision exceeded its bounded resource budget.'
          );
        }
        // This reservation is intentionally non-refundable and occurs before the body handle opens.
        selection.acceptedDocumentBytes += acceptedBytes;
      }

      await this.requireSelectionCurrent(selection);
      handle = await open(target.realPath, secureOpenFlags());
      const opened = await handle.stat({ bigint: true });
      const currentRealPath = await realpath(target.realPath);
      const pathStats = await stat(currentRealPath, { bigint: true });
      await this.requireSelectionCurrent(selection);
      this.requirePendingOpenCurrent(pendingOpen);
      if (
        currentRealPath !== target.realPath ||
        !opened.isFile() ||
        !sameIdentity(target.identity, identityOf(opened)) ||
        !sameIdentity(target.identity, identityOf(pathStats))
      ) {
        throw new OnlyPreviewContractError(
          'PATH_NOT_FOUND',
          'The selected Preview source changed before it could be read.'
        );
      }
      const eof = request.method === 'HEAD' || size === 0;
      if (eof) {
        await handle.close().catch(() => undefined);
        handle = null;
      } else {
        const session: ActivePreviewRead = {
          sessionId: request.sessionId,
          grantId: request.grantId,
          selectionRevision: request.selectionRevision,
          handle,
          fileRealPath: target.realPath,
          identity: target.identity,
          offset: request.start,
          end: request.end,
          pending: false,
          cancelled: false
        };
        this.requirePendingOpenCurrent(pendingOpen);
        this.sessions.set(request.sessionId, session);
        handle = null;
      }
      return {
        runtimeInstanceId,
        grantId: request.grantId,
        selectionRevision: request.selectionRevision,
        workspaceId: selection.grant.workspaceId,
        relativePath: selection.grant.relativePath,
        sessionId: request.sessionId,
        method: request.method,
        start: request.start,
        end: request.end,
        totalBytes: size,
        eof
      };
    } catch (error) {
      await handle?.close().catch(() => undefined);
      return toSafeReadError(error, 'The selected Preview source could not be opened safely.');
    } finally {
      if (pendingOpen && this.pendingOpens.get(pendingOpen.sessionId) === pendingOpen) {
        this.pendingOpens.delete(pendingOpen.sessionId);
      }
    }
  }

  async readNext(
    runtimeInstanceId: string,
    grantId: string,
    selectionRevision: number,
    sessionId: string,
    offset: number
  ): Promise<OnlyPreviewPreviewReadChunkResult> {
    const session = this.sessions.get(sessionId);
    if (
      !session ||
      session.grantId !== grantId ||
      session.selectionRevision !== selectionRevision ||
      !Number.isSafeInteger(offset) ||
      offset !== session.offset ||
      session.pending
    ) {
      throw new OnlyPreviewContractError('INVALID_INPUT', 'Preview Read offset is invalid.');
    }
    session.pending = true;
    try {
      this.requireSessionCurrent(session);
      const requestedBytes = Math.min(ONLY_PREVIEW_READ_CHUNK_BYTES, session.end - offset + 1);
      const bytes = new Uint8Array(requestedBytes);
      let filled = 0;
      while (filled < requestedBytes) {
        this.requireSessionCurrent(session);
        const result = await session.handle.read(
          bytes,
          filled,
          requestedBytes - filled,
          offset + filled
        );
        this.requireSessionCurrent(session);
        if (result.bytesRead <= 0) {
          throw new OnlyPreviewContractError(
            'PATH_NOT_FOUND',
            'The selected Preview source changed while it was being read.'
          );
        }
        filled += result.bytesRead;
      }
      session.offset += filled;
      const eof = session.offset === session.end + 1;
      if (eof) await this.validateAndClose(session);
      return {
        runtimeInstanceId,
        grantId,
        selectionRevision,
        sessionId,
        offset,
        bytes: bytes.buffer,
        eof
      };
    } catch (error) {
      this.cancelSession(session);
      return toSafeReadError(error, 'The selected Preview source could not be read safely.');
    } finally {
      session.pending = false;
    }
  }

  cancel(grantId?: string, selectionRevision?: number, sessionId?: string): void {
    if (sessionId) {
      const pendingOpen = this.pendingOpens.get(sessionId);
      if (
        pendingOpen &&
        (grantId === undefined || pendingOpen.grantId === grantId) &&
        (selectionRevision === undefined ||
          pendingOpen.selectionRevision === selectionRevision)
      ) {
        pendingOpen.cancelled = true;
      }
      const session = this.sessions.get(sessionId);
      if (
        session &&
        (grantId === undefined || session.grantId === grantId) &&
        (selectionRevision === undefined || session.selectionRevision === selectionRevision)
      ) {
        this.cancelSession(session);
      }
      return;
    }
    for (const [candidateGrantId, selection] of this.selections) {
      if (grantId !== undefined && candidateGrantId !== grantId) continue;
      if (
        selectionRevision !== undefined &&
        selection.grant.selectionRevision !== selectionRevision
      ) {
        continue;
      }
      this.selections.delete(candidateGrantId);
      for (const session of [...this.sessions.values()]) {
        if (session.grantId === candidateGrantId) this.cancelSession(session);
      }
      for (const pendingOpen of this.pendingOpens.values()) {
        if (pendingOpen.grantId === candidateGrantId) pendingOpen.cancelled = true;
      }
    }
    if (
      this.pendingPrepare &&
      (grantId === undefined || this.pendingPrepare.grantId === grantId) &&
      (selectionRevision === undefined ||
        this.pendingPrepare.selectionRevision === selectionRevision)
    ) {
      this.authorityOperation += 1;
      this.pendingPrepare = null;
    }
  }

  dispose(): void {
    this.authorityOperation += 1;
    this.workspace = null;
    this.pendingPrepare = null;
    this.revokeAllSelections();
  }

  private requireWorkspace(
    workspaceId: string,
    workspaceGeneration: number
  ): PreviewWorkspaceAuthority {
    const workspace = this.workspace;
    if (
      !workspace ||
      workspace.workspaceId !== workspaceId ||
      workspace.workspaceGeneration !== workspaceGeneration
    ) {
      throw new OnlyPreviewContractError(
        'WORKSPACE_ACCESS_DENIED',
        'Preview Read authority does not match the active Project workspace.'
      );
    }
    return workspace;
  }

  private requireSelection(
    grantId: string,
    selectionRevision: number
  ): PreparedPreviewSelection {
    const selection = this.selections.get(grantId);
    if (!selection || selection.grant.selectionRevision !== selectionRevision) {
      throw new OnlyPreviewContractError('INVALID_INPUT', 'Preview Read grant is unavailable.');
    }
    this.requireWorkspace(selection.grant.workspaceId, selection.grant.workspaceGeneration);
    return selection;
  }

  private async requireCurrentRoot(
    workspace: PreviewWorkspaceAuthority,
    operation: number
  ): Promise<void> {
    const lexical = await lstat(workspace.rootRealPath, { bigint: true });
    const rootRealPath = await realpath(workspace.rootRealPath);
    const rootStats = await stat(rootRealPath, { bigint: true });
    if (
      lexical.isSymbolicLink() ||
      rootRealPath !== workspace.rootRealPath ||
      !rootStats.isDirectory() ||
      lexical.dev !== workspace.deviceId ||
      lexical.ino !== workspace.inode ||
      rootStats.dev !== workspace.deviceId ||
      rootStats.ino !== workspace.inode
    ) {
      throw new OnlyPreviewContractError(
        'PATH_OUTSIDE_WORKSPACE',
        'The Preview Read workspace authority changed.'
      );
    }
    this.requireActive(workspace, operation);
  }

  private requireActive(workspace: PreviewWorkspaceAuthority, operation: number): void {
    if (this.workspace !== workspace || operation !== this.authorityOperation) {
      throw new OnlyPreviewContractError(
        'OPERATION_FAILED',
        'The Preview Read operation was superseded.'
      );
    }
  }

  private async requireSelectionCurrent(selection: PreparedPreviewSelection): Promise<void> {
    const workspace = this.requireWorkspace(
      selection.grant.workspaceId,
      selection.grant.workspaceGeneration
    );
    const operation = this.authorityOperation;
    await this.requireCurrentRoot(workspace, operation);
    const currentRealPath = await realpath(selection.fileRealPath);
    const currentStats = await stat(currentRealPath, { bigint: true });
    this.requireActive(workspace, operation);
    if (
      this.selections.get(selection.grant.grantId) !== selection ||
      currentRealPath !== selection.fileRealPath ||
      !sameIdentity(selection.identity, identityOf(currentStats))
    ) {
      throw new OnlyPreviewContractError(
        'PATH_NOT_FOUND',
        'The selected Preview file changed.'
      );
    }
  }

  private async resolveDocumentResource(
    selection: PreparedPreviewSelection,
    requestPath: string,
    allowCreateIdentity: boolean
  ): Promise<{ realPath: string; identity: PreviewFileIdentity }> {
    const entryDirectory = selection.entryDirectory;
    if (!entryDirectory) {
      throw new OnlyPreviewContractError(
        'INVALID_INPUT',
        'The selected Preview is not an HTML document.'
      );
    }
    const normalized = normalizeOnlyPreviewRelativePath(requestPath);
    if (normalized !== requestPath) {
      throw new OnlyPreviewContractError('INVALID_INPUT', 'HTML resource path is invalid.');
    }
    await this.requireSelectionCurrent(selection);
    const currentDirectoryRealPath = await realpath(entryDirectory.realPath);
    const directoryStats = await stat(currentDirectoryRealPath, { bigint: true });
    if (
      currentDirectoryRealPath !== entryDirectory.realPath ||
      !directoryStats.isDirectory() ||
      directoryStats.dev !== entryDirectory.deviceId ||
      directoryStats.ino !== entryDirectory.inode
    ) {
      throw new OnlyPreviewContractError(
        'PATH_OUTSIDE_WORKSPACE',
        'The HTML entry directory changed.'
      );
    }
    const candidate = resolve(entryDirectory.realPath, ...normalized.split('/'));
    if (!isContainedPath(entryDirectory.realPath, candidate)) {
      throw new OnlyPreviewContractError(
        'PATH_OUTSIDE_WORKSPACE',
        'The HTML resource is outside its entry directory.'
      );
    }
    const lexical = await lstat(candidate, { bigint: true });
    if (lexical.isSymbolicLink() || !lexical.isFile()) {
      throw new OnlyPreviewContractError(
        'PATH_NOT_REGULAR_FILE',
        'Only regular HTML resources can be loaded.'
      );
    }
    const realPath = await realpath(candidate);
    const pathStats = await stat(realPath, { bigint: true });
    if (
      realPath !== candidate ||
      !isContainedPath(entryDirectory.realPath, realPath) ||
      !pathStats.isFile() ||
      lexical.dev !== pathStats.dev ||
      lexical.ino !== pathStats.ino
    ) {
      throw new OnlyPreviewContractError(
        'PATH_OUTSIDE_WORKSPACE',
        'The HTML resource is outside its entry directory.'
      );
    }
    const identity = identityOf(pathStats);
    const isEntry = normalized === entryDirectory.entryRequestPath;
    if (isEntry && !sameIdentity(selection.identity, identity)) {
      throw new OnlyPreviewContractError('PATH_NOT_FOUND', 'The HTML entry file changed.');
    }
    const maxBytes = isEntry ? ONLY_PREVIEW_MAX_HTML_BYTES : ONLY_PREVIEW_MAX_DOCUMENT_RESOURCE_BYTES;
    if (identity.size > BigInt(maxBytes)) {
      throw new OnlyPreviewContractError(
        'TEXT_TOO_LARGE',
        'The HTML resource exceeds its preview limit.'
      );
    }
    const expected = selection.resourceIdentities.get(normalized);
    if (expected) {
      if (expected.realPath !== realPath || !sameIdentity(expected.identity, identity)) {
        throw new OnlyPreviewContractError('PATH_NOT_FOUND', 'The HTML resource changed.');
      }
    } else if (allowCreateIdentity) {
      if (
        selection.resourceIdentities.size >= ONLY_PREVIEW_MAX_DOCUMENT_RESOURCE_IDENTITIES
      ) {
        throw new OnlyPreviewContractError(
          'OPERATION_FAILED',
          'The HTML revision referenced too many distinct resources.'
        );
      }
      selection.resourceIdentities.set(normalized, { realPath, identity });
    } else {
      throw new OnlyPreviewContractError(
        'INVALID_INPUT',
        'The HTML resource was not inspected before opening.'
      );
    }
    return { realPath, identity };
  }

  private requireSessionCurrent(session: ActivePreviewRead): void {
    if (
      session.cancelled ||
      this.sessions.get(session.sessionId) !== session ||
      !this.selections.has(session.grantId)
    ) {
      throw new OnlyPreviewContractError('OPERATION_FAILED', 'Preview Read was superseded.');
    }
  }

  private requirePendingOpenCurrent(pendingOpen: PendingPreviewOpen): void {
    const selection = this.selections.get(pendingOpen.grantId);
    if (
      pendingOpen.cancelled ||
      this.pendingOpens.get(pendingOpen.sessionId) !== pendingOpen ||
      selection?.grant.selectionRevision !== pendingOpen.selectionRevision
    ) {
      throw new OnlyPreviewContractError('OPERATION_FAILED', 'Preview Read was superseded.');
    }
  }

  private async validateAndClose(session: ActivePreviewRead): Promise<void> {
    const handleStats = await session.handle.stat({ bigint: true });
    this.requireSessionCurrent(session);
    const currentRealPath = await realpath(session.fileRealPath);
    const pathStats = await stat(currentRealPath, { bigint: true });
    this.requireSessionCurrent(session);
    if (
      currentRealPath !== session.fileRealPath ||
      !sameIdentity(session.identity, identityOf(handleStats)) ||
      !sameIdentity(session.identity, identityOf(pathStats))
    ) {
      throw new OnlyPreviewContractError(
        'PATH_NOT_FOUND',
        'The selected Preview source changed while it was being read.'
      );
    }
    this.cancelSession(session);
  }

  private cancelSession(session: ActivePreviewRead): void {
    if (this.sessions.get(session.sessionId) === session) this.sessions.delete(session.sessionId);
    session.cancelled = true;
    // FileHandle.close may wait for an in-flight read. Do not await it on the cancellation path.
    void session.handle.close().catch(() => undefined);
  }

  private revokeAllSelections(): void {
    this.selections.clear();
    for (const pendingOpen of this.pendingOpens.values()) pendingOpen.cancelled = true;
    for (const session of [...this.sessions.values()]) this.cancelSession(session);
  }
}
