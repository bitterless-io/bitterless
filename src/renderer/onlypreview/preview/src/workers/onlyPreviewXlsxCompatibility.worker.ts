/// <reference lib="webworker" />

import type {
  OnlyPreviewXlsxCompatibilityRequest,
  OnlyPreviewXlsxCompatibilityResponse
} from './onlyPreviewXlsxCompatibility.contract';
import {
  ONLY_PREVIEW_XLSX_COMPATIBILITY_MAX_INPUT_BYTES,
  ONLY_PREVIEW_XLSX_COMPATIBILITY_MAX_OUTPUT_BYTES
} from './onlyPreviewXlsxCompatibility.contract';

interface ExcelJsWorkbookConstructor {
  new (): {
    xlsx: {
      load(bytes: Uint8Array): Promise<unknown>;
      writeBuffer(): Promise<unknown>;
    };
  };
}

const workerScope = self as DedicatedWorkerGlobalScope;

const post = (
  response: OnlyPreviewXlsxCompatibilityResponse,
  transfer: Transferable[] = []
): void => {
  workerScope.postMessage(response, transfer);
};

const exactArrayBuffer = (value: unknown): ArrayBuffer | null => {
  if (value instanceof ArrayBuffer) return value;
  if (!ArrayBuffer.isView(value)) return null;
  const view = value as ArrayBufferView;
  if (
    view.buffer instanceof ArrayBuffer &&
    view.byteOffset === 0 &&
    view.byteLength === view.buffer.byteLength
  ) {
    return view.buffer;
  }
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength).slice().buffer;
};

workerScope.onmessage = async (event: MessageEvent<OnlyPreviewXlsxCompatibilityRequest>) => {
  const request = event.data;
  if (!request || request.type !== 'normalize' || !(request.bytes instanceof ArrayBuffer)) return;
  const identity = {
    runtimeId: request.runtimeId,
    selectionRevision: request.selectionRevision,
    requestId: request.requestId
  };
  try {
    if (request.bytes.byteLength > ONLY_PREVIEW_XLSX_COMPATIBILITY_MAX_INPUT_BYTES) {
      post({ ...identity, type: 'error', errorCode: 'OOXML_ARCHIVE_LIMIT' });
      return;
    }
    const excelJsModule = await import('exceljs');
    const excelJs = ((excelJsModule as unknown as { default?: unknown }).default ??
      excelJsModule) as { Workbook?: ExcelJsWorkbookConstructor };
    if (typeof excelJs.Workbook !== 'function') throw new Error('ExcelJS Workbook is unavailable.');
    const workbook = new excelJs.Workbook();
    await workbook.xlsx.load(new Uint8Array(request.bytes));
    const normalized = exactArrayBuffer(await workbook.xlsx.writeBuffer());
    if (!normalized) throw new Error('ExcelJS returned an invalid workbook buffer.');
    if (normalized.byteLength > ONLY_PREVIEW_XLSX_COMPATIBILITY_MAX_OUTPUT_BYTES) {
      post({ ...identity, type: 'error', errorCode: 'OOXML_ARCHIVE_LIMIT' });
      return;
    }
    post({ ...identity, type: 'ready', bytes: normalized }, [normalized]);
  } catch {
    post({ ...identity, type: 'error', errorCode: 'SHEET_PARSE_FAILED' });
  }
};
