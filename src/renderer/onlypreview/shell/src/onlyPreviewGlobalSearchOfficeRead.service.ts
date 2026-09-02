import {
  OnlyPreviewContractError,
  unwrapOnlyPreviewResult
} from '@shared/onlypreview/onlyPreview.contract';
import {
  ONLY_PREVIEW_OFFICE_READ_CHUNK_BYTES,
  ONLY_PREVIEW_OFFICE_READ_MAX_BYTES
} from '@shared/onlypreview/onlyPreviewOfficeReadRuntime.types';
import type { OnlyPreviewGlobalSearchPreview } from '@shared/onlypreview/onlyPreviewSearch.type';
import { onlyPreviewEnv } from '../../common/contextBridge/onlyPreviewEnv.bridge';
import { onlyPreviewSearchClient } from './onlyPreviewSearch.client';

type OfficePreview = Extract<OnlyPreviewGlobalSearchPreview, { kind: 'office' }>;

const matchesOfficePreview = (
  value: {
    workspaceId: string;
    generation: number;
    requestId: string;
    resultToken: string;
    readGrant: string;
  },
  preview: OfficePreview
): boolean =>
  value.workspaceId === preview.workspaceId &&
  value.generation === preview.generation &&
  value.requestId === preview.requestId &&
  value.resultToken === preview.resultToken &&
  value.readGrant === preview.readGrant;

export class OnlyPreviewGlobalSearchOfficeReadSession {
  private cancelled = false;
  private started = false;
  private completed = false;

  constructor(private readonly preview: OfficePreview) {}

  async readBytes(): Promise<ArrayBuffer> {
    if (this.started) {
      throw new OnlyPreviewContractError('INVALID_INPUT', 'Search Office read is single-use.');
    }
    this.started = true;
    const hostToken = onlyPreviewEnv.hostToken;
    if (!hostToken) {
      throw new OnlyPreviewContractError('HOST_NOT_FOUND', 'Search host is unavailable.');
    }

    try {
      this.requireActive();
      const opened = unwrapOnlyPreviewResult(
        await onlyPreviewSearchClient.openOfficeRead({
          hostToken,
          workspaceId: this.preview.workspaceId,
          generation: this.preview.generation,
          requestId: this.preview.requestId,
          resultToken: this.preview.resultToken,
          readGrant: this.preview.readGrant
        })
      );
      this.requireActive();
      if (
        !matchesOfficePreview(opened, this.preview) ||
        !Number.isSafeInteger(opened.totalBytes) ||
        opened.totalBytes !== this.preview.size ||
        opened.totalBytes <= 0 ||
        opened.totalBytes > ONLY_PREVIEW_OFFICE_READ_MAX_BYTES
      ) {
        throw new OnlyPreviewContractError(
          'INVALID_INPUT',
          'Search Office read metadata is invalid.'
        );
      }

      const output = new Uint8Array(opened.totalBytes);
      let offset = 0;
      while (offset < output.byteLength) {
        this.requireActive();
        const chunk = unwrapOnlyPreviewResult(
          await onlyPreviewSearchClient.readOfficeChunk({
            hostToken,
            workspaceId: this.preview.workspaceId,
            generation: this.preview.generation,
            requestId: this.preview.requestId,
            resultToken: this.preview.resultToken,
            readGrant: this.preview.readGrant,
            offset
          })
        );
        this.requireActive();
        if (
          !matchesOfficePreview(chunk, this.preview) ||
          chunk.offset !== offset ||
          !(chunk.bytes instanceof ArrayBuffer) ||
          chunk.bytes.byteLength <= 0 ||
          chunk.bytes.byteLength > ONLY_PREVIEW_OFFICE_READ_CHUNK_BYTES ||
          offset + chunk.bytes.byteLength > output.byteLength
        ) {
          throw new OnlyPreviewContractError(
            'INVALID_INPUT',
            'Search Office read frame is invalid.'
          );
        }
        output.set(new Uint8Array(chunk.bytes), offset);
        offset += chunk.bytes.byteLength;
        if (chunk.eof !== (offset === output.byteLength)) {
          throw new OnlyPreviewContractError(
            'INVALID_INPUT',
            'Search Office read ended at an invalid offset.'
          );
        }
      }
      this.completed = true;
      return output.buffer;
    } finally {
      if (!this.completed) void this.cancel();
    }
  }

  async cancel(): Promise<void> {
    if (this.cancelled) return;
    this.cancelled = true;
    const hostToken = onlyPreviewEnv.hostToken;
    if (!hostToken) return;
    try {
      unwrapOnlyPreviewResult(
        await onlyPreviewSearchClient.cancelOfficeRead({
          hostToken,
          workspaceId: this.preview.workspaceId,
          generation: this.preview.generation,
          requestId: this.preview.requestId,
          resultToken: this.preview.resultToken,
          readGrant: this.preview.readGrant
        })
      );
    } catch {
      // Cancellation is best effort after EOF or a newer Search selection revokes the grant.
    }
  }

  private requireActive(): void {
    if (this.cancelled) {
      throw new OnlyPreviewContractError('OPERATION_FAILED', 'Search Office read was superseded.');
    }
  }
}
