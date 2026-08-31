import 'electron-xpc/preload';
import { contextBridge } from 'electron';
import { createXpcPreloadEmitter } from 'electron-xpc/preload';
import {
  OnlyPreviewContractError,
  onlyPreviewFailure,
  onlyPreviewSuccess,
  unwrapOnlyPreviewResult
} from '../../shared/onlypreview/onlyPreview.contract';
import {
  ONLY_PREVIEW_OFFICE_READ_CHUNK_BYTES,
  ONLY_PREVIEW_OFFICE_READ_MAX_BYTES,
  type OnlyPreviewOfficeReadBridgeApi,
  type OnlyPreviewOfficeReadBrokerApi
} from '../../shared/onlypreview/onlyPreviewOfficeReadRuntime.types';
import {
  ONLY_PREVIEW_READ_CHUNK_BYTES,
  type OnlyPreviewPreviewTextBridgeApi,
  type OnlyPreviewPreviewTextBrokerApi
} from '../../shared/onlypreview/onlyPreviewPreviewReadRuntime.types';
import {
  ONLY_PREVIEW_MAX_TEXT_BYTES,
  type OnlyPreviewTextEncoding
} from '../../shared/onlypreview/onlyPreview.types';
import { exposeOnlyPreviewEnv } from './onlyPreviewEnv.preload';

const env = exposeOnlyPreviewEnv();

const startsWithBytes = (buffer: Uint8Array, expected: readonly number[]): boolean =>
  buffer.length >= expected.length && expected.every((byte, index) => buffer[index] === byte);

const decodePreviewText = (
  buffer: Uint8Array
): { text: string; encoding: OnlyPreviewTextEncoding } => {
  if (startsWithBytes(buffer, [0xff, 0xfe])) {
    return {
      text: new TextDecoder('utf-16le').decode(buffer.subarray(2)),
      encoding: 'utf-16le'
    };
  }
  if (startsWithBytes(buffer, [0xfe, 0xff])) {
    return {
      text: new TextDecoder('utf-16be').decode(buffer.subarray(2)),
      encoding: 'utf-16be'
    };
  }
  const payload = startsWithBytes(buffer, [0xef, 0xbb, 0xbf]) ? buffer.subarray(3) : buffer;
  return { text: new TextDecoder('utf-8').decode(payload), encoding: 'utf-8' };
};

