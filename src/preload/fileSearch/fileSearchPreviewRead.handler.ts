import { XpcPreloadHandler } from 'electron-xpc/preload';
import {
  type OnlyPreviewPreviewReadCancelRequest,
  type OnlyPreviewPreviewReadChunkRequest,
  type OnlyPreviewPreviewReadDocumentResourceRequest,
  type OnlyPreviewPreviewReadOpenRequest,
  type OnlyPreviewPreviewReadPrepareGrant,
  type OnlyPreviewPreviewReadPrepareRequest,
  type OnlyPreviewPreviewReadRuntimePrivateApi,
  type OnlyPreviewPreviewReadRuntimeReadyRequest,
  type OnlyPreviewPreviewReadRuntimeReadyResult,
  type OnlyPreviewPreviewReadWorkspaceBindRequest,
  type OnlyPreviewPreviewReadWorkspaceRef
} from '@shared/onlypreview/onlyPreviewPreviewReadRuntime.types';
import { onlyPreviewFailure, onlyPreviewSuccess } from '@shared/onlypreview/onlyPreview.contract';
import type { FileSearchPreviewReader } from './fileSearchPreviewReader.service';

const CAPABILITY_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const INSTANCE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const hasExactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const actual = Reflect.ownKeys(value);
  return (
    actual.length === keys.length &&
    actual.every((key) => typeof key === 'string' && keys.includes(key))
  );
};

export interface FileSearchPreviewReadHandlerOptions {
  runtimeCapability: string;
  officeReadCapability: string;
  projectAuthorityCapability: string;
  previewReadCapability: string;
  runtimeInstanceId: string;
  reader: FileSearchPreviewReader;
}

