import { createXpcPreloadEmitter, XpcPreloadHandler } from 'electron-xpc/preload';
import type {
  FileSearchRuntimeEventApi,
  FileSearchRuntimeEventRequest,
  FileSearchRuntimeInitializeRequest,
  FileSearchRuntimePrivateApi,
  FileSearchRuntimeReadyRequest,
  FileSearchRuntimeReadyResult,
  FileSearchRuntimeRequest
} from '@shared/onlypreview/fileSearchRuntime.types';
import {
  fileSearchRuntimeEventHandlerName,
  fileSearchRuntimeHandlerName
} from '@shared/onlypreview/fileSearchRuntime.types';
import {
  onlyPreviewOfficeReadRuntimeHandlerName,
  type OnlyPreviewOfficePrepareGrant,
  type OnlyPreviewOfficePrepareRuntimeRequest,
  type OnlyPreviewOfficeReadChunkRuntimeRequest,
  type OnlyPreviewOfficeReadRuntimeCancelRequest,
  type OnlyPreviewOfficeReadOpenRuntimeRequest,
  type OnlyPreviewOfficeReadRuntimePrivateApi,
  type OnlyPreviewOfficeReadRuntimeReadyRequest,
  type OnlyPreviewOfficeReadRuntimeReadyResult,
  type OnlyPreviewOfficeReadWorkspaceBindRequest
} from '@shared/onlypreview/onlyPreviewOfficeReadRuntime.types';
import {
  onlyPreviewFileAuthorityRuntimeHandlerName,
  type OnlyPreviewFileAuthorityDeleteGrantRequest,
  type OnlyPreviewFileAuthorityCreateDirectoryRequest,
  type OnlyPreviewFileAuthorityItemRequest,
  type OnlyPreviewFileAuthorityRenameRequest,
  type OnlyPreviewFileAuthorityRuntimePrivateApi,
  type OnlyPreviewFileAuthorityRuntimeReadyRequest,
  type OnlyPreviewFileAuthorityRuntimeReadyResult,
  type OnlyPreviewFileAuthorityTargetInspectionRequest,
  type OnlyPreviewFileAuthorityWorkspaceBindRequest,
  type OnlyPreviewFileAuthorityWorkspaceRef
} from '@shared/onlypreview/onlyPreviewFileAuthorityRuntime.types';
import { onlyPreviewPreviewReadRuntimeHandlerName } from '@shared/onlypreview/onlyPreviewPreviewReadRuntime.types';
import { onlyPreviewFailure, onlyPreviewSuccess } from '@shared/onlypreview/onlyPreview.contract';
import type {
  OnlyPreviewBrowseDirectoryRequest,
  OnlyPreviewGlobalSearchOfficeReadChunkRequest,
  OnlyPreviewGlobalSearchOfficeReadRequest,
  OnlyPreviewGlobalSearchPreviewRequest,
  OnlyPreviewSearchCancelRequest,
  OnlyPreviewSearchInitializeRequest,
  OnlyPreviewSearchPrioritizeFileRequest,
  OnlyPreviewSearchRequest,
  OnlyPreviewSearchShutdownRequest
} from '@shared/onlypreview/onlyPreviewSearch.type';
import { FileSearchRuntime as FileSearchRuntimeCore } from './fileSearchRuntime';
import { FileSearchOfficeReader } from './fileSearchOfficeReader.service';
import {
  FileSearchProjectAuthority,
  inspectOnlyPreviewProjectTarget
} from './fileSearchProjectAuthority.service';
import { FileSearchPreviewReader } from './fileSearchPreviewReader.service';
import { OnlyPreviewPreviewReadRuntime } from './fileSearchPreviewRead.handler';

export { OnlyPreviewPreviewReadRuntime } from './fileSearchPreviewRead.handler';

const CAPABILITY_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const INSTANCE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const argumentValue = (name: string): string => {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) ?? '';
};

