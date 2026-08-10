import {
  ONLY_PREVIEW_SEARCH_UTILITY_REQUEST_MESSAGE,
  ONLY_PREVIEW_SEARCH_UTILITY_READY_MESSAGE,
  ONLY_PREVIEW_SEARCH_UTILITY_RESPONSE_MESSAGE,
  ONLY_PREVIEW_SEARCH_UTILITY_EVENT_MESSAGE,
  type OnlyPreviewSearchUtilityRequestMessage,
  type OnlyPreviewSearchUtilityReadyMessage
} from '@shared/onlypreview/onlyPreviewSearchUtility.types';
import { OnlyPreviewSearchRuntimeUtility } from './onlyPreviewSearchRuntime.utility';

const requireArgument = (name: string): string => {
  const prefix = `--${name}=`;
  const value = process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
  if (!value || value.length > 512 || value.includes('\0')) {
    throw new Error(`OnlyPreview search utility requires ${name}.`);
  }
  return value;
};

const hostToken = requireArgument('onlypreview-host-token');
const instanceId = requireArgument('onlypreview-search-instance');
const runtime = new OnlyPreviewSearchRuntimeUtility({
  hostToken,
  emit: (eventName, value) => {
    process.parentPort?.postMessage({
      type: ONLY_PREVIEW_SEARCH_UTILITY_EVENT_MESSAGE,
      eventName,
      value
    });
  }
});

process.parentPort?.on('message', (event) => {
  const request = event.data as OnlyPreviewSearchUtilityRequestMessage | undefined;
  if (
    request?.type !== ONLY_PREVIEW_SEARCH_UTILITY_REQUEST_MESSAGE ||
    typeof request.requestId !== 'string' ||
    !['initialize', 'refresh', 'browseDirectory', 'search', 'cancel', 'shutdown'].includes(
      request.method
    )
  ) {
    return;
  }
  const operation =
    request.method === 'initialize'
      ? runtime.initialize(request.params as never, request.bootstrap)
      : runtime[request.method](request.params as never);
  void operation.then((result) => {
    process.parentPort?.postMessage({
      type: ONLY_PREVIEW_SEARCH_UTILITY_RESPONSE_MESSAGE,
      requestId: request.requestId,
      result
    });
  });
});

setImmediate(() => {
  process.parentPort?.postMessage({
    type: ONLY_PREVIEW_SEARCH_UTILITY_READY_MESSAGE,
    instanceId
  } satisfies OnlyPreviewSearchUtilityReadyMessage);
});

process.once('exit', () => {
  void runtime.dispose();
});
