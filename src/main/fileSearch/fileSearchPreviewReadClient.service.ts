import type { BrowserWindow } from 'electron';
import { randomBytes } from 'node:crypto';
import { createXpcMainEmitter } from 'electron-xpc/main';
import {
  ONLY_PREVIEW_READ_CHUNK_BYTES,
  onlyPreviewPreviewReadRuntimeHandlerName,
  type OnlyPreviewPreviewReadChunkResult,
  type OnlyPreviewPreviewReadDocumentResource,
  type OnlyPreviewPreviewReadOpenRequest,
  type OnlyPreviewPreviewReadOpenResult,
  type OnlyPreviewPreviewReadPrepareGrant,
  type OnlyPreviewPreviewReadPreparedSelection,
  type OnlyPreviewPreviewReadRuntimePrivateApi
} from '@shared/onlypreview/onlyPreviewPreviewReadRuntime.types';
import { OnlyPreviewContractError } from '@shared/onlypreview/onlyPreview.contract';
import {
  OnlyPreviewPreviewReadProtocolError,
  unwrapOnlyPreviewPreviewReadReadyResponse,
  unwrapOnlyPreviewPreviewReadResponse
} from './fileSearchPreviewReadResponse.service';

const PREVIEW_READ_CONTROL_TIMEOUT_MS = 10_000;
const PREVIEW_READ_CHUNK_TIMEOUT_MS = 5_000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const hasExactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const actual = Reflect.ownKeys(value);
  return (
    actual.length === keys.length &&
    actual.every((key) => typeof key === 'string' && keys.includes(key))
  );
};

interface FileSearchPreviewReadHost {
  getLifecycleState(): {
    lifecycleId: number;
    window: BrowserWindow | null;
  };
  rejectProtocol(message: string): never;
}

interface PreviewReadSession {
  grantId: string;
  selectionRevision: number;
  nextOffset: number;
  end: number;
}

interface PreviewReadGrant {
  workspaceId: string;
  workspaceGeneration: number;
  relativePath: string;
  selectionRevision: number;
}

interface PendingPreviewReadOpen {
  grantId: string;
  selectionRevision: number;
  cancelled: boolean;
}

export class FileSearchPreviewReadClientService {
  private capability: string | null = null;
  private client: OnlyPreviewPreviewReadRuntimePrivateApi | null = null;
  private runtimeInstanceId: string | null = null;
  private readonly sessions = new Map<string, PreviewReadSession>();
  private readonly pendingOpens = new Map<string, PendingPreviewReadOpen>();
  private readonly grants = new Map<string, PreviewReadGrant>();

  constructor(private readonly host: FileSearchPreviewReadHost) {}

  start(runtimeInstanceId: string): string {
    this.stop();
    const capability = randomBytes(32).toString('base64url');
    this.capability = capability;
    this.client = createXpcMainEmitter<OnlyPreviewPreviewReadRuntimePrivateApi>(
      onlyPreviewPreviewReadRuntimeHandlerName(capability)
    );
    this.runtimeInstanceId = runtimeInstanceId;
    return capability;
  }