const runtimeCapability = argumentValue('file-search-capability');
const officeReadCapability = argumentValue('file-search-office-read-capability');
const projectAuthorityCapability = argumentValue('file-search-project-authority-capability');
const previewReadCapability = argumentValue('file-search-preview-read-capability');
const runtimeInstanceId = argumentValue('file-search-instance');
const runtimeEvent = createXpcPreloadEmitter<FileSearchRuntimeEventApi>(
  fileSearchRuntimeEventHandlerName(runtimeCapability)
);
let eventTail = Promise.resolve();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const hasExactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const actual = Reflect.ownKeys(value);
  return (
    actual.length === keys.length &&
    actual.every((key) => typeof key === 'string' && keys.includes(key))
  );
};

const requireCapability = (value: unknown): void => {
  if (
    !CAPABILITY_PATTERN.test(runtimeCapability) ||
    value !== runtimeCapability ||
    !INSTANCE_PATTERN.test(runtimeInstanceId)
  ) {
    throw new TypeError('File-search runtime capability is invalid.');
  }
};

const requireOfficeReadCapability = (value: unknown): void => {
  if (
    !CAPABILITY_PATTERN.test(officeReadCapability) ||
    value !== officeReadCapability ||
    officeReadCapability === runtimeCapability ||
    !INSTANCE_PATTERN.test(runtimeInstanceId)
  ) {
    throw new TypeError('Office read runtime capability is invalid.');
  }
};

const requireProjectAuthorityIdentity = (value: unknown, instanceId: unknown): void => {
  if (
    !CAPABILITY_PATTERN.test(projectAuthorityCapability) ||
    value !== projectAuthorityCapability ||
    projectAuthorityCapability === runtimeCapability ||
    projectAuthorityCapability === officeReadCapability ||
    instanceId !== runtimeInstanceId ||
    !INSTANCE_PATTERN.test(runtimeInstanceId)
  ) {
    throw new TypeError('Project authority runtime identity is invalid.');
  }
};

const requireProjectWorkspaceRef = (
  value: Record<string, unknown>
): { workspaceId: string; workspaceGeneration: number } => {
  if (
    typeof value.workspaceId !== 'string' ||
    value.workspaceId.length < 16 ||
    value.workspaceId.length > 256 ||
    !Number.isSafeInteger(value.workspaceGeneration) ||
    (value.workspaceGeneration as number) < 1
  ) {
    throw new TypeError('Project authority workspace reference is invalid.');
  }
  return value as unknown as { workspaceId: string; workspaceGeneration: number };
};

const requireOfficePrepareGrant = (value: unknown): OnlyPreviewOfficePrepareGrant => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'grantId',
      'kind',
      'maxBytes',
      'relativePath',
      'runtimeId',
      'selectionRevision',
      'workspaceId'
    ]) ||
    !INSTANCE_PATTERN.test(String(value.grantId)) ||
    !INSTANCE_PATTERN.test(String(value.runtimeId)) ||
    !['xlsx', 'docx', 'pptx'].includes(String(value.kind)) ||
    typeof value.workspaceId !== 'string' ||
    typeof value.relativePath !== 'string' ||
    !Number.isSafeInteger(value.selectionRevision) ||
    !Number.isSafeInteger(value.maxBytes)
  ) {
    throw new TypeError('Office read grant is invalid.');
  }
  return value as unknown as OnlyPreviewOfficePrepareGrant;
};

const requireOfficeReadIdentity = (
  value: Record<string, unknown>
): { grantId: string; runtimeId: string; selectionRevision: number } => {
  if (
    !INSTANCE_PATTERN.test(String(value.grantId)) ||
    !INSTANCE_PATTERN.test(String(value.runtimeId)) ||
    !Number.isSafeInteger(value.selectionRevision)
  ) {
    throw new TypeError('Office read identity is invalid.');
  }
  return value as unknown as {
    grantId: string;
    runtimeId: string;
    selectionRevision: number;
  };
};

const requireRuntimeRequest = <T>(value: unknown): FileSearchRuntimeRequest<T> => {
  if (!isRecord(value) || !hasExactKeys(value, ['capability', 'request'])) {
    throw new TypeError('File-search runtime request is invalid.');
  }
  requireCapability(value.capability);
  return value as unknown as FileSearchRuntimeRequest<T>;
};

