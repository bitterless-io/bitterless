/// <reference lib="webworker" />

import {
  OnlyPreviewOoxmlPreflightError,
  preflightOnlyPreviewOoxml
} from '../onlyPreviewOoxmlPreflight.service';
import type {
  OnlyPreviewOfficePreflightRequest,
  OnlyPreviewOfficePreflightResponse
} from './onlyPreviewOfficePreflight.contract';

const workerScope = self as DedicatedWorkerGlobalScope;

const post = (
  response: OnlyPreviewOfficePreflightResponse,
  transfer: Transferable[] = []
): void => {
  workerScope.postMessage(response, transfer);
};

workerScope.onmessage = async (event: MessageEvent<OnlyPreviewOfficePreflightRequest>) => {
  const request = event.data;
  if (!request || request.type !== 'preflight' || !(request.bytes instanceof ArrayBuffer)) return;
  const identity = {
    runtimeId: request.runtimeId,
    selectionRevision: request.selectionRevision,
    requestId: request.requestId
  };
  try {
    await preflightOnlyPreviewOoxml(request.bytes, request.kind);
    post({ ...identity, type: 'ready', bytes: request.bytes }, [request.bytes]);
  } catch (error) {
    const errorCode =
      error instanceof OnlyPreviewOoxmlPreflightError
        ? error.code
        : ('OOXML_ARCHIVE_INVALID' as const);
    post({ ...identity, type: 'error', errorCode });
  }
};