export class OnlyPreviewPreviewReadRuntime
  extends XpcPreloadHandler
  implements OnlyPreviewPreviewReadRuntimePrivateApi
{
  constructor(private readonly options: FileSearchPreviewReadHandlerOptions) {
    super();
  }

  async ready(
    params: OnlyPreviewPreviewReadRuntimeReadyRequest
  ): Promise<OnlyPreviewPreviewReadRuntimeReadyResult> {
    if (!isRecord(params) || !hasExactKeys(params, ['capability', 'runtimeInstanceId'])) {
      return { ok: false, error: 'Preview Read readiness request is invalid.' };
    }
    try {
      this.requireIdentity(params.capability, params.runtimeInstanceId);
      return { ok: true };
    } catch {
      return { ok: false, error: 'Preview Read runtime is unavailable.' };
    }
  }

  async bindWorkspace(params: OnlyPreviewPreviewReadWorkspaceBindRequest) {
    try {
      if (
        !isRecord(params) ||
        !hasExactKeys(params, [
          'capability',
          'rootPath',
          'runtimeInstanceId',
          'workspaceGeneration',
          'workspaceId'
        ]) ||
        typeof params.rootPath !== 'string' ||
        typeof params.workspaceId !== 'string' ||
        !Number.isSafeInteger(params.workspaceGeneration)
      ) {
        throw new TypeError('Preview Read workspace binding is invalid.');
      }
      this.requireIdentity(params.capability, params.runtimeInstanceId);
      await this.options.reader.bindWorkspace(
        params.workspaceId,
        params.workspaceGeneration,
        params.rootPath
      );
      return onlyPreviewSuccess(undefined);
    } catch (error) {
      return onlyPreviewFailure(error);
    }
  }

  async revokeWorkspace(params: OnlyPreviewPreviewReadWorkspaceRef) {
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
        throw new TypeError('Preview Read workspace revocation is invalid.');
      }
      this.requireIdentity(params.capability, params.runtimeInstanceId);
      const workspace = this.requireWorkspaceRef(params);
      this.options.reader.revokeWorkspace(workspace.workspaceId, workspace.workspaceGeneration);
      return onlyPreviewSuccess(undefined);
    } catch (error) {
      return onlyPreviewFailure(error);
    }
  }

  async prepare(params: OnlyPreviewPreviewReadPrepareRequest) {
    try {
      if (
        !isRecord(params) ||
        !hasExactKeys(params, ['capability', 'grant', 'runtimeInstanceId'])
      ) {
        throw new TypeError('Preview Read preparation request is invalid.');
      }
      this.requireIdentity(params.capability, params.runtimeInstanceId);
      return onlyPreviewSuccess(
        await this.options.reader.prepare(
          this.options.runtimeInstanceId,
          this.requirePrepareGrant(params.grant)
        )
      );
    } catch (error) {
      return onlyPreviewFailure(error);
    }
  }

  async inspectDocumentResource(params: OnlyPreviewPreviewReadDocumentResourceRequest) {
    try {
      if (
        !isRecord(params) ||
        !hasExactKeys(params, [
          'capability',
          'grantId',
          'requestPath',
          'runtimeInstanceId',
          'selectionRevision'
        ]) ||
        typeof params.requestPath !== 'string'
      ) {
        throw new TypeError('Preview Read document resource request is invalid.');
      }
      this.requireIdentity(params.capability, params.runtimeInstanceId);
      const selection = this.requireSelectionRef(params);
      return onlyPreviewSuccess(
        await this.options.reader.inspectDocumentResource(
          this.options.runtimeInstanceId,
          selection.grantId,
          selection.selectionRevision,
          params.requestPath
        )
      );
    } catch (error) {
      return onlyPreviewFailure(error);
    }
  }

  async open(params: OnlyPreviewPreviewReadOpenRequest) {
    try {
      if (
        !isRecord(params) ||
        !hasExactKeys(params, [
          'capability',
          'end',
          'grantId',
          'method',
          'runtimeInstanceId',
          'selectionRevision',
          'sessionId',
          'source',
          'start'
        ]) ||
        !INSTANCE_PATTERN.test(String(params.sessionId)) ||
        (params.method !== 'GET' && params.method !== 'HEAD') ||
        !Number.isSafeInteger(params.start) ||
        !Number.isSafeInteger(params.end) ||
        !isRecord(params.source) ||
        (params.source.kind === 'selection'
          ? !hasExactKeys(params.source, ['kind'])
          : params.source.kind === 'document'
            ? !hasExactKeys(params.source, ['kind', 'requestPath']) ||
              typeof params.source.requestPath !== 'string'
            : true)
      ) {
        throw new TypeError('Preview Read open request is invalid.');
      }
      this.requireIdentity(params.capability, params.runtimeInstanceId);
      this.requireSelectionRef(params);
      return onlyPreviewSuccess(
        await this.options.reader.open(this.options.runtimeInstanceId, {
          grantId: params.grantId,
          selectionRevision: params.selectionRevision,
          sessionId: params.sessionId,
          method: params.method,
          source: params.source,
          start: params.start,
          end: params.end
        })
      );
    } catch (error) {
      return onlyPreviewFailure(error);
    }
  }

  async readNext(params: OnlyPreviewPreviewReadChunkRequest) {
    try {
      if (
        !isRecord(params) ||
        !hasExactKeys(params, [
          'capability',
          'grantId',
          'offset',
          'runtimeInstanceId',
          'selectionRevision',
          'sessionId'
        ]) ||
        !INSTANCE_PATTERN.test(String(params.sessionId)) ||
        !Number.isSafeInteger(params.offset)
      ) {
        throw new TypeError('Preview Read chunk request is invalid.');
      }
      this.requireIdentity(params.capability, params.runtimeInstanceId);
      const selection = this.requireSelectionRef(params);
      return onlyPreviewSuccess(
        await this.options.reader.readNext(
          this.options.runtimeInstanceId,
          selection.grantId,
          selection.selectionRevision,
          params.sessionId,
          params.offset
        )
      );
    } catch (error) {
      return onlyPreviewFailure(error);
    }
  }

  async cancel(params: OnlyPreviewPreviewReadCancelRequest) {
    try {
      if (
        !isRecord(params) ||
        !Reflect.ownKeys(params).every(
          (key) =>
            typeof key === 'string' &&
            [
              'capability',
              'grantId',
              'runtimeInstanceId',
              'selectionRevision',
              'sessionId'
            ].includes(key)
        ) ||
        !hasExactKeys(params, [
          'capability',
          'runtimeInstanceId',
          ...(Object.hasOwn(params, 'grantId') ? ['grantId'] : []),
          ...(Object.hasOwn(params, 'selectionRevision') ? ['selectionRevision'] : []),
          ...(Object.hasOwn(params, 'sessionId') ? ['sessionId'] : [])
        ]) ||
        (params.grantId !== undefined && !INSTANCE_PATTERN.test(params.grantId)) ||
        (params.sessionId !== undefined && !INSTANCE_PATTERN.test(params.sessionId)) ||
        (params.selectionRevision !== undefined && !Number.isSafeInteger(params.selectionRevision))
      ) {
        throw new TypeError('Preview Read cancellation request is invalid.');
      }
      this.requireIdentity(params.capability, params.runtimeInstanceId);
      this.options.reader.cancel(params.grantId, params.selectionRevision, params.sessionId);
      return onlyPreviewSuccess(undefined);
    } catch (error) {
      return onlyPreviewFailure(error);
    }
  }

  private requireIdentity(value: unknown, instanceId: unknown): void {
    const options = this.options;
    if (
      !CAPABILITY_PATTERN.test(options.previewReadCapability) ||
      value !== options.previewReadCapability ||
      options.previewReadCapability === options.runtimeCapability ||
      options.previewReadCapability === options.officeReadCapability ||
      options.previewReadCapability === options.projectAuthorityCapability ||
      instanceId !== options.runtimeInstanceId ||
      !INSTANCE_PATTERN.test(options.runtimeInstanceId)
    ) {
      throw new TypeError('Preview Read runtime identity is invalid.');
    }
  }

  private requireWorkspaceRef(value: Record<string, unknown>): {
    workspaceId: string;
    workspaceGeneration: number;
  } {
    if (
      typeof value.workspaceId !== 'string' ||
      value.workspaceId.length < 16 ||
      value.workspaceId.length > 256 ||
      !Number.isSafeInteger(value.workspaceGeneration) ||
      (value.workspaceGeneration as number) < 1
    ) {
      throw new TypeError('Preview Read workspace reference is invalid.');
    }
    return value as unknown as { workspaceId: string; workspaceGeneration: number };
  }

  private requireSelectionRef(value: Record<string, unknown>): {
    grantId: string;
    selectionRevision: number;
  } {
    if (
      !INSTANCE_PATTERN.test(String(value.grantId)) ||
      !Number.isSafeInteger(value.selectionRevision) ||
      (value.selectionRevision as number) < 1
    ) {
      throw new TypeError('Preview Read selection reference is invalid.');
    }
    return value as unknown as { grantId: string; selectionRevision: number };
  }

  private requirePrepareGrant(value: unknown): OnlyPreviewPreviewReadPrepareGrant {
    if (
      !isRecord(value) ||
      !hasExactKeys(value, [
        'grantId',
        'relativePath',
        'selectionRevision',
        'workspaceGeneration',
        'workspaceId'
      ]) ||
      !INSTANCE_PATTERN.test(String(value.grantId)) ||
      typeof value.workspaceId !== 'string' ||
      typeof value.relativePath !== 'string' ||
      !Number.isSafeInteger(value.workspaceGeneration) ||
      !Number.isSafeInteger(value.selectionRevision)
    ) {
      throw new TypeError('Preview Read preparation grant is invalid.');
    }
    return value as unknown as OnlyPreviewPreviewReadPrepareGrant;
  }
}
