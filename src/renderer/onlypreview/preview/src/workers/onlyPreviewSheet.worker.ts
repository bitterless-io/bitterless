import {
  buildOnlyPreviewSheetModel,
  type OnlyPreviewSheetModel
} from '../onlyPreviewSheetModel.service';
import {
  OnlyPreviewOoxmlPreflightError,
  preflightOnlyPreviewOoxml
} from '../onlyPreviewOoxmlPreflight.service';
import type {
  OnlyPreviewSheetWorkerIdentity,
  OnlyPreviewSheetWorkerRequest,
  OnlyPreviewSheetWorkerResponse
} from './onlyPreviewSheetWorker.contract';

interface SheetWorkerScope {
  postMessage(message: OnlyPreviewSheetWorkerResponse): void;
  addEventListener(
    type: 'message',
    listener: (event: { data: OnlyPreviewSheetWorkerRequest }) => void
  ): void;
}

interface ExcelJsWorkbookConstructor {
  new (): {
    xlsx: { load(bytes: Uint8Array): Promise<unknown> };
    worksheets?: unknown;
    properties?: unknown;
  };
}

const scope = globalThis as unknown as SheetWorkerScope;
let identity: OnlyPreviewSheetWorkerIdentity | null = null;
let model: OnlyPreviewSheetModel | null = null;

type SheetWorkerResponsePayload<T = OnlyPreviewSheetWorkerResponse> =
  T extends OnlyPreviewSheetWorkerResponse
    ? Omit<T, keyof OnlyPreviewSheetWorkerIdentity | 'requestId'>
    : never;

const sameIdentity = (
  request: OnlyPreviewSheetWorkerIdentity,
  expected: OnlyPreviewSheetWorkerIdentity | null = identity
): boolean =>
  Boolean(
    expected &&
    request.hostId === expected.hostId &&
    request.runtimeId === expected.runtimeId &&
    request.selectionRevision === expected.selectionRevision &&
    request.workerGeneration === expected.workerGeneration
  );

const respond = (
  request: OnlyPreviewSheetWorkerRequest,
  response: SheetWorkerResponsePayload
): void => {
  scope.postMessage({
    hostId: request.hostId,
    runtimeId: request.runtimeId,
    selectionRevision: request.selectionRevision,
    workerGeneration: request.workerGeneration,
    requestId: request.requestId,
    ...response
  } as OnlyPreviewSheetWorkerResponse);
};

const errorCodeFor = (
  error: unknown
): Extract<OnlyPreviewSheetWorkerResponse, { type: 'error' }>['errorCode'] => {
  if (error instanceof OnlyPreviewOoxmlPreflightError) {
    return error.code === 'OOXML_PREFLIGHT_TIMEOUT' ? 'SHEET_RENDER_TIMEOUT' : error.code;
  }
  if (error instanceof Error && error.message === 'SHEET_EMPTY') return 'SHEET_EMPTY';
  return 'SHEET_PARSE_FAILED';
};

const loadWorkbook = async (request: Extract<OnlyPreviewSheetWorkerRequest, { type: 'load' }>) => {
  if (identity) return;
  identity = {
    hostId: request.hostId,
    runtimeId: request.runtimeId,
    selectionRevision: request.selectionRevision,
    workerGeneration: request.workerGeneration
  };
  try {
    await preflightOnlyPreviewOoxml(request.bytes, 'xlsx');
    respond(request, { type: 'preflight-ready' });
    const excelJsModule = await import('exceljs');
    if (!sameIdentity(request)) return;
    const excelJs = ((excelJsModule as unknown as { default?: unknown }).default ??
      excelJsModule) as { Workbook?: ExcelJsWorkbookConstructor };
    if (typeof excelJs.Workbook !== 'function') throw new Error('ExcelJS Workbook is unavailable.');
    const workbook = new excelJs.Workbook();
    await workbook.xlsx.load(new Uint8Array(request.bytes));
    if (!sameIdentity(request)) return;
    model = buildOnlyPreviewSheetModel(workbook);
    respond(request, { type: 'loaded', manifest: model.manifest });
  } catch (error) {
    if (sameIdentity(request)) respond(request, { type: 'error', errorCode: errorCodeFor(error) });
  }
};

const handleRequest = async (request: OnlyPreviewSheetWorkerRequest): Promise<void> => {
  if (request.type === 'load') {
    await loadWorkbook(request);
    return;
  }
  if (!sameIdentity(request) || !model) return;
  try {
    if (request.type === 'layout') {
      respond(request, { type: 'layout', layout: model.getLayout(request.sheetId) });
      return;
    }
    if (request.type === 'viewport') {
      respond(request, {
        type: 'viewport',
        viewport: model.getViewport(
          request.sheetId,
          request.rowStart,
          request.rowEnd,
          request.columnStart,
          request.columnEnd
        )
      });
      return;
    }
    respond(request, {
      type: 'search',
      result: model.search(request.operation, {
        query: request.query,
        caseSensitive: request.caseSensitive,
        ordinal: request.ordinal
      })
    });
  } catch {
    respond(request, { type: 'error', errorCode: 'SHEET_PARSE_FAILED' });
  }
};

scope.addEventListener('message', (event) => {
  void handleRequest(event.data);
});
