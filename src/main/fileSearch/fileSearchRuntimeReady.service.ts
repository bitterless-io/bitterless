import type { FileSearchRuntimePrivateApi } from '@shared/onlypreview/fileSearchRuntime.types';

const FILE_SEARCH_READY_TIMEOUT_MS = 10_000;
const FILE_SEARCH_REGISTRATION_RETRY_MS = 10;

export const waitForFileSearchRuntimeReady = async (params: {
  runtimeClient: Pick<FileSearchRuntimePrivateApi, 'ready'>;
  capability: string;
  instanceId: string;
  stopped: Promise<void>;
  timeoutMs?: number;
}): Promise<void> => {
  const timeoutMs = params.timeoutMs ?? FILE_SEARCH_READY_TIMEOUT_MS;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(
      () => reject(new Error('File-search preload readiness timed out.')),
      timeoutMs
    );
  });
  const stopped = params.stopped.then(() => {
    throw new Error('File-search renderer stopped during startup.');
  });
  try {
    while (true) {
      const result = await Promise.race([
        params.runtimeClient.ready({
          capability: params.capability,
          instanceId: params.instanceId
        }),
        stopped,
        timedOut
      ]);
      if (result == null) {
        await Promise.race([
          new Promise<void>((resolveRetry) =>
            setTimeout(resolveRetry, FILE_SEARCH_REGISTRATION_RETRY_MS)
          ),
          stopped,
          timedOut
        ]);
        continue;
      }
      if (!result.ok) {
        throw new Error(result.error || 'File-search preload did not become ready.');
      }
      return;
    }
  } finally {
    if (timeout) clearTimeout(timeout);
  }
};