  async waitUntilReady(stopped: Promise<void>): Promise<void> {
    const client = this.client;
    const capability = this.capability;
    const runtimeInstanceId = this.runtimeInstanceId;
    if (!client || !capability || !runtimeInstanceId) {
      throw new Error('Preview Read runtime startup was not initialized.');
    }
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const ready = await Promise.race([
      client.ready({ capability, runtimeInstanceId }),
      stopped.then(() => {
        throw new Error('Preview Read runtime startup was superseded.');
      }),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error('Preview Read runtime startup timed out.')),
          PREVIEW_READ_CONTROL_TIMEOUT_MS
        );
      })
    ]).finally(() => {
      if (timeout) clearTimeout(timeout);
    });
    let isReady: boolean;
    try {
      isReady = unwrapOnlyPreviewPreviewReadReadyResponse(ready);
    } catch (error) {
      if (error instanceof OnlyPreviewPreviewReadProtocolError) {
        return this.rejectProtocol('Preview Read readiness response is invalid.');
      }
      throw error;
    }
    if (!isReady) throw new Error('Preview Read runtime failed to initialize.');
  }

  stop(): void {
    const client = this.client;
    const capability = this.capability;
    const runtimeInstanceId = this.runtimeInstanceId;
    this.client = null;
    this.capability = null;
    this.runtimeInstanceId = null;
    this.cancelPendingOpens({});
    this.sessions.clear();
    this.grants.clear();
    if (client && capability && runtimeInstanceId) {
      void client.cancel({ capability, runtimeInstanceId }).catch(() => undefined);
    }
  }

  async bindWorkspace(params: {
    workspaceId: string;
    workspaceGeneration: number;
    rootPath: string;
  }): Promise<void> {
    this.cancelPendingOpens({});
    const value = await this.call(
      (client, identity) => client.bindWorkspace({ ...identity, ...params }),
      PREVIEW_READ_CONTROL_TIMEOUT_MS
    );
    if (value !== undefined) {
      return this.rejectProtocol('Preview Read workspace binding response is invalid.');
    }
    this.sessions.clear();
    this.grants.clear();
  }

  async revokeWorkspace(params: {
    workspaceId: string;
    workspaceGeneration: number;
  }): Promise<void> {
    const revokedGrantIds = new Set<string>();
    for (const [grantId, grant] of this.grants) {
      if (
        grant.workspaceId === params.workspaceId &&
        grant.workspaceGeneration === params.workspaceGeneration
      ) {
        revokedGrantIds.add(grantId);
      }
    }
    for (const grantId of revokedGrantIds) this.cancelPendingOpens({ grantId });
    const value = await this.call(
      (client, identity) => client.revokeWorkspace({ ...identity, ...params }),
      PREVIEW_READ_CONTROL_TIMEOUT_MS
    );
    if (value !== undefined) {
      return this.rejectProtocol('Preview Read workspace revocation response is invalid.');
    }
    for (const [grantId, grant] of this.grants) {
      if (
        grant.workspaceId === params.workspaceId &&
        grant.workspaceGeneration === params.workspaceGeneration
      ) {
        this.grants.delete(grantId);
      }
    }
    for (const [sessionId, session] of this.sessions) {
      if (revokedGrantIds.has(session.grantId)) this.sessions.delete(sessionId);
    }
  }

  async prepare(
    grant: OnlyPreviewPreviewReadPrepareGrant
  ): Promise<OnlyPreviewPreviewReadPreparedSelection> {
    const value = await this.call(
      (client, identity) => client.prepare({ ...identity, grant }),
      PREVIEW_READ_CONTROL_TIMEOUT_MS,
      {
        grantId: grant.grantId,
        selectionRevision: grant.selectionRevision
      }
    );
    if (
      !isRecord(value) ||
      !hasExactKeys(value, [
        'descriptor',
        'grantId',
        'relativePath',
        'runtimeInstanceId',
        'selectionRevision',
        'workspaceGeneration',
        'workspaceId'
      ]) ||
      value.runtimeInstanceId !== this.runtimeInstanceId ||
      value.grantId !== grant.grantId ||
      value.selectionRevision !== grant.selectionRevision ||
      value.workspaceId !== grant.workspaceId ||
      value.workspaceGeneration !== grant.workspaceGeneration ||
      value.relativePath !== grant.relativePath ||
      !this.isValidDescriptor(value.descriptor, grant)
    ) {
      return this.rejectProtocol('Preview Read preparation response is invalid.');
    }
    this.grants.set(grant.grantId, {
      workspaceId: grant.workspaceId,
      workspaceGeneration: grant.workspaceGeneration,
      relativePath: grant.relativePath,
      selectionRevision: grant.selectionRevision
    });
    return value as unknown as OnlyPreviewPreviewReadPreparedSelection;
  }

  async inspectDocumentResource(params: {
    grantId: string;
    selectionRevision: number;
    requestPath: string;
  }): Promise<OnlyPreviewPreviewReadDocumentResource> {
    const value = await this.call(
      (client, identity) => client.inspectDocumentResource({ ...identity, ...params }),
      PREVIEW_READ_CONTROL_TIMEOUT_MS
    );
    if (
      !isRecord(value) ||
      !hasExactKeys(value, [
        'grantId',
        'requestPath',
        'runtimeInstanceId',
        'selectionRevision',
        'size'
      ]) ||
      value.runtimeInstanceId !== this.runtimeInstanceId ||
      value.grantId !== params.grantId ||
      value.selectionRevision !== params.selectionRevision ||
      value.requestPath !== params.requestPath ||
      !Number.isSafeInteger(value.size) ||
      (value.size as number) < 0
    ) {
      return this.rejectProtocol('HTML resource inspection response is invalid.');
    }
    return value as unknown as OnlyPreviewPreviewReadDocumentResource;
  }

  async open(
    params: Omit<OnlyPreviewPreviewReadOpenRequest, 'capability' | 'runtimeInstanceId'>
  ): Promise<OnlyPreviewPreviewReadOpenResult> {
    const grant = this.grants.get(params.grantId);
    if (!grant || grant.selectionRevision !== params.selectionRevision) {
      throw new OnlyPreviewContractError('INVALID_INPUT', 'Preview Read grant is unavailable.');
    }
    if (this.sessions.has(params.sessionId) || this.pendingOpens.has(params.sessionId)) {
      return this.rejectProtocol('Preview Read session was reused.');
    }
    const pending: PendingPreviewReadOpen = {
      grantId: params.grantId,
      selectionRevision: params.selectionRevision,
      cancelled: false
    };
    this.pendingOpens.set(params.sessionId, pending);
    try {
      const value = await this.call(
        (client, identity) => client.open({ ...identity, ...params }),
        PREVIEW_READ_CONTROL_TIMEOUT_MS,
        {
          grantId: params.grantId,
          selectionRevision: params.selectionRevision,
          sessionId: params.sessionId
        }
      );
      if (
        pending.cancelled ||
        this.pendingOpens.get(params.sessionId) !== pending ||
        this.grants.get(params.grantId) !== grant
      ) {
        throw new OnlyPreviewContractError(
          'OPERATION_FAILED',
          'The Preview Read session was cancelled.'
        );
      }
      if (
        !isRecord(value) ||
        !hasExactKeys(value, [
          'end',
          'eof',
          'grantId',
          'method',
          'runtimeInstanceId',
          'selectionRevision',
          'sessionId',
          'start',
          'totalBytes',
          'workspaceId',
          'relativePath'
        ]) ||
        value.runtimeInstanceId !== this.runtimeInstanceId ||
        value.grantId !== params.grantId ||
        value.selectionRevision !== params.selectionRevision ||
        value.sessionId !== params.sessionId ||
        value.method !== params.method ||
        value.start !== params.start ||
        value.end !== params.end ||
        value.workspaceId !== grant.workspaceId ||
        value.relativePath !== grant.relativePath ||
        !Number.isSafeInteger(value.totalBytes) ||
        (value.totalBytes as number) < 0 ||
        typeof value.eof !== 'boolean' ||
        value.eof !== (params.method === 'HEAD' || value.totalBytes === 0)
      ) {
        return this.rejectProtocol('Preview Read open response is invalid.');
      }
      if (!value.eof) {
        this.sessions.set(params.sessionId, {
          grantId: params.grantId,
          selectionRevision: params.selectionRevision,
          nextOffset: params.start,
          end: params.end
        });
      }
      return value as unknown as OnlyPreviewPreviewReadOpenResult;
    } finally {
      if (this.pendingOpens.get(params.sessionId) === pending) {
        this.pendingOpens.delete(params.sessionId);
      }
    }
  }

  async readNext(params: {
    grantId: string;
    selectionRevision: number;
    sessionId: string;
    offset: number;
  }): Promise<OnlyPreviewPreviewReadChunkResult> {
    const session = this.sessions.get(params.sessionId);
    if (
      !session ||
      session.grantId !== params.grantId ||
      session.selectionRevision !== params.selectionRevision ||
      session.nextOffset !== params.offset
    ) {
      throw new OnlyPreviewContractError('INVALID_INPUT', 'Preview Read session is unavailable.');
    }
    const value = await this.call(
      (client, identity) => client.readNext({ ...identity, ...params }),
      PREVIEW_READ_CHUNK_TIMEOUT_MS,
      params
    );
    if (
      !isRecord(value) ||
      !hasExactKeys(value, [
        'bytes',
        'eof',
        'grantId',
        'offset',
        'runtimeInstanceId',
        'selectionRevision',
        'sessionId'
      ]) ||
      value.runtimeInstanceId !== this.runtimeInstanceId ||
      value.grantId !== params.grantId ||
      value.selectionRevision !== params.selectionRevision ||
      value.sessionId !== params.sessionId ||
      value.offset !== params.offset ||
      !(value.bytes instanceof ArrayBuffer) ||
      value.bytes.byteLength > ONLY_PREVIEW_READ_CHUNK_BYTES ||
      value.bytes.byteLength === 0 ||
      typeof value.eof !== 'boolean' ||
      params.offset + value.bytes.byteLength > session.end + 1 ||
      value.eof !== (params.offset + value.bytes.byteLength === session.end + 1)
    ) {
      this.sessions.delete(params.sessionId);
      void this.cancel(params);
      return this.rejectProtocol('Preview Read chunk response is invalid.');
    }
    session.nextOffset += value.bytes.byteLength;
    if (value.eof) this.sessions.delete(params.sessionId);
    return value as unknown as OnlyPreviewPreviewReadChunkResult;
  }

  async cancel(params: {
    grantId?: string;
    selectionRevision?: number;
    sessionId?: string;
  }): Promise<void> {
    this.cancelPendingOpens(params);
    if (params.sessionId) this.sessions.delete(params.sessionId);
    else {
      for (const [sessionId, session] of this.sessions) {
        if (params.grantId !== undefined && session.grantId !== params.grantId) continue;
        if (
          params.selectionRevision !== undefined &&
          session.selectionRevision !== params.selectionRevision
        ) {
          continue;
        }
        this.sessions.delete(sessionId);
      }
    }
    if (!params.sessionId) {
      for (const [grantId, grant] of this.grants) {
        if (params.grantId !== undefined && grantId !== params.grantId) continue;
        if (
          params.selectionRevision !== undefined &&
          grant.selectionRevision !== params.selectionRevision
        ) {
          continue;
        }
        this.grants.delete(grantId);
      }
    }
    const value = await this.call(
      (client, identity) => client.cancel({ ...identity, ...params }),
      PREVIEW_READ_CONTROL_TIMEOUT_MS
    );
    if (value !== undefined) {
      return this.rejectProtocol('Preview Read cancellation response is invalid.');
    }
  }

  private isValidDescriptor(value: unknown, grant: OnlyPreviewPreviewReadPrepareGrant): boolean {
    if (!isRecord(value)) return false;
    const optionalKeys = [
      ...(Object.hasOwn(value, 'previewError') ? ['previewError'] : []),
      ...(Object.hasOwn(value, 'unsupportedCategory') ? ['unsupportedCategory'] : [])
    ];
    if (
      !hasExactKeys(value, [
        'extension',
        'kind',
        'language',
        'mimeType',
        'modifiedAt',
        'name',
        'relativePath',
        'size',
        'workspaceId',
        ...optionalKeys
      ]) ||
      value.workspaceId !== grant.workspaceId ||
      value.relativePath !== grant.relativePath ||
      typeof value.name !== 'string' ||
      !value.name ||
      typeof value.extension !== 'string' ||
      typeof value.mimeType !== 'string' ||
      !value.mimeType ||
      typeof value.language !== 'string' ||
      !Number.isSafeInteger(value.size) ||
      (value.size as number) < 0 ||
      !Number.isFinite(value.modifiedAt) ||
      !['text', 'pdf', 'image', 'audio', 'video', 'diagram', 'unsupported'].includes(
        String(value.kind)
      ) ||
      Object.hasOwn(value, 'assetUrl')
    ) {
      return false;
    }
    if (
      value.unsupportedCategory !== undefined &&
      value.unsupportedCategory !== 'image-format' &&
      value.unsupportedCategory !== 'video-container'
    ) {
      return false;
    }
    if (value.previewError !== undefined) {
      if (
        !isRecord(value.previewError) ||
        !hasExactKeys(value.previewError, ['code', 'message']) ||
        typeof value.previewError.code !== 'string' ||
        typeof value.previewError.message !== 'string' ||
        value.previewError.message.length < 1 ||
        value.previewError.message.length > 240 ||
        /[\0\r\n/\\]/.test(value.previewError.message)
      ) {
        return false;
      }
    }
    return true;
  }

  private rejectProtocol(message: string): never {
    return this.host.rejectProtocol(message);
  }

  private cancelPendingOpens(params: {
    grantId?: string;
    selectionRevision?: number;
    sessionId?: string;
  }): void {
    for (const [sessionId, pending] of this.pendingOpens) {
      if (params.sessionId !== undefined && sessionId !== params.sessionId) continue;
      if (params.grantId !== undefined && pending.grantId !== params.grantId) continue;
      if (
        params.selectionRevision !== undefined &&
        pending.selectionRevision !== params.selectionRevision
      ) {
        continue;
      }
      pending.cancelled = true;
      this.pendingOpens.delete(sessionId);
    }
  }

  private async call<T>(
    operation: (
      client: OnlyPreviewPreviewReadRuntimePrivateApi,
      identity: { capability: string; runtimeInstanceId: string }
    ) => Promise<unknown>,
    timeoutMs: number,
    timeoutScope?: { grantId?: string; selectionRevision?: number; sessionId?: string }
  ): Promise<T> {
    const client = this.client;
    const capability = this.capability;
    const runtimeInstanceId = this.runtimeInstanceId;
    const initial = this.host.getLifecycleState();
    if (
      !client ||
      !capability ||
      !runtimeInstanceId ||
      !initial.window ||
      initial.window.isDestroyed()
    ) {
      throw new OnlyPreviewContractError(
        'OPERATION_FAILED',
        'The Preview Read runtime is unavailable.'
      );
    }
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    try {
      const result = await Promise.race([
        operation(client, { capability, runtimeInstanceId }),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => {
            timedOut = true;
            reject(
              new OnlyPreviewContractError(
                'OPERATION_FAILED',
                'The Preview Read runtime timed out.'
              )
            );
          }, timeoutMs);
        })
      ]);
      const current = this.host.getLifecycleState();
      if (
        current.lifecycleId !== initial.lifecycleId ||
        current.window !== initial.window ||
        initial.window.isDestroyed()
      ) {
        throw new OnlyPreviewContractError(
          'OPERATION_FAILED',
          'The Preview Read runtime was superseded.'
        );
      }
      return unwrapOnlyPreviewPreviewReadResponse(result) as T;
    } catch (error) {
      if (timedOut) {
        this.cancelPendingOpens(timeoutScope ?? {});
        if (timeoutScope?.sessionId) this.sessions.delete(timeoutScope.sessionId);
        void client
          .cancel({ capability, runtimeInstanceId, ...timeoutScope })
          .catch(() => undefined);
      }
      if (error instanceof OnlyPreviewPreviewReadProtocolError) {
        return this.rejectProtocol('Preview Read response is invalid.');
      }
      if (error instanceof OnlyPreviewContractError) throw error;
      throw new OnlyPreviewContractError(
        'OPERATION_FAILED',
        'The Preview Read runtime rejected the request.'
      );
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
}
