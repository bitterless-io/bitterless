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
import type {
  OnlyPreviewBrowseDirectoryRequest,
  OnlyPreviewSearchCancelRequest,
  OnlyPreviewSearchInitializeRequest,
  OnlyPreviewSearchRequest,
  OnlyPreviewSearchShutdownRequest
} from '@shared/onlypreview/onlyPreviewSearch.type';
import { FileSearchRuntime as FileSearchRuntimeCore } from './fileSearchRuntime';

const CAPABILITY_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const INSTANCE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const argumentValue = (name: string): string => {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) ?? '';
};

const runtimeCapability = argumentValue('file-search-capability');
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

  async browseDirectory(params: FileSearchRuntimeRequest<OnlyPreviewBrowseDirectoryRequest>) {
    const value = requireRuntimeRequest<OnlyPreviewBrowseDirectoryRequest>(params);
    return await runtime.browseDirectory(value.request);
  }

  async search(params: FileSearchRuntimeRequest<OnlyPreviewSearchRequest>) {
    const value = requireRuntimeRequest<OnlyPreviewSearchRequest>(params);
    return await runtime.search(value.request);
  }

  async cancel(params: FileSearchRuntimeRequest<OnlyPreviewSearchCancelRequest>) {
    const value = requireRuntimeRequest<OnlyPreviewSearchCancelRequest>(params);
    return await runtime.cancel(value.request);
  }

  async shutdown(params: FileSearchRuntimeRequest<OnlyPreviewSearchShutdownRequest>) {
    const value = requireRuntimeRequest<OnlyPreviewSearchShutdownRequest>(params);
    return await runtime.shutdown(value.request);
  }
}

export let fileSearchRuntime: FileSearchRuntime | null = null;

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
};

registerFileSearchRuntime();
if (!fileSearchRuntime) {
  globalThis.addEventListener?.('DOMContentLoaded', registerFileSearchRuntime, { once: true });
}

globalThis.addEventListener?.('unload', () => {
  void runtime.dispose();
});
