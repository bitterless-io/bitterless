import { randomUUID } from 'node:crypto';
import { OnlyPreviewContractError } from '@shared/onlypreview/onlyPreview.contract';
import type { OnlyPreviewSearchBootstrap } from '@shared/onlypreview/onlyPreviewSearchBootstrap.types';
import {
  ONLY_PREVIEW_SEARCH_BATCH_EVENT,
  ONLY_PREVIEW_SEARCH_SNAPSHOT_EVENT,
  ONLY_PREVIEW_SEARCH_WATCH_COMMIT_EVENT
} from '@shared/onlypreview/onlyPreviewSearch.type';
import {
  ONLY_PREVIEW_SEARCH_UTILITY_EVENT_MESSAGE,
  ONLY_PREVIEW_SEARCH_UTILITY_REQUEST_MESSAGE,
  ONLY_PREVIEW_SEARCH_UTILITY_RESPONSE_MESSAGE,
  type OnlyPreviewSearchUtilityMethod,
  type OnlyPreviewSearchUtilityEventMessage,
  type OnlyPreviewSearchUtilityRequestMessage,
  type OnlyPreviewSearchUtilityResponseMessage
} from '@shared/onlypreview/onlyPreviewSearchUtility.types';

export interface OnlyPreviewSearchUtilityChild {
  on(event: 'message', listener: (message: unknown) => void): this;
  on(event: 'exit', listener: (code: number) => void): this;
  on(event: 'error', listener: (...args: unknown[]) => void): this;
  off(event: 'message', listener: (message: unknown) => void): this;
  off(event: 'exit', listener: (code: number) => void): this;
  off(event: 'error', listener: (...args: unknown[]) => void): this;
  postMessage(message: unknown): void;
}

interface PendingCall {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timeout: ReturnType<typeof setTimeout>;
}

interface ActiveUtility {
  hostToken: string;
  hostId: string;
  searchToken: string;
  child: OnlyPreviewSearchUtilityChild;
  pending: Map<string, PendingCall>;
  workspaceId: string | null;
  generation: number | null;
  broadcast(eventName: string, params: unknown): void;
  onMessage(message: unknown): void;
  onExit(code: number): void;
  onError(...args: unknown[]): void;
  onUnexpectedExit(): void;
}

const utilityStoppedError = (): Error =>
  new Error('OnlyPreview search utility stopped unexpectedly.');

export class OnlyPreviewSearchUtilityRpcService {
  private active: ActiveUtility | null = null;

  attach(params: {
    hostToken: string;
    hostId: string;
    searchToken: string;
    child: OnlyPreviewSearchUtilityChild;
    broadcast(eventName: string, params: unknown): void;
    onUnexpectedExit(): void;
  }): void {
    this.detach();
    const active: ActiveUtility = {
      hostToken: params.hostToken,
      hostId: params.hostId,
      searchToken: params.searchToken,
      child: params.child,
      pending: new Map(),
      workspaceId: null,
      generation: null,
      broadcast: params.broadcast,
      onMessage: () => undefined,
      onExit: () => undefined,
      onError: () => undefined,
      onUnexpectedExit: params.onUnexpectedExit
    };
    active.onMessage = (message) => this._handleMessage(active, message);
    active.onExit = () => this._handleUnexpectedExit(active);
    active.onError = () => this._handleUnexpectedExit(active);
    params.child.on('message', active.onMessage);
    params.child.on('exit', active.onExit);
    params.child.on('error', active.onError);
    this.active = active;
  }