const runtime = new FileSearchRuntimeCore({
  emit: (eventName, value) => {
    const event: FileSearchRuntimeEventRequest = {
      capability: runtimeCapability,
      eventName,
      value
    };
    const sent = eventTail.then(async () => {
      const result = await runtimeEvent.publish(event);
      if (!result?.ok) throw new Error('File-search runtime event was rejected.');
    });
    eventTail = sent.catch(() => undefined);
  }
});
const officeReader = new FileSearchOfficeReader();
const projectAuthority = new FileSearchProjectAuthority();
const previewReader = new FileSearchPreviewReader();

export class FileSearchRuntime extends XpcPreloadHandler implements FileSearchRuntimePrivateApi {
  async ready(params: FileSearchRuntimeReadyRequest): Promise<FileSearchRuntimeReadyResult> {
    if (!isRecord(params) || !hasExactKeys(params, ['capability', 'instanceId'])) {
      return { ok: false, error: 'File-search readiness request is invalid.' };
    }
    try {
      requireCapability(params.capability);
      if (params.instanceId !== runtimeInstanceId) {
        throw new TypeError('File-search runtime instance is invalid.');
      }
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'File-search runtime is unavailable.'
      };
    }
  }

  async initialize(params: FileSearchRuntimeInitializeRequest) {
    if (!isRecord(params) || !hasExactKeys(params, ['bootstrap', 'capability', 'request'])) {
      throw new TypeError('File-search initialization request is invalid.');
    }
    requireCapability(params.capability);
    return await runtime.initialize(params.request, params.bootstrap);
  }

  async refresh(params: FileSearchRuntimeRequest<OnlyPreviewSearchInitializeRequest>) {
    const value = requireRuntimeRequest<OnlyPreviewSearchInitializeRequest>(params);
    return await runtime.refresh(value.request);
  }

  async prioritizeFile(params: FileSearchRuntimeRequest<OnlyPreviewSearchPrioritizeFileRequest>) {
    const value = requireRuntimeRequest<OnlyPreviewSearchPrioritizeFileRequest>(params);
    return await runtime.prioritizeFile(value.request);
  }

  async browseDirectory(params: FileSearchRuntimeRequest<OnlyPreviewBrowseDirectoryRequest>) {
    const value = requireRuntimeRequest<OnlyPreviewBrowseDirectoryRequest>(params);
    return await runtime.browseDirectory(value.request);
  }

  async search(params: FileSearchRuntimeRequest<OnlyPreviewSearchRequest>) {
    const value = requireRuntimeRequest<OnlyPreviewSearchRequest>(params);
    return await runtime.search(value.request);
  }

  async preview(params: FileSearchRuntimeRequest<OnlyPreviewGlobalSearchPreviewRequest>) {
    const value = requireRuntimeRequest<OnlyPreviewGlobalSearchPreviewRequest>(params);
    return await runtime.preview(value.request);
  }

  async openOfficeRead(params: FileSearchRuntimeRequest<OnlyPreviewGlobalSearchOfficeReadRequest>) {
    const value = requireRuntimeRequest<OnlyPreviewGlobalSearchOfficeReadRequest>(params);
    return await runtime.openOfficeRead(value.request);
  }

  async readOfficeChunk(
    params: FileSearchRuntimeRequest<OnlyPreviewGlobalSearchOfficeReadChunkRequest>
  ) {
    const value = requireRuntimeRequest<OnlyPreviewGlobalSearchOfficeReadChunkRequest>(params);
    return await runtime.readOfficeChunk(value.request);
  }

  async cancelOfficeRead(
    params: FileSearchRuntimeRequest<OnlyPreviewGlobalSearchOfficeReadRequest>
  ) {
    const value = requireRuntimeRequest<OnlyPreviewGlobalSearchOfficeReadRequest>(params);
    return await runtime.cancelOfficeRead(value.request);
  }

  async cancel(params: FileSearchRuntimeRequest<OnlyPreviewSearchCancelRequest>) {
    const value = requireRuntimeRequest<OnlyPreviewSearchCancelRequest>(params);
    return await runtime.cancel(value.request);
  }

  async shutdown(params: FileSearchRuntimeRequest<OnlyPreviewSearchShutdownRequest>) {
    const value = requireRuntimeRequest<OnlyPreviewSearchShutdownRequest>(params);
    const result = await runtime.shutdown(value.request);
    await officeReader.dispose();
    projectAuthority.dispose();
    previewReader.dispose();
    return result;
  }
}

