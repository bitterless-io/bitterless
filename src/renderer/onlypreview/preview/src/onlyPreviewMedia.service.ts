import { OnlyPreviewContractError } from '@shared/onlypreview/onlyPreview.contract';
import type { OnlyPreviewErrorCode } from '@shared/onlypreview/onlyPreview.types';

interface OnlyPreviewMediaSessionOptions {
  fetchImpl?: typeof fetch;
}

export const ONLY_PREVIEW_MEDIA_METADATA_TIMEOUT_MS = 30_000;

export const mapOnlyPreviewMediaErrorCode = (
  code: number | null | undefined
): OnlyPreviewErrorCode => {
  if (code === 1) return 'MEDIA_ABORTED';
  if (code === 2) return 'MEDIA_NETWORK_FAILED';
  if (code === 3) return 'MEDIA_DECODE_FAILED';
  if (code === 4) return 'MEDIA_SOURCE_UNSUPPORTED';
  return 'MEDIA_READ_FAILED';
};

export class OnlyPreviewMediaSession {
  private readonly fetchImpl: typeof fetch;
  private abortController: AbortController | null = null;
  private generation = 0;

  constructor(options: OnlyPreviewMediaSessionOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async prepare(assetUrl: string, expectedSize: number): Promise<void> {
    if (!assetUrl || !Number.isSafeInteger(expectedSize) || expectedSize < 0) {
      throw new OnlyPreviewContractError('INVALID_INPUT', 'Media preview input is invalid.');
    }
    if (expectedSize === 0) {
      throw new OnlyPreviewContractError('MEDIA_EMPTY', 'The selected media file is empty.');
    }
    this.dispose();
    const generation = ++this.generation;
    const abortController = new AbortController();
    this.abortController = abortController;
    let response: Response;
    try {
      response = await this.fetchImpl(assetUrl, {
        method: 'HEAD',
        signal: abortController.signal
      });
    } catch (error) {
      if (!this.isCurrent(generation)) throw error;
      throw new OnlyPreviewContractError('MEDIA_READ_FAILED', 'The media stream is unavailable.');
    }
    if (!this.isCurrent(generation)) {
      throw new OnlyPreviewContractError(
        'MEDIA_READ_FAILED',
        'The media load is no longer current.'
      );
    }
    const contentLength = Number(response.headers.get('content-length'));
    if (
      !response.ok ||
      response.status !== 200 ||
      contentLength !== expectedSize ||
      response.headers.get('accept-ranges')?.toLowerCase() !== 'bytes'
    ) {
      throw new OnlyPreviewContractError(
        'MEDIA_READ_FAILED',
        'The media stream did not match the selected file.'
      );
    }
  }

  dispose(): void {
    this.generation += 1;
    this.abortController?.abort();
    this.abortController = null;
  }

  private isCurrent(generation: number): boolean {
    return generation === this.generation && this.abortController !== null;
  }
}
