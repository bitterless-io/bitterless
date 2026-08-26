import {
  OnlyPreviewDrawioPreflightError,
  preflightOnlyPreviewDrawio
} from '../onlyPreviewDrawioPreflight.service';
import type {
  OnlyPreviewDrawioWorkerErrorCode,
  OnlyPreviewDrawioWorkerRequest,
  OnlyPreviewDrawioWorkerResponse
} from './onlyPreviewDrawioWorker.contract';

interface DrawioWorkerScope {
  postMessage(message: OnlyPreviewDrawioWorkerResponse, transfer?: Transferable[]): void;
  addEventListener(
    type: 'message',
    listener: (event: { data: OnlyPreviewDrawioWorkerRequest }) => void
  ): void;
}

const scope = globalThis as unknown as DrawioWorkerScope;
let accepted = false;

const errorCodeFor = (error: unknown): OnlyPreviewDrawioWorkerErrorCode =>
  error instanceof OnlyPreviewDrawioPreflightError ? error.code : 'DIAGRAM_PARSE_FAILED';

const respond = (
  request: OnlyPreviewDrawioWorkerRequest,
  response:
    | { type: 'preflight-ready'; bytes: ArrayBuffer; pageCount: number; cellCount: number }
    | { type: 'error'; errorCode: OnlyPreviewDrawioWorkerErrorCode }
): void => {
  const message = {
    hostId: request.hostId,
    runtimeId: request.runtimeId,
    selectionRevision: request.selectionRevision,
    workerGeneration: request.workerGeneration,
    requestId: request.requestId,
    ...response
  } as OnlyPreviewDrawioWorkerResponse;
  scope.postMessage(message, response.type === 'preflight-ready' ? [response.bytes] : undefined);
};

scope.addEventListener('message', (event) => {
  const request = event.data;
  if (accepted) return;
  accepted = true;
  void preflightOnlyPreviewDrawio(request.bytes)
    .then((result) =>
      respond(request, {
        type: 'preflight-ready',
        bytes: request.bytes,
        pageCount: result.pageCount,
        cellCount: result.cellCount
      })
    )
    .catch((error) => respond(request, { type: 'error', errorCode: errorCodeFor(error) }));
});