  async call(
    hostToken: string,
    method: OnlyPreviewSearchUtilityMethod,
    params: unknown,
    timeoutMs: number,
    bootstrap?: OnlyPreviewSearchBootstrap
  ): Promise<unknown> {
    const active = this.active;
    if (!active) throw utilityStoppedError();
    if (active.hostToken !== hostToken) {
      throw new OnlyPreviewContractError(
        'HOST_ROLE_DENIED',
        'OnlyPreview search request does not belong to the active utility process.'
      );
    }
    const requestId = randomUUID();
    if (method === 'initialize') {
      const request = params as { workspaceId?: unknown; generation?: unknown } | null;
      active.workspaceId = typeof request?.workspaceId === 'string' ? request.workspaceId : null;
      active.generation = Number.isSafeInteger(request?.generation)
        ? (request?.generation as number)
        : null;
    }
    return await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        active.pending.delete(requestId);
        reject(new Error('OnlyPreview search utility request timed out.'));
      }, timeoutMs);
      active.pending.set(requestId, { resolve, reject, timeout });
      try {
        active.child.postMessage({
          type: ONLY_PREVIEW_SEARCH_UTILITY_REQUEST_MESSAGE,
          requestId,
          method,
          params,
          ...(bootstrap ? { bootstrap } : {})
        } satisfies OnlyPreviewSearchUtilityRequestMessage);
      } catch (error) {
        clearTimeout(timeout);
        active.pending.delete(requestId);
        reject(error instanceof Error ? error : utilityStoppedError());
      }
    });
  }

  detach(): void {
    const active = this.active;
    if (!active) return;
    this.active = null;
    this._removeListeners(active);
    this._rejectPending(active);
  }

  searchTokenForHost(hostToken: string): string {
    const active = this.active;
    if (!active) throw utilityStoppedError();
    if (active.hostToken !== hostToken) {
      throw new OnlyPreviewContractError(
        'HOST_ROLE_DENIED',
        'OnlyPreview search request does not belong to the active utility process.'
      );
    }
    return active.searchToken;
  }

  private _handleMessage(active: ActiveUtility, message: unknown): void {
    if (this.active !== active) return;
    const utilityEvent = message as OnlyPreviewSearchUtilityEventMessage | undefined;
    if (utilityEvent?.type === ONLY_PREVIEW_SEARCH_UTILITY_EVENT_MESSAGE) {
      this._handleEvent(active, utilityEvent);
      return;
    }
    const response = message as OnlyPreviewSearchUtilityResponseMessage | undefined;
    if (
      response?.type !== ONLY_PREVIEW_SEARCH_UTILITY_RESPONSE_MESSAGE ||
      typeof response.requestId !== 'string'
    ) {
      return;
    }
    const pending = active.pending.get(response.requestId);
    if (!pending) return;
    active.pending.delete(response.requestId);
    clearTimeout(pending.timeout);
    pending.resolve(response.result);
  }

  private _handleEvent(active: ActiveUtility, message: OnlyPreviewSearchUtilityEventMessage): void {
    const eventShape = {
      [ONLY_PREVIEW_SEARCH_BATCH_EVENT]: 'batch',
      [ONLY_PREVIEW_SEARCH_SNAPSHOT_EVENT]: 'snapshot',
      [ONLY_PREVIEW_SEARCH_WATCH_COMMIT_EVENT]: 'commit'
    } as const;
    const property = eventShape[message.eventName as keyof typeof eventShape];
    if (!property || !message.value || typeof message.value !== 'object') return;
    const envelope = message.value as Record<string, unknown>;
    if (Object.keys(envelope).length !== 1) return;
    const value = envelope[property] as Record<string, unknown> | undefined;
    if (
      !value ||
      typeof value !== 'object' ||
      value.workspaceId !== active.workspaceId ||
      value.generation !== active.generation
    ) {
      return;
    }
    if (
      (property === 'snapshot' &&
        (Object.keys(value).sort().join(',') !== 'generation,index,memory,state,workspaceId' ||
          !['building', 'reconciling', 'ready'].includes(String(value.state)) ||
          !this._isIndexSnapshot(value.index, active.workspaceId) ||
          !value.memory ||
          typeof value.memory !== 'object')) ||
      (property === 'batch' &&
        (typeof value.requestId !== 'string' || !Array.isArray(value.results))) ||
      (property === 'commit' &&
        (!Number.isSafeInteger(value.revision) ||
          typeof value.full !== 'boolean' ||
          !Array.isArray(value.changedRelativePaths)))
    ) {
      return;
    }
    active.broadcast(message.eventName, {
      hostId: active.hostId,
      [property]: value
    });
  }

  private _isIndexSnapshot(value: unknown, workspaceId: string | null): boolean {
    if (!value || typeof value !== 'object') return false;
    const index = value as Record<string, unknown>;
    return (
      Object.keys(index).sort().join(',') === 'entries,limit,truncated,workspaceId' &&
      index.workspaceId === workspaceId &&
      Array.isArray(index.entries) &&
      typeof index.truncated === 'boolean' &&
      Number.isSafeInteger(index.limit)
    );
  }

  private _handleUnexpectedExit(active: ActiveUtility): void {
    if (this.active !== active) return;
    this.active = null;
    this._removeListeners(active);
    this._rejectPending(active);
    active.onUnexpectedExit();
  }

  private _removeListeners(active: ActiveUtility): void {
    active.child.off('message', active.onMessage);
    active.child.off('exit', active.onExit);
    active.child.off('error', active.onError);
  }

  private _rejectPending(active: ActiveUtility): void {
    const error = utilityStoppedError();
    for (const pending of active.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    active.pending.clear();
  }
}

export const onlyPreviewSearchUtilityRpcService = new OnlyPreviewSearchUtilityRpcService();