export class OnlyPreviewFileAuthorityRuntime
  extends XpcPreloadHandler
  implements OnlyPreviewFileAuthorityRuntimePrivateApi
{
  async ready(
    params: OnlyPreviewFileAuthorityRuntimeReadyRequest
  ): Promise<OnlyPreviewFileAuthorityRuntimeReadyResult> {
    if (!isRecord(params) || !hasExactKeys(params, ['capability', 'runtimeInstanceId'])) {
      return { ok: false, error: 'Project authority readiness request is invalid.' };
    }
    try {
      requireProjectAuthorityIdentity(params.capability, params.runtimeInstanceId);
      return { ok: true };
    } catch {
      return { ok: false, error: 'Project authority runtime is unavailable.' };
    }
  }

  async inspectTarget(params: OnlyPreviewFileAuthorityTargetInspectionRequest) {
    try {
      if (
        !isRecord(params) ||
        !hasExactKeys(params, ['absoluteTarget', 'capability', 'runtimeInstanceId']) ||
        typeof params.absoluteTarget !== 'string'
      ) {
        throw new TypeError('Project target inspection request is invalid.');
      }
      requireProjectAuthorityIdentity(params.capability, params.runtimeInstanceId);
      return onlyPreviewSuccess(await inspectOnlyPreviewProjectTarget(params.absoluteTarget));
    } catch (error) {
      return onlyPreviewFailure(error);
    }
  }

  async bindWorkspace(params: OnlyPreviewFileAuthorityWorkspaceBindRequest) {
    try {
      if (
        !isRecord(params) ||
        !hasExactKeys(params, [
          'capability',
          'rootPath',
          'runtimeInstanceId',
          'workspaceId'
        ]) ||
        typeof params.rootPath !== 'string' ||
        typeof params.workspaceId !== 'string'
      ) {
        throw new TypeError('Project authority workspace binding is invalid.');
      }
      requireProjectAuthorityIdentity(params.capability, params.runtimeInstanceId);
      return onlyPreviewSuccess(
        await projectAuthority.bindWorkspace(
          runtimeInstanceId,
          params.workspaceId,
          params.rootPath
        )
      );
    } catch (error) {
      return onlyPreviewFailure(error);
    }
  }

  async revokeWorkspace(params: OnlyPreviewFileAuthorityWorkspaceRef) {
    try {
      if (
        !isRecord(params) ||
        !hasExactKeys(params, [
          'capability',
          'runtimeInstanceId',
          'workspaceGeneration',
          'workspaceId'
        ])
      ) {
        throw new TypeError('Project authority workspace revocation is invalid.');
      }
      requireProjectAuthorityIdentity(params.capability, params.runtimeInstanceId);
      const workspace = requireProjectWorkspaceRef(params);
      await projectAuthority.revokeWorkspace(
        workspace.workspaceId,
        workspace.workspaceGeneration
      );
      return onlyPreviewSuccess(undefined);
    } catch (error) {
      return onlyPreviewFailure(error);
    }
  }

  async authorizeItem(params: OnlyPreviewFileAuthorityItemRequest) {
    try {
      if (
        !isRecord(params) ||
        !hasExactKeys(params, [
          'capability',
          'relativePath',
          'runtimeInstanceId',
          'workspaceGeneration',
          'workspaceId'
        ]) ||
        typeof params.relativePath !== 'string'
      ) {
        throw new TypeError('Project item authorization request is invalid.');
      }
      requireProjectAuthorityIdentity(params.capability, params.runtimeInstanceId);
      const workspace = requireProjectWorkspaceRef(params);
      return onlyPreviewSuccess(
        await projectAuthority.authorizeItem(
          runtimeInstanceId,
          workspace.workspaceId,
          workspace.workspaceGeneration,
          params.relativePath
        )
      );
    } catch (error) {
      return onlyPreviewFailure(error);
    }
  }

  async authorizeRoot(params: OnlyPreviewFileAuthorityWorkspaceRef) {
    try {
      if (
        !isRecord(params) ||
        !hasExactKeys(params, [
          'capability',
          'runtimeInstanceId',
          'workspaceGeneration',
          'workspaceId'
        ])
      ) {
        throw new TypeError('Project root authorization request is invalid.');
      }
      requireProjectAuthorityIdentity(params.capability, params.runtimeInstanceId);
      const workspace = requireProjectWorkspaceRef(params);
      return onlyPreviewSuccess(
        await projectAuthority.authorizeRoot(
          runtimeInstanceId,
          workspace.workspaceId,
          workspace.workspaceGeneration
        )
      );
    } catch (error) {
      return onlyPreviewFailure(error);
    }
  }

  async createDirectory(params: OnlyPreviewFileAuthorityCreateDirectoryRequest) {
    try {
      if (
        !isRecord(params) ||
        !hasExactKeys(params, [
          'capability',
          'name',
          'parentRelativePath',
          'runtimeInstanceId',
          'workspaceGeneration',
          'workspaceId'
        ]) ||
        typeof params.parentRelativePath !== 'string' ||
        typeof params.name !== 'string'
      ) {
        throw new TypeError('Project folder creation request is invalid.');
      }
      requireProjectAuthorityIdentity(params.capability, params.runtimeInstanceId);
      const workspace = requireProjectWorkspaceRef(params);
      return onlyPreviewSuccess(
        await projectAuthority.createDirectory(
          runtimeInstanceId,
          workspace.workspaceId,
          workspace.workspaceGeneration,
          params.parentRelativePath,
          params.name
        )
      );
    } catch (error) {
      return onlyPreviewFailure(error);
    }
  }

  async renameEntry(params: OnlyPreviewFileAuthorityRenameRequest) {
    try {
      if (
        !isRecord(params) ||
        !hasExactKeys(params, [
          'capability',
          'name',
          'relativePath',
          'runtimeInstanceId',
          'workspaceGeneration',
          'workspaceId'
        ]) ||
        typeof params.relativePath !== 'string' ||
        typeof params.name !== 'string'
      ) {
        throw new TypeError('Project rename request is invalid.');
      }
      requireProjectAuthorityIdentity(params.capability, params.runtimeInstanceId);
      const workspace = requireProjectWorkspaceRef(params);
      return onlyPreviewSuccess(
        await projectAuthority.renameEntry(
          runtimeInstanceId,
          workspace.workspaceId,
          workspace.workspaceGeneration,
          params.relativePath,
          params.name
        )
      );
    } catch (error) {
      return onlyPreviewFailure(error);
    }
  }

  async prepareDelete(params: OnlyPreviewFileAuthorityItemRequest) {
    try {
      if (
        !isRecord(params) ||
        !hasExactKeys(params, [
          'capability',
          'relativePath',
          'runtimeInstanceId',
          'workspaceGeneration',
          'workspaceId'
        ]) ||
        typeof params.relativePath !== 'string'
      ) {
        throw new TypeError('Delete preparation request is invalid.');
      }
      requireProjectAuthorityIdentity(params.capability, params.runtimeInstanceId);
      const workspace = requireProjectWorkspaceRef(params);
      return onlyPreviewSuccess(
        await projectAuthority.prepareDelete(
          runtimeInstanceId,
          workspace.workspaceId,
          workspace.workspaceGeneration,
          params.relativePath
        )
      );
    } catch (error) {
      return onlyPreviewFailure(error);
    }
  }

  async commitDelete(params: OnlyPreviewFileAuthorityDeleteGrantRequest) {
    try {
      if (
        !isRecord(params) ||
        !hasExactKeys(params, [
          'capability',
          'grantId',
          'relativePath',
          'runtimeInstanceId',
          'workspaceGeneration',
          'workspaceId'
        ]) ||
        !INSTANCE_PATTERN.test(String(params.grantId)) ||
        typeof params.relativePath !== 'string'
      ) {
        throw new TypeError('Delete commit request is invalid.');
      }
      requireProjectAuthorityIdentity(params.capability, params.runtimeInstanceId);
      const workspace = requireProjectWorkspaceRef(params);
      return onlyPreviewSuccess(
        await projectAuthority.commitDelete(
          runtimeInstanceId,
          workspace.workspaceId,
          workspace.workspaceGeneration,
          params.grantId,
          params.relativePath
        )
      );
    } catch (error) {
      return onlyPreviewFailure(error);
    }
  }

  async cancelDelete(params: OnlyPreviewFileAuthorityDeleteGrantRequest) {
    try {
      if (
        !isRecord(params) ||
        !hasExactKeys(params, [
          'capability',
          'grantId',
          'relativePath',
          'runtimeInstanceId',
          'workspaceGeneration',
          'workspaceId'
        ]) ||
        !INSTANCE_PATTERN.test(String(params.grantId)) ||
        typeof params.relativePath !== 'string'
      ) {
        throw new TypeError('Delete cancellation request is invalid.');
      }
      requireProjectAuthorityIdentity(params.capability, params.runtimeInstanceId);
      const workspace = requireProjectWorkspaceRef(params);
      await projectAuthority.cancelDelete(
        runtimeInstanceId,
        workspace.workspaceId,
        workspace.workspaceGeneration,
        params.grantId,
        params.relativePath
      );
      return onlyPreviewSuccess(undefined);
    } catch (error) {
      return onlyPreviewFailure(error);
    }
  }
}