if (env.mode === 'preview' && env.hostToken && env.previewRuntimeToken) {
  const officeBrokerCapability = process.argv
    .find((value) => value.startsWith('--onlypreview-office-broker-capability='))
    ?.slice('--onlypreview-office-broker-capability='.length);
  const previewReadBrokerCapability = process.argv
    .find((value) => value.startsWith('--onlypreview-read-broker-capability='))
    ?.slice('--onlypreview-read-broker-capability='.length);
  if (!officeBrokerCapability) throw new Error('Office read broker is unavailable.');
  if (
    !previewReadBrokerCapability ||
    previewReadBrokerCapability === officeBrokerCapability
  ) {
    throw new Error('Preview Read broker is unavailable.');
  }
  const broker = createXpcPreloadEmitter<OnlyPreviewOfficeReadBrokerApi>('OnlyPreviewHandler');
  const bridge: OnlyPreviewOfficeReadBridgeApi = Object.freeze({
    async readCurrentOfficeBytes(request) {
      let grantId: string | null = null;
      let selectionRevision: number | null = null;
      try {
        if (!Number.isSafeInteger(request?.selectionRevision) || request.selectionRevision < 0) {
          throw new OnlyPreviewContractError('INVALID_INPUT', 'Office read request is invalid.');
        }
        selectionRevision = request.selectionRevision;
        const identity = {
          brokerCapability: officeBrokerCapability,
          hostToken: env.hostToken!,
          previewRuntimeToken: env.previewRuntimeToken!,
          selectionRevision: request.selectionRevision
        };
        const opened = unwrapOnlyPreviewResult(await broker.openCurrentOfficeRead(identity));
        grantId = opened.grantId;
        if (
          typeof opened.grantId !== 'string' ||
          opened.runtimeId !== env.previewRuntimeToken ||
          opened.selectionRevision !== request.selectionRevision ||
          !Number.isSafeInteger(opened.totalBytes) ||
          opened.totalBytes < 0 ||
          opened.totalBytes > ONLY_PREVIEW_OFFICE_READ_MAX_BYTES
        ) {
          throw new OnlyPreviewContractError('INVALID_INPUT', 'Office read response is invalid.');
        }
        const bytes = new Uint8Array(opened.totalBytes);
        let offset = 0;
        let eof = false;
        while (!eof) {
          const chunk = unwrapOnlyPreviewResult(
            await broker.readCurrentOfficeChunk({ ...identity, grantId, offset })
          );
          if (
            chunk.grantId !== grantId ||
            chunk.runtimeId !== env.previewRuntimeToken ||
            chunk.selectionRevision !== request.selectionRevision ||
            chunk.offset !== offset ||
            !(chunk.bytes instanceof ArrayBuffer) ||
            typeof chunk.eof !== 'boolean' ||
            chunk.bytes.byteLength > ONLY_PREVIEW_OFFICE_READ_CHUNK_BYTES ||
            offset + chunk.bytes.byteLength > bytes.byteLength ||
            (!chunk.eof && chunk.bytes.byteLength === 0) ||
            chunk.eof !== (offset + chunk.bytes.byteLength === bytes.byteLength)
          ) {
            throw new OnlyPreviewContractError('INVALID_INPUT', 'Office read chunk is invalid.');
          }
          bytes.set(new Uint8Array(chunk.bytes), offset);
          offset += chunk.bytes.byteLength;
          eof = chunk.eof;
        }
        if (offset !== bytes.byteLength) {
          throw new OnlyPreviewContractError('INVALID_INPUT', 'Office read length is invalid.');
        }
        grantId = null;
        return onlyPreviewSuccess({
          selectionRevision: request.selectionRevision,
          bytes: bytes.buffer
        });
      } catch (error) {
        const code = error instanceof OnlyPreviewContractError ? error.code : 'OPERATION_FAILED';
        return onlyPreviewFailure(
          new OnlyPreviewContractError(code, 'The Office file could not be read safely.')
        );
      } finally {
        if (grantId && selectionRevision !== null) {
          await broker
            .cancelCurrentOfficeRead({
              brokerCapability: officeBrokerCapability,
              hostToken: env.hostToken!,
              previewRuntimeToken: env.previewRuntimeToken!,
              selectionRevision,
              grantId
            })
            .catch(() => undefined);
        }
      }
    }
  });
  contextBridge.exposeInMainWorld('onlyPreviewOfficeRead', bridge);

  const previewBroker =
    createXpcPreloadEmitter<OnlyPreviewPreviewTextBrokerApi>('OnlyPreviewHandler');
  const previewBridge: OnlyPreviewPreviewTextBridgeApi = Object.freeze({
    async readCurrentText(request) {
      let grantId: string | null = null;
      let sessionId: string | null = null;
      let selectionRevision: number | null = null;
      try {
        if (!Number.isSafeInteger(request?.selectionRevision) || request.selectionRevision < 0) {
          throw new OnlyPreviewContractError('INVALID_INPUT', 'Preview text request is invalid.');
        }
        selectionRevision = request.selectionRevision;
        const identity = {
          brokerCapability: previewReadBrokerCapability,
          hostToken: env.hostToken!,
          previewRuntimeToken: env.previewRuntimeToken!,
          selectionRevision
        };
        const opened = unwrapOnlyPreviewResult(
          await previewBroker.openCurrentPreviewText(identity)
        );
        grantId = opened.grantId;
        sessionId = opened.sessionId;
        if (
          typeof opened.runtimeInstanceId !== 'string' ||
          !opened.runtimeInstanceId ||
          typeof opened.grantId !== 'string' ||
          !opened.grantId ||
          typeof opened.sessionId !== 'string' ||
          !opened.sessionId ||
          opened.selectionRevision !== selectionRevision ||
          typeof opened.workspaceId !== 'string' ||
          !opened.workspaceId ||
          typeof opened.relativePath !== 'string' ||
          !opened.relativePath ||
          opened.method !== 'GET' ||
          opened.start !== 0 ||
          !Number.isSafeInteger(opened.totalBytes) ||
          opened.totalBytes < 0 ||
          opened.totalBytes > ONLY_PREVIEW_MAX_TEXT_BYTES ||
          opened.end !== (opened.totalBytes === 0 ? -1 : opened.totalBytes - 1) ||
          opened.eof !== (opened.totalBytes === 0)
        ) {
          throw new OnlyPreviewContractError('INVALID_INPUT', 'Preview text response is invalid.');
        }
        const bytes = new Uint8Array(opened.totalBytes);
        let offset = 0;
        let eof = opened.eof;
        while (!eof) {
          const chunk = unwrapOnlyPreviewResult(
            await previewBroker.readCurrentPreviewTextChunk({
              ...identity,
              grantId,
              sessionId,
              offset
            })
          );
          if (
            chunk.runtimeInstanceId !== opened.runtimeInstanceId ||
            chunk.grantId !== grantId ||
            chunk.sessionId !== sessionId ||
            chunk.selectionRevision !== selectionRevision ||
            chunk.offset !== offset ||
            !(chunk.bytes instanceof ArrayBuffer) ||
            typeof chunk.eof !== 'boolean' ||
            chunk.bytes.byteLength > ONLY_PREVIEW_READ_CHUNK_BYTES ||
            offset + chunk.bytes.byteLength > bytes.byteLength ||
            (!chunk.eof && chunk.bytes.byteLength === 0) ||
            chunk.eof !== (offset + chunk.bytes.byteLength === bytes.byteLength)
          ) {
            throw new OnlyPreviewContractError('INVALID_INPUT', 'Preview text chunk is invalid.');
          }
          bytes.set(new Uint8Array(chunk.bytes), offset);
          offset += chunk.bytes.byteLength;
          eof = chunk.eof;
        }
        if (offset !== bytes.byteLength) {
          throw new OnlyPreviewContractError('INVALID_INPUT', 'Preview text length is invalid.');
        }
        const decoded = decodePreviewText(bytes);
        sessionId = null;
        return onlyPreviewSuccess({
          workspaceId: opened.workspaceId,
          relativePath: opened.relativePath,
          text: decoded.text,
          encoding: decoded.encoding,
          size: bytes.byteLength
        });
      } catch (error) {
        const code = error instanceof OnlyPreviewContractError ? error.code : 'OPERATION_FAILED';
        return onlyPreviewFailure(
          new OnlyPreviewContractError(code, 'The text file could not be read safely.')
        );
      } finally {
        if (grantId && sessionId && selectionRevision !== null) {
          await previewBroker
            .cancelCurrentPreviewText({
              brokerCapability: previewReadBrokerCapability,
              hostToken: env.hostToken!,
              previewRuntimeToken: env.previewRuntimeToken!,
              selectionRevision,
              grantId,
              sessionId
            })
            .catch(() => undefined);
        }
      }
    }
  });
  contextBridge.exposeInMainWorld('onlyPreviewPreviewRead', previewBridge);
}
