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

// The media preflight and the image loader share exactly one check — an equality against
// `content-length` — and both were rejecting valid files, which is what identifies that header as
// the common cause. `Number(null)` is 0, so an absent header could never equal a non-empty file.
// Range support stays required: seeking genuinely depends on it, and the reason token says so if it
// is ever the blocker.
type MediaReadReason =
  | 'head-rejected'
  | 'stale-before-headers'
  | 'response-not-ok'
  | 'content-length-mismatch'
  | 'ranges-unsupported'
  | 'stale-after-headers';

const mediaReadFailure = (reason: MediaReadReason, message: string): OnlyPreviewContractError => {
  console.warn(`[onlypreview] event=media-read-failed reason=${reason}`);
  return new OnlyPreviewContractError('MEDIA_READ_FAILED', message);
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
      throw mediaReadFailure('head-rejected', 'The media stream is unavailable.');
    }
    if (!this.isCurrent(generation)) {
      throw mediaReadFailure('stale-before-headers', 'The media load is no longer current.');
    }
    if (!response.ok || response.status !== 200) {
      throw mediaReadFailure('response-not-ok', 'The media stream did not match the selected file.');
    }
    const declaredLength = response.headers.get('content-length');
    const contentLength = declaredLength === null ? null : Number(declaredLength);
    if (
      contentLength !== null &&
      (!Number.isSafeInteger(contentLength) || contentLength !== expectedSize)
    ) {
      throw mediaReadFailure(
        'content-length-mismatch',
        'The media stream did not match the selected file.'
      );
    }
    if (response.headers.get('accept-ranges')?.toLowerCase() !== 'bytes') {
      throw mediaReadFailure(
        'ranges-unsupported',
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
