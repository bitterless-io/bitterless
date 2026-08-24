import {
  OnlyPreviewOoxmlPreflightError,
  preflightOnlyPreviewOoxml
} from '../onlyPreviewOoxmlPreflight.service';
import type {
  OnlyPreviewDocumentWorkerErrorCode,
  OnlyPreviewDocumentWorkerRequest,
  OnlyPreviewDocumentWorkerResponse
} from './onlyPreviewDocumentWorker.contract';

interface DocumentWorkerScope {
  postMessage(message: OnlyPreviewDocumentWorkerResponse, transfer?: Transferable[]): void;
  addEventListener(
    type: 'message',
    listener: (event: { data: OnlyPreviewDocumentWorkerRequest }) => void
  ): void;
}

const scope = globalThis as unknown as DocumentWorkerScope;
let accepted = false;

const errorCodeFor = (error: unknown): OnlyPreviewDocumentWorkerErrorCode => {
  if (error instanceof OnlyPreviewOoxmlPreflightError) {
    return error.code === 'OOXML_PREFLIGHT_TIMEOUT' ? 'DOCUMENT_RENDER_TIMEOUT' : error.code;
  }
  return 'DOCUMENT_PARSE_FAILED';
};

const respond = (
  request: OnlyPreviewDocumentWorkerRequest,
  response:
    | { type: 'preflight-ready'; bytes: ArrayBuffer }
    | { type: 'error'; errorCode: OnlyPreviewDocumentWorkerErrorCode }
): void => {
  const message = {
    hostId: request.hostId,
    runtimeId: request.runtimeId,
    selectionRevision: request.selectionRevision,
    workerGeneration: request.workerGeneration,
    requestId: request.requestId,
    ...response
  } as OnlyPreviewDocumentWorkerResponse;
  scope.postMessage(message, response.type === 'preflight-ready' ? [response.bytes] : undefined);
};

scope.addEventListener('message', (event) => {
  const request = event.data;
  if (accepted) return;
  accepted = true;
  void preflightOnlyPreviewOoxml(request.bytes, 'docx')
    .then(() => respond(request, { type: 'preflight-ready', bytes: request.bytes }))
    .catch((error) => respond(request, { type: 'error', errorCode: errorCodeFor(error) }));
});
