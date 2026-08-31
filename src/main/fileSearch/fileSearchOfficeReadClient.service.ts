import type { BrowserWindow } from 'electron';
import { randomBytes } from 'node:crypto';
import { createXpcMainEmitter } from 'electron-xpc/main';
import { OnlyPreviewContractError } from '@shared/onlypreview/onlyPreview.contract';
import {
  ONLY_PREVIEW_OFFICE_READ_CHUNK_BYTES,
  ONLY_PREVIEW_OFFICE_READ_MAX_BYTES,
  onlyPreviewOfficeReadRuntimeHandlerName,
  type OnlyPreviewOfficePrepareGrant,
  type OnlyPreviewOfficePrepareRuntimeResult,
  type OnlyPreviewOfficeReadChunkRuntimeResult,
  type OnlyPreviewOfficeReadOpenRuntimeResult,
  type OnlyPreviewOfficeReadRuntimePrivateApi
} from '@shared/onlypreview/onlyPreviewOfficeReadRuntime.types';
import {
  OnlyPreviewOfficeReadProtocolError,
  unwrapOnlyPreviewOfficeReadReadyResponse,
  unwrapOnlyPreviewOfficeReadResponse
} from './fileSearchOfficeReadResponse.service';

const OFFICE_READ_CONTROL_TIMEOUT_MS = 10_000;
const OFFICE_READ_CHUNK_TIMEOUT_MS = 5_000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const hasExactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const actual = Reflect.ownKeys(value);
  return (
    actual.length === keys.length &&
    actual.every((key) => typeof key === 'string' && keys.includes(key))
  );
};

interface FileSearchOfficeReadHost {
  getLifecycleState(): {
    lifecycleId: number;
    window: BrowserWindow | null;
  };
  rejectProtocol(message: string): never;
}

interface OfficeReadGrant {
  runtimeId: string;
  selectionRevision: number;
  kind: OnlyPreviewPrepareKind;
  size: number;
  maxBytes: number;
}

type OnlyPreviewPrepareKind = OnlyPreviewOfficePrepareGrant['kind'];

interface OfficeReadSession {
  runtimeId: string;
  selectionRevision: number;
  authorityGeneration: number;
  totalBytes: number;
  nextOffset: number;
  reading: boolean;
}

interface PendingOfficeReadOpen {
  runtimeId: string;
  selectionRevision: number;
  cancelled: boolean;
}

export class FileSearchOfficeReadClientService {
  private capability: string | null = null;
  private client: OnlyPreviewOfficeReadRuntimePrivateApi | null = null;
  private instanceId: string | null = null;
  private authorityGeneration = 0;
  private readonly grants = new Map<string, OfficeReadGrant>();
  private readonly pendingOpens = new Map<string, PendingOfficeReadOpen>();
  private readonly sessions = new Map<string, OfficeReadSession>();

  constructor(private readonly host: FileSearchOfficeReadHost) {}

  start(instanceId: string): string {
    this.stop();
    const capability = randomBytes(32).toString('base64url');
    this.capability = capability;
    this.client = createXpcMainEmitter<OnlyPreviewOfficeReadRuntimePrivateApi>(
      onlyPreviewOfficeReadRuntimeHandlerName(capability)
    );
    this.instanceId = instanceId;
    return capability;
  }

