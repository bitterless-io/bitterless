import { OnlyPreviewContractError } from '@shared/onlypreview/onlyPreview.contract';

export interface OnlyPreviewImageRender {
  src: string;
}

/**
 * Images render straight from the revision-bound asset URL, the way audio and video already do.
 *
 * The previous path fetched the asset, buffered it into a `Blob`, and handed the component an
 * object URL. That put a CORS check in front of every image: the preview page is a `file://`
 * document, so any error response the Main handler returned — a revoked token, a cancelled read, a
 * changed source length — failed the check and reached the renderer as a bare fetch rejection with
 * no status. Every distinct cause collapsed into one reason, and the file was read into memory
 * twice on the way.
 *
 * `<img src>` performs no CORS check, so the element's `error` event now means what it says, and
 * the bytes are decoded once, in the image decoder, instead of being copied through a blob first.
 * The byte-count guarantee is unaffected: the Main handler already refuses to serve a source whose
 * length changed, which is the authoritative check.
 */
export const createOnlyPreviewImageRender = (
  assetUrl: string,
  expectedSize: number,
  mimeType: string
): OnlyPreviewImageRender => {
  if (
    !assetUrl ||
    !Number.isSafeInteger(expectedSize) ||
    expectedSize < 0 ||
    typeof mimeType !== 'string' ||
    !mimeType.startsWith('image/')
  ) {
    throw new OnlyPreviewContractError('INVALID_INPUT', 'Image preview input is invalid.');
  }
  if (expectedSize === 0) {
    throw new OnlyPreviewContractError('IMAGE_EMPTY', 'The selected image is empty.');
  }
  return { src: assetUrl };
};
