import { OnlyPreviewContractError } from '@shared/onlypreview/onlyPreview.contract';

export const ONLY_PREVIEW_IMAGE_MIN_SCALE = 0.1;
export const ONLY_PREVIEW_IMAGE_MAX_SCALE = 8;
export const ONLY_PREVIEW_IMAGE_ZOOM_FACTOR = 1.25;
export const ONLY_PREVIEW_IMAGE_KEYBOARD_PAN_PX = 32;

export type OnlyPreviewImageRotation = 0 | 90 | 180 | 270;

export interface OnlyPreviewImageDimensions {
  naturalWidth: number;
  naturalHeight: number;
  viewportWidth: number;
  viewportHeight: number;
}

export interface OnlyPreviewImageViewportState {
  mode: 'fit' | 'manual';
  rotation: OnlyPreviewImageRotation;
  scale: number;
  offsetX: number;
  offsetY: number;
}

export interface OnlyPreviewImagePanBounds {
  maxX: number;
  maxY: number;
}

export interface OnlyPreviewImageEffectiveDimensions {
  width: number;
  height: number;
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

const assertRotation: (rotation: number) => asserts rotation is OnlyPreviewImageRotation = (
  rotation
) => {
  if (rotation !== 0 && rotation !== 90 && rotation !== 180 && rotation !== 270) {
    throw new OnlyPreviewContractError('INVALID_INPUT', 'Image rotation is invalid.');
  }
};

export const getOnlyPreviewImageEffectiveDimensions = (
  dimensions: OnlyPreviewImageDimensions,
  rotation: OnlyPreviewImageRotation
): OnlyPreviewImageEffectiveDimensions => {
  assertDimensions(dimensions);
  assertRotation(rotation);
  return rotation === 90 || rotation === 270
    ? { width: dimensions.naturalHeight, height: dimensions.naturalWidth }
    : { width: dimensions.naturalWidth, height: dimensions.naturalHeight };
};

const getUnboundedFitScale = (
  dimensions: OnlyPreviewImageDimensions,
  rotation: OnlyPreviewImageRotation
): number => {
  const effective = getOnlyPreviewImageEffectiveDimensions(dimensions, rotation);
  if (dimensions.viewportWidth === 0 || dimensions.viewportHeight === 0) return 1;
  return Math.min(
    1,
    dimensions.viewportWidth / effective.width,
    dimensions.viewportHeight / effective.height
  );
};

export const getOnlyPreviewImageFitScale = (
  dimensions: OnlyPreviewImageDimensions,
  rotation: OnlyPreviewImageRotation = 0
): number => getUnboundedFitScale(dimensions, rotation);

export const getOnlyPreviewImageMinimumScale = (
  dimensions: OnlyPreviewImageDimensions,
  rotation: OnlyPreviewImageRotation = 0
): number => Math.min(ONLY_PREVIEW_IMAGE_MIN_SCALE, getUnboundedFitScale(dimensions, rotation));

const clampScaleForDimensions = (
  scale: number,
  dimensions: OnlyPreviewImageDimensions,
  rotation: OnlyPreviewImageRotation
): number => {
  if (!Number.isFinite(scale)) {
    throw new OnlyPreviewContractError('INVALID_INPUT', 'Image scale is invalid.');
  }
  return Math.min(
    ONLY_PREVIEW_IMAGE_MAX_SCALE,
    Math.max(getOnlyPreviewImageMinimumScale(dimensions, rotation), scale)
  );
};

export const getOnlyPreviewImagePanBounds = (
  dimensions: OnlyPreviewImageDimensions,
  scale: number,
  rotation: OnlyPreviewImageRotation = 0
): OnlyPreviewImagePanBounds => {
  assertDimensions(dimensions);
  const safeScale = clampScaleForDimensions(scale, dimensions, rotation);
  const effective = getOnlyPreviewImageEffectiveDimensions(dimensions, rotation);
  return {
    maxX: Math.max(0, (effective.width * safeScale - dimensions.viewportWidth) / 2),
    maxY: Math.max(0, (effective.height * safeScale - dimensions.viewportHeight) / 2)
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
  assertRotation(state.rotation);
  const scale = clampScaleForDimensions(state.scale, dimensions, state.rotation);
  const bounds = getOnlyPreviewImagePanBounds(dimensions, scale, state.rotation);
  return {
    mode: state.mode,
    rotation: state.rotation,
    scale,
    offsetX: clampAxis(state.offsetX, bounds.maxX),
    offsetY: clampAxis(state.offsetY, bounds.maxY)
  };
};

export const fitOnlyPreviewImageViewport = (
  dimensions: OnlyPreviewImageDimensions,
  rotation: OnlyPreviewImageRotation = 0
): OnlyPreviewImageViewportState => ({
  mode: 'fit',
  rotation,
  scale: getOnlyPreviewImageFitScale(dimensions, rotation),
  offsetX: 0,
  offsetY: 0
});

export const resetOnlyPreviewImageViewport = (
  dimensions: OnlyPreviewImageDimensions
): OnlyPreviewImageViewportState =>
  clampOnlyPreviewImageViewport(
    { mode: 'manual', rotation: 0, scale: 1, offsetX: 0, offsetY: 0 },
    dimensions
  );

export const rotateOnlyPreviewImageViewport = (
  state: OnlyPreviewImageViewportState,
  direction: 'left' | 'right',
  dimensions: OnlyPreviewImageDimensions
): OnlyPreviewImageViewportState => {
  assertRotation(state.rotation);
  const delta = direction === 'right' ? 90 : 270;
  const rotation = ((state.rotation + delta) % 360) as OnlyPreviewImageRotation;
  return state.mode === 'fit'
    ? fitOnlyPreviewImageViewport(dimensions, rotation)
    : clampOnlyPreviewImageViewport({ ...state, rotation }, dimensions);
};

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
    ? fitOnlyPreviewImageViewport(dimensions, state.rotation)
    : clampOnlyPreviewImageViewport(state, dimensions);