  async waitUntilReady(stopped: Promise<void>): Promise<void> {
    const client = this.client;
    const capability = this.capability;
    const instanceId = this.instanceId;
    if (!client || !capability || !instanceId) {
      throw new Error('Office read runtime startup was not initialized.');
    }
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const ready = await Promise.race([
      client.ready({ capability, instanceId }),
      stopped.then(() => {
        throw new Error('Office read runtime startup was superseded.');
      }),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error('Office read runtime startup timed out.')),
          OFFICE_READ_CONTROL_TIMEOUT_MS
        );
      })
    ]).finally(() => {
      if (timeout) clearTimeout(timeout);
    });
    let isReady: boolean;
    try {
      isReady = unwrapOnlyPreviewOfficeReadReadyResponse(ready);
    } catch (error) {
      if (error instanceof OnlyPreviewOfficeReadProtocolError) {
        return this.rejectProtocol('Office read readiness response is invalid.');
      }
      throw error;
    }
    if (!isReady) throw new Error('Office read runtime failed to initialize.');
  }

  stop(): void {
    const client = this.client;
    const capability = this.capability;
    this.authorityGeneration += 1;
    this.client = null;
    this.capability = null;
    this.instanceId = null;
    this.grants.clear();
    this.cancelPendingOpens({});
    this.sessions.clear();
    if (client && capability) {
      void client.cancel({ capability }).catch(() => undefined);
    }
  }

  async bindWorkspace(params: { workspaceId: string; rootPath: string }): Promise<void> {
    const authorityGeneration = ++this.authorityGeneration;
    this.cancelPendingOpens({});
    this.grants.clear();
    this.sessions.clear();
    const value = await this.call(
      (client, capability) => client.bindWorkspace({ capability, ...params }),
      OFFICE_READ_CONTROL_TIMEOUT_MS
    );
    if (value !== undefined) {
      return this.rejectProtocol('Office workspace binding response is invalid.');
    }
    if (authorityGeneration !== this.authorityGeneration) {
      throw new OnlyPreviewContractError(
        'OPERATION_FAILED',
        'The Office workspace binding was superseded.'
      );
    }
  }

  async prepare(
    grant: OnlyPreviewOfficePrepareGrant
  ): Promise<OnlyPreviewOfficePrepareRuntimeResult> {
    const authorityGeneration = this.authorityGeneration;
    const value = await this.call(
      (client, capability) => client.prepare({ capability, grant }),
      OFFICE_READ_CONTROL_TIMEOUT_MS,
      {
        grantId: grant.grantId,
        runtimeId: grant.runtimeId,
        selectionRevision: grant.selectionRevision
      }
    );
    if (authorityGeneration !== this.authorityGeneration) {
      throw new OnlyPreviewContractError(
        'OPERATION_FAILED',
        'The Office read preparation was superseded.'
      );
    }
    if (
      !isRecord(value) ||
      !hasExactKeys(value, [
        'grantId',
        'kind',
        'modifiedAt',
        'runtimeId',
        'selectionRevision',
        'size'
      ]) ||
      value.grantId !== grant.grantId ||
      value.runtimeId !== grant.runtimeId ||
      value.selectionRevision !== grant.selectionRevision ||
      value.kind !== grant.kind ||
      !Number.isSafeInteger(value.size) ||
      (value.size as number) < 0 ||
      (value.size as number) > grant.maxBytes ||
      (value.size as number) > ONLY_PREVIEW_OFFICE_READ_MAX_BYTES ||
      !Number.isFinite(value.modifiedAt)
    ) {
      return this.rejectProtocol('Office read preparation response is invalid.');
    }
    this.grants.set(grant.grantId, {
      runtimeId: grant.runtimeId,
      selectionRevision: grant.selectionRevision,
      kind: grant.kind,
      size: value.size as number,
      maxBytes: grant.maxBytes
    });
    return value as unknown as OnlyPreviewOfficePrepareRuntimeResult;
  }

  async open(params: {
    grantId: string;
    runtimeId: string;
    selectionRevision: number;
  }): Promise<OnlyPreviewOfficeReadOpenRuntimeResult> {
    const grant = this.grants.get(params.grantId);
    if (
      !grant ||
      grant.runtimeId !== params.runtimeId ||
      grant.selectionRevision !== params.selectionRevision
    ) {
      throw new OnlyPreviewContractError('INVALID_INPUT', 'Office read grant is unavailable.');
    }
    if (this.sessions.has(params.grantId) || this.pendingOpens.has(params.grantId)) {
      return this.rejectProtocol('Office read session was reused.');
    }
    const pending: PendingOfficeReadOpen = {
      runtimeId: params.runtimeId,
      selectionRevision: params.selectionRevision,
      cancelled: false
    };
    this.pendingOpens.set(params.grantId, pending);
    this.grants.delete(params.grantId);
    try {
      const value = await this.call(
        (client, capability) => client.open({ capability, ...params }),
        OFFICE_READ_CONTROL_TIMEOUT_MS,
        params
      );
      if (pending.cancelled || this.pendingOpens.get(params.grantId) !== pending) {
        throw new OnlyPreviewContractError(
          'OPERATION_FAILED',
          'The Office read session was cancelled.'
        );
      }
      if (
        !isRecord(value) ||
        !hasExactKeys(value, ['grantId', 'runtimeId', 'selectionRevision', 'totalBytes']) ||
        value.grantId !== params.grantId ||
        value.runtimeId !== params.runtimeId ||
        value.selectionRevision !== params.selectionRevision ||
        value.totalBytes !== grant.size ||
        !Number.isSafeInteger(value.totalBytes) ||
        (value.totalBytes as number) < 0 ||
        (value.totalBytes as number) > grant.maxBytes ||
        (value.totalBytes as number) > ONLY_PREVIEW_OFFICE_READ_MAX_BYTES
      ) {
        return this.rejectProtocol('Office read open response is invalid.');
      }
      this.sessions.set(params.grantId, {
        runtimeId: params.runtimeId,
        selectionRevision: params.selectionRevision,
        authorityGeneration: this.authorityGeneration,
        totalBytes: value.totalBytes as number,
        nextOffset: 0,
        reading: false
      });
      return value as unknown as OnlyPreviewOfficeReadOpenRuntimeResult;
    } finally {
      if (this.pendingOpens.get(params.grantId) === pending) {
        this.pendingOpens.delete(params.grantId);
      }
    }
  }

  async readNext(params: {
    grantId: string;
    runtimeId: string;
    selectionRevision: number;
    offset: number;
  }): Promise<OnlyPreviewOfficeReadChunkRuntimeResult> {
    const session = this.sessions.get(params.grantId);
    if (
      !session ||
      session.runtimeId !== params.runtimeId ||
      session.selectionRevision !== params.selectionRevision ||
      session.nextOffset !== params.offset ||
      session.reading
    ) {
      throw new OnlyPreviewContractError('INVALID_INPUT', 'Office read session is unavailable.');
    }
    session.reading = true;
    try {
      const value = await this.call(
        (client, capability) => client.readNext({ capability, ...params }),
        OFFICE_READ_CHUNK_TIMEOUT_MS,
        params
      );
      if (
        session.authorityGeneration !== this.authorityGeneration ||
        this.sessions.get(params.grantId) !== session
      ) {
        throw new OnlyPreviewContractError(
          'OPERATION_FAILED',
          'The Office read session was superseded.'
        );
      }
      const byteLength =
        isRecord(value) && value.bytes instanceof ArrayBuffer ? value.bytes.byteLength : -1;
      const nextOffset = params.offset + byteLength;
      if (
        !isRecord(value) ||
        !hasExactKeys(value, [
          'bytes',
          'eof',
          'grantId',
          'offset',
          'runtimeId',
          'selectionRevision'
        ]) ||
        value.grantId !== params.grantId ||
        value.runtimeId !== params.runtimeId ||
        value.selectionRevision !== params.selectionRevision ||
        value.offset !== params.offset ||
        !(value.bytes instanceof ArrayBuffer) ||
        byteLength < 0 ||
        byteLength > ONLY_PREVIEW_OFFICE_READ_CHUNK_BYTES ||
        (byteLength === 0 && session.totalBytes !== 0) ||
        nextOffset > session.totalBytes ||
        typeof value.eof !== 'boolean' ||
        value.eof !== (nextOffset === session.totalBytes)
      ) {
        this.sessions.delete(params.grantId);
        void this.cancel(params).catch(() => undefined);
        return this.rejectProtocol('Office read chunk response is invalid.');
      }
      session.nextOffset = nextOffset;
      if (value.eof) this.sessions.delete(params.grantId);
      return value as unknown as OnlyPreviewOfficeReadChunkRuntimeResult;
    } catch (error) {
      if (this.sessions.get(params.grantId) === session) {
        this.sessions.delete(params.grantId);
      }
      throw error;
    } finally {
      if (this.sessions.get(params.grantId) === session) {
        session.reading = false;
      }
    }
  }

  async cancel(params: {
    grantId?: string;
    runtimeId?: string;
    selectionRevision?: number;
  }): Promise<void> {
    this.cancelPendingOpens(params);
    for (const [grantId, grant] of this.grants) {
      if (params.grantId !== undefined && params.grantId !== grantId) continue;
      if (params.runtimeId !== undefined && params.runtimeId !== grant.runtimeId) continue;
      if (
        params.selectionRevision !== undefined &&
        params.selectionRevision !== grant.selectionRevision
      ) {
        continue;
      }
      this.grants.delete(grantId);
    }
    for (const [grantId, session] of this.sessions) {
      if (params.grantId !== undefined && params.grantId !== grantId) continue;
      if (params.runtimeId !== undefined && params.runtimeId !== session.runtimeId) continue;
      if (
        params.selectionRevision !== undefined &&
        params.selectionRevision !== session.selectionRevision
      ) {
        continue;
      }
      this.sessions.delete(grantId);
    }
    const value = await this.call(
      (client, capability) => client.cancel({ capability, ...params }),
      OFFICE_READ_CONTROL_TIMEOUT_MS
    );
    if (value !== undefined) {
      return this.rejectProtocol('Office read cancellation response is invalid.');
    }
  }

  private rejectProtocol(message: string): never {
    return this.host.rejectProtocol(message);
  }

  private cancelPendingOpens(params: {
    grantId?: string;
    runtimeId?: string;
    selectionRevision?: number;
  }): void {
    for (const [grantId, pending] of this.pendingOpens) {
      if (params.grantId !== undefined && params.grantId !== grantId) continue;
      if (params.runtimeId !== undefined && params.runtimeId !== pending.runtimeId) continue;
      if (
        params.selectionRevision !== undefined &&
        params.selectionRevision !== pending.selectionRevision
      ) {
        continue;
      }
      pending.cancelled = true;
      this.pendingOpens.delete(grantId);
    }
  }

  private async call<T>(
    operation: (
      client: OnlyPreviewOfficeReadRuntimePrivateApi,
      capability: string
    ) => Promise<unknown>,
    timeoutMs: number,
    timeoutScope?: { grantId?: string; runtimeId?: string; selectionRevision?: number }
  ): Promise<T> {
    const client = this.client;
    const capability = this.capability;
    const initial = this.host.getLifecycleState();
    if (!client || !capability || !initial.window || initial.window.isDestroyed()) {
      throw new OnlyPreviewContractError(
        'OPERATION_FAILED',
        'The Office read runtime is unavailable.'
      );
    }
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    try {
      const result = await Promise.race([
        operation(client, capability),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => {
            timedOut = true;
            reject(
              new OnlyPreviewContractError('OPERATION_FAILED', 'The Office read runtime timed out.')
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
          'The Office read runtime was superseded.'
        );
      }
      return unwrapOnlyPreviewOfficeReadResponse(result) as T;
    } catch (error) {
      if (timedOut) {
        if (timeoutScope?.grantId) {
          this.grants.delete(timeoutScope.grantId);
          this.cancelPendingOpens(timeoutScope);
          this.sessions.delete(timeoutScope.grantId);
        }
        void client.cancel({ capability, ...timeoutScope }).catch(() => undefined);
      }
      if (error instanceof OnlyPreviewOfficeReadProtocolError) {
        return this.rejectProtocol('Office read response is invalid.');
      }
      if (error instanceof OnlyPreviewContractError) throw error;
      throw new OnlyPreviewContractError(
        'OPERATION_FAILED',
        'The Office read runtime rejected the request.'
      );
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
}
