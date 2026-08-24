import { OnlyPreviewContractError } from '@shared/onlypreview/onlyPreview.contract';

export const ONLY_PREVIEW_IMAGE_MIN_SCALE = 0.1;
export const ONLY_PREVIEW_IMAGE_MAX_SCALE = 8;
export const ONLY_PREVIEW_IMAGE_ZOOM_FACTOR = 1.25;
export const ONLY_PREVIEW_IMAGE_KEYBOARD_PAN_PX = 32;

export interface OnlyPreviewImageDimensions {
  naturalWidth: number;
  naturalHeight: number;
  viewportWidth: number;
  viewportHeight: number;
}

export interface OnlyPreviewImageViewportState {
  mode: 'fit' | 'manual';
  scale: number;
  offsetX: number;
  offsetY: number;
}

export interface OnlyPreviewImagePanBounds {
  maxX: number;
  maxY: number;
}

const assertDimensions = (dimensions: OnlyPreviewImageDimensions): void => {
  const values = [
    dimensions.naturalWidth,
    dimensions.naturalHeight,
    dimensions.viewportWidth,
    dimensions.viewportHeight
  ];
  if (
    values.some((value) => !Number.isFinite(value)) ||
    dimensions.naturalWidth <= 0 ||
    dimensions.naturalHeight <= 0 ||
    dimensions.viewportWidth < 0 ||
    dimensions.viewportHeight < 0
  ) {
    throw new OnlyPreviewContractError('INVALID_INPUT', 'Image viewport dimensions are invalid.');
  }
};

export const clampOnlyPreviewImageScale = (scale: number): number => {
  if (!Number.isFinite(scale)) {
    throw new OnlyPreviewContractError('INVALID_INPUT', 'Image scale is invalid.');
  }
  return Math.min(ONLY_PREVIEW_IMAGE_MAX_SCALE, Math.max(ONLY_PREVIEW_IMAGE_MIN_SCALE, scale));
};

const getUnboundedFitScale = (dimensions: OnlyPreviewImageDimensions): number => {
  assertDimensions(dimensions);
  if (dimensions.viewportWidth === 0 || dimensions.viewportHeight === 0) return 1;
  return Math.min(
    1,
    dimensions.viewportWidth / dimensions.naturalWidth,
    dimensions.viewportHeight / dimensions.naturalHeight
  );
};

export const getOnlyPreviewImageFitScale = (dimensions: OnlyPreviewImageDimensions): number =>
  getUnboundedFitScale(dimensions);

export const getOnlyPreviewImageMinimumScale = (dimensions: OnlyPreviewImageDimensions): number =>
  Math.min(ONLY_PREVIEW_IMAGE_MIN_SCALE, getUnboundedFitScale(dimensions));

const clampScaleForDimensions = (scale: number, dimensions: OnlyPreviewImageDimensions): number => {
  if (!Number.isFinite(scale)) {
    throw new OnlyPreviewContractError('INVALID_INPUT', 'Image scale is invalid.');
  }
  return Math.min(
    ONLY_PREVIEW_IMAGE_MAX_SCALE,
    Math.max(getOnlyPreviewImageMinimumScale(dimensions), scale)
  );
};

export const getOnlyPreviewImagePanBounds = (
  dimensions: OnlyPreviewImageDimensions,
  scale: number
): OnlyPreviewImagePanBounds => {
  assertDimensions(dimensions);
  const safeScale = clampScaleForDimensions(scale, dimensions);
  return {
    maxX: Math.max(0, (dimensions.naturalWidth * safeScale - dimensions.viewportWidth) / 2),
    maxY: Math.max(0, (dimensions.naturalHeight * safeScale - dimensions.viewportHeight) / 2)
  };
};

const clampAxis = (value: number, maximum: number): number => {
  if (!Number.isFinite(value)) {
    throw new OnlyPreviewContractError('INVALID_INPUT', 'Image translation is invalid.');
  }
  return Math.min(maximum, Math.max(-maximum, value));
};

export const clampOnlyPreviewImageViewport = (
  state: OnlyPreviewImageViewportState,
  dimensions: OnlyPreviewImageDimensions
): OnlyPreviewImageViewportState => {
  const scale = clampScaleForDimensions(state.scale, dimensions);
  const bounds = getOnlyPreviewImagePanBounds(dimensions, scale);
  return {
    mode: state.mode,
    scale,
    offsetX: clampAxis(state.offsetX, bounds.maxX),
    offsetY: clampAxis(state.offsetY, bounds.maxY)
  };
};

export const fitOnlyPreviewImageViewport = (
  dimensions: OnlyPreviewImageDimensions
): OnlyPreviewImageViewportState => ({
  mode: 'fit',
  scale: getOnlyPreviewImageFitScale(dimensions),
  offsetX: 0,
  offsetY: 0
});

export const resetOnlyPreviewImageViewport = (
  dimensions: OnlyPreviewImageDimensions
): OnlyPreviewImageViewportState =>
  clampOnlyPreviewImageViewport({ mode: 'manual', scale: 1, offsetX: 0, offsetY: 0 }, dimensions);

export const zoomOnlyPreviewImageViewport = (
  state: OnlyPreviewImageViewportState,
  direction: 'in' | 'out',
  dimensions: OnlyPreviewImageDimensions
): OnlyPreviewImageViewportState =>
  clampOnlyPreviewImageViewport(
    {
      ...state,
      mode: 'manual',
      scale:
        direction === 'in'
          ? state.scale * ONLY_PREVIEW_IMAGE_ZOOM_FACTOR
          : state.scale / ONLY_PREVIEW_IMAGE_ZOOM_FACTOR
    },
    dimensions
  );

export const panOnlyPreviewImageViewport = (
  state: OnlyPreviewImageViewportState,
  deltaX: number,
  deltaY: number,
  dimensions: OnlyPreviewImageDimensions
): OnlyPreviewImageViewportState =>
  clampOnlyPreviewImageViewport(
    {
      ...state,
      offsetX: state.offsetX + deltaX,
      offsetY: state.offsetY + deltaY
    },
    dimensions
  );

export const resizeOnlyPreviewImageViewport = (
  state: OnlyPreviewImageViewportState,
  dimensions: OnlyPreviewImageDimensions
): OnlyPreviewImageViewportState =>
  state.mode === 'fit'
    ? fitOnlyPreviewImageViewport(dimensions)
    : clampOnlyPreviewImageViewport(state, dimensions);
