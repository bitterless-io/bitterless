import { OnlyPreviewContractError } from '@shared/onlypreview/onlyPreview.contract';

export interface OnlyPreviewImageRender {
  objectUrl: string;
  naturalWidth: number;
  naturalHeight: number;
}

interface OnlyPreviewImageSessionOptions {
  fetchImpl?: typeof fetch;
  createImage?: () => HTMLImageElement;
  createObjectUrl?: (blob: Blob) => string;
  revokeObjectUrl?: (url: string) => void;
}

export class OnlyPreviewImageSession {
  private readonly fetchImpl: typeof fetch;
  private readonly createImage: () => HTMLImageElement;
  private readonly createObjectUrl: (blob: Blob) => string;
  private readonly revokeObjectUrl: (url: string) => void;
  private abortController: AbortController | null = null;
  private objectUrl: string | null = null;
  private generation = 0;

  constructor(options: OnlyPreviewImageSessionOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.createImage = options.createImage ?? (() => new Image());
    this.createObjectUrl = options.createObjectUrl ?? ((blob) => URL.createObjectURL(blob));
    this.revokeObjectUrl = options.revokeObjectUrl ?? ((url) => URL.revokeObjectURL(url));
  }

  async load(
    assetUrl: string,
    expectedSize: number,
    mimeType: string
  ): Promise<OnlyPreviewImageRender> {
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
    this.dispose();
    const generation = ++this.generation;
    const abortController = new AbortController();
    this.abortController = abortController;
    let response: Response;
    try {
      response = await this.fetchImpl(assetUrl, { signal: abortController.signal });
    } catch (error) {
      if (!this.isCurrent(generation)) throw error;
      throw new OnlyPreviewContractError(
        'IMAGE_READ_FAILED',
        'The image stream could not be read.'
      );
    }
    if (!this.isCurrent(generation)) {
      throw new OnlyPreviewContractError(
        'IMAGE_READ_FAILED',
        'The image load is no longer current.'
      );
    }
    const contentLength = Number(response.headers.get('content-length'));
    if (!response.ok || response.status !== 200 || contentLength !== expectedSize) {
      throw new OnlyPreviewContractError(
        'IMAGE_READ_FAILED',
        'The image stream did not match the selected file.'
      );
    }
    let blob: Blob;
    try {
      blob = await response.blob();
    } catch {
      throw new OnlyPreviewContractError('IMAGE_READ_FAILED', 'The image stream ended early.');
    }
    if (!this.isCurrent(generation) || blob.size !== expectedSize) {
      throw new OnlyPreviewContractError(
        'IMAGE_READ_FAILED',
        'The image stream did not contain the expected bytes.'
      );
    }
    const typedBlob = blob.type === mimeType ? blob : new Blob([blob], { type: mimeType });
    const objectUrl = this.createObjectUrl(typedBlob);
    this.objectUrl = objectUrl;
    let image: HTMLImageElement;
    try {
      image = this.createImage();
      image.decoding = 'async';
      image.src = objectUrl;
      await image.decode();
    } catch {
      if (!this.isCurrent(generation)) {
        throw new OnlyPreviewContractError(
          'IMAGE_READ_FAILED',
          'The image load is no longer current.'
        );
      }
      this.revokeCurrentObjectUrl();
      throw new OnlyPreviewContractError('IMAGE_DECODE_FAILED', 'The image could not be decoded.');
    }
    if (!this.isCurrent(generation)) {
      throw new OnlyPreviewContractError(
        'IMAGE_READ_FAILED',
        'The image load is no longer current.'
      );
    }
    if (image.naturalWidth <= 0 || image.naturalHeight <= 0) {
      this.revokeCurrentObjectUrl();
      throw new OnlyPreviewContractError(
        'IMAGE_DECODE_FAILED',
        'The image has no decodable frame.'
      );
    }
    const render = {
      objectUrl,
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight
    };
    image.removeAttribute('src');
    return render;
  }

  dispose(): void {
    this.generation += 1;
    this.abortController?.abort();
    this.abortController = null;
    this.revokeCurrentObjectUrl();
  }

  private isCurrent(generation: number): boolean {
    return generation === this.generation && this.abortController !== null;
  }

  private revokeCurrentObjectUrl(): void {
    const objectUrl = this.objectUrl;
    if (!objectUrl) return;
    this.objectUrl = null;
    this.revokeObjectUrl(objectUrl);
  }
}