export class OnlyPreviewOfficeReadRuntime
  extends XpcPreloadHandler
  implements OnlyPreviewOfficeReadRuntimePrivateApi
{
  async ready(
    params: OnlyPreviewOfficeReadRuntimeReadyRequest
  ): Promise<OnlyPreviewOfficeReadRuntimeReadyResult> {
    if (!isRecord(params) || !hasExactKeys(params, ['capability', 'instanceId'])) {
      return { ok: false, error: 'Office read readiness request is invalid.' };
    }
    try {
      requireOfficeReadCapability(params.capability);
      if (params.instanceId !== runtimeInstanceId) {
        throw new TypeError('Office read runtime instance is invalid.');
      }
      return { ok: true };
    } catch {
      return { ok: false, error: 'Office read runtime is unavailable.' };
    }
  }

  async bindWorkspace(params: OnlyPreviewOfficeReadWorkspaceBindRequest) {
    try {
      if (
        !isRecord(params) ||
        !hasExactKeys(params, ['capability', 'rootPath', 'workspaceId']) ||
        typeof params.workspaceId !== 'string' ||
        typeof params.rootPath !== 'string'
      ) {
        throw new TypeError('Office workspace binding request is invalid.');
      }
      requireOfficeReadCapability(params.capability);
      await officeReader.bindWorkspace(params.workspaceId, params.rootPath);
      return onlyPreviewSuccess(undefined);
    } catch (error) {
      return onlyPreviewFailure(error);
    }
  }

  async prepare(params: OnlyPreviewOfficePrepareRuntimeRequest) {
    try {
      if (!isRecord(params) || !hasExactKeys(params, ['capability', 'grant'])) {
        throw new TypeError('Office prepare request is invalid.');
      }
      requireOfficeReadCapability(params.capability);
      return onlyPreviewSuccess(
        await officeReader.prepare(requireOfficePrepareGrant(params.grant))
      );
    } catch (error) {
      return onlyPreviewFailure(error);
    }
  }

  async open(params: OnlyPreviewOfficeReadOpenRuntimeRequest) {
    try {
      if (
        !isRecord(params) ||
        !hasExactKeys(params, ['capability', 'grantId', 'runtimeId', 'selectionRevision'])
      ) {
        throw new TypeError('Office read-open request is invalid.');
      }
      requireOfficeReadCapability(params.capability);
      const identity = requireOfficeReadIdentity(params);
      return onlyPreviewSuccess(
        await officeReader.open(identity.grantId, identity.runtimeId, identity.selectionRevision)
      );
    } catch (error) {
      return onlyPreviewFailure(error);
    }
  }

  async readNext(params: OnlyPreviewOfficeReadChunkRuntimeRequest) {
    try {
      if (
        !isRecord(params) ||
        !hasExactKeys(params, [
          'capability',
          'grantId',
          'offset',
          'runtimeId',
          'selectionRevision'
        ]) ||
        !Number.isSafeInteger(params.offset)
      ) {
        throw new TypeError('Office read-chunk request is invalid.');
      }
      requireOfficeReadCapability(params.capability);
      const identity = requireOfficeReadIdentity(params);
      return onlyPreviewSuccess(
        await officeReader.readNext(
          identity.grantId,
          identity.runtimeId,
          identity.selectionRevision,
          params.offset
        )
      );
    } catch (error) {
      return onlyPreviewFailure(error);
    }
  }

  async cancel(params: OnlyPreviewOfficeReadRuntimeCancelRequest) {
    try {
      if (
        !isRecord(params) ||
        !Reflect.ownKeys(params).every(
          (key) =>
            typeof key === 'string' &&
            ['capability', 'grantId', 'runtimeId', 'selectionRevision'].includes(key)
        ) ||
        !Object.hasOwn(params, 'capability')
      ) {
        throw new TypeError('Office read cancellation request is invalid.');
      }
      requireOfficeReadCapability(params.capability);
      if (params.grantId !== undefined && !INSTANCE_PATTERN.test(params.grantId)) {
        throw new TypeError('Office read cancellation grant is invalid.');
      }
      if (params.runtimeId !== undefined && !INSTANCE_PATTERN.test(params.runtimeId)) {
        throw new TypeError('Office read cancellation runtime is invalid.');
      }
      if (
        params.selectionRevision !== undefined &&
        !Number.isSafeInteger(params.selectionRevision)
      ) {
        throw new TypeError('Office read cancellation revision is invalid.');
      }
      await officeReader.cancel(params.grantId, params.runtimeId, params.selectionRevision);
      return onlyPreviewSuccess(undefined);
    } catch (error) {
      return onlyPreviewFailure(error);
    }
  }
}

