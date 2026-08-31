import type { FileSearchRuntimeMethod } from '@shared/onlypreview/fileSearchRuntime.types';

export interface FileSearchPendingExpectation {
  method: FileSearchRuntimeMethod;
  workspaceId: string | null;
  generation: number | null;
  requestId: string | null;
  directoryToken: string | null;
  resultToken: string | null;
  readGrant: string | null;
  offset: number | null;
  maxResults: number | null;
}

export interface FileSearchPendingCall {
  expectation: FileSearchPendingExpectation;
}

export interface FileSearchRetiredRequest {
  workspaceId: string;
  generation: number;
  requestId: string;
  maxResults: number;
}

export const FILE_SEARCH_MAX_RETIRED_REQUESTS = 256;

export class FileSearchRetiredRequestRegistry {
  private readonly entries = new Map<string, FileSearchRetiredRequest>();

  clear(): void {
    this.entries.clear();
  }

  forget(requestId: string): void {
    this.entries.delete(requestId);
  }

  findPending(
    pending: Iterable<FileSearchPendingCall>,
    workspaceId: string,
    generation: number,
    requestId: string
  ): FileSearchPendingExpectation | null {
    return (
      [...pending]
        .reverse()
        .find(
          ({ expectation }) =>
            expectation.method === 'search' &&
            expectation.workspaceId === workspaceId &&
            expectation.generation === generation &&
            expectation.requestId === requestId
        )?.expectation ?? null
    );
  }

  retireCancelled(
    pending: Iterable<FileSearchPendingCall>,
    workspaceId: string | null,
    generation: number | null,
    requestId: string | null
  ): void {
    if (workspaceId === null || generation === null || requestId === null) return;
    const search = this.findPending(pending, workspaceId, generation, requestId);
    if (search) this.rememberExpectation(search);
  }

  retireSuperseded(
    pending: Iterable<FileSearchPendingCall>,
    workspaceId: string | null,
    generation: number | null,
    activeRequestId: string | null
  ): void {
    if (workspaceId === null || generation === null) return;
    for (const { expectation } of pending) {
      if (
        expectation.method === 'search' &&
        expectation.workspaceId === workspaceId &&
        expectation.generation === generation &&
        expectation.requestId !== activeRequestId
      ) {
        this.rememberExpectation(expectation);
      }
    }
  }

  retireSettled(
    search: FileSearchPendingExpectation,
    pending: Iterable<FileSearchPendingCall>
  ): void {
    if (
      search.workspaceId === null ||
      search.generation === null ||
      search.requestId === null ||
      this.findPending(pending, search.workspaceId, search.generation, search.requestId)
    ) {
      return;
    }
    this.rememberExpectation(search);
  }

  remember(request: FileSearchRetiredRequest): void {
    this.entries.delete(request.requestId);
    this.entries.set(request.requestId, request);
    if (this.entries.size <= FILE_SEARCH_MAX_RETIRED_REQUESTS) return;
    const oldestRequestId = this.entries.keys().next().value;
    if (oldestRequestId !== undefined) this.entries.delete(oldestRequestId);
  }

  find(
    workspaceId: string,
    generation: number,
    requestId: string
  ): FileSearchRetiredRequest | null {
    const request = this.entries.get(requestId);
    return request?.workspaceId === workspaceId && request.generation === generation
      ? request
      : null;
  }

  private rememberExpectation(search: FileSearchPendingExpectation): void {
    if (
      search.workspaceId === null ||
      search.generation === null ||
      search.requestId === null ||
      search.maxResults === null
    ) {
      return;
    }
    this.remember({
      workspaceId: search.workspaceId,
      generation: search.generation,
      requestId: search.requestId,
      maxResults: search.maxResults
    });
  }
}