export let fileSearchRuntime: FileSearchRuntime | null = null;
export let officeReadRuntime: OnlyPreviewOfficeReadRuntime | null = null;
export let projectAuthorityRuntime: OnlyPreviewFileAuthorityRuntime | null = null;
export let previewReadRuntime: OnlyPreviewPreviewReadRuntime | null = null;

const registerFileSearchRuntime = (): void => {
  if (
    fileSearchRuntime ||
    globalThis.location?.pathname.endsWith('/fileSearch/index.html') !== true
  ) {
    return;
  }
  Object.defineProperty(FileSearchRuntime, 'name', {
    value: fileSearchRuntimeHandlerName(runtimeCapability)
  });
  fileSearchRuntime = new FileSearchRuntime();
  Object.defineProperty(OnlyPreviewOfficeReadRuntime, 'name', {
    value: onlyPreviewOfficeReadRuntimeHandlerName(officeReadCapability)
  });
  officeReadRuntime = new OnlyPreviewOfficeReadRuntime();
  Object.defineProperty(OnlyPreviewFileAuthorityRuntime, 'name', {
    value: onlyPreviewFileAuthorityRuntimeHandlerName(projectAuthorityCapability)
  });
  projectAuthorityRuntime = new OnlyPreviewFileAuthorityRuntime();
  Object.defineProperty(OnlyPreviewPreviewReadRuntime, 'name', {
    value: onlyPreviewPreviewReadRuntimeHandlerName(previewReadCapability)
  });
  previewReadRuntime = new OnlyPreviewPreviewReadRuntime({
    runtimeCapability,
    officeReadCapability,
    projectAuthorityCapability,
    previewReadCapability,
    runtimeInstanceId,
    reader: previewReader
  });
};

registerFileSearchRuntime();
if (!fileSearchRuntime) {
  globalThis.addEventListener?.('DOMContentLoaded', registerFileSearchRuntime, { once: true });
}

globalThis.addEventListener?.('unload', () => {
  void runtime.dispose();
  void officeReader.dispose();
  projectAuthority.dispose();
  previewReader.dispose();
});
