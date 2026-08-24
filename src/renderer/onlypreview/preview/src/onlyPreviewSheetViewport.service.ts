import type { OnlyPreviewSheetDimension } from './workers/onlyPreviewSheetWorker.contract';

export interface OnlyPreviewSheetAxis {
  count: number;
  offsets: Float64Array;
}

export interface OnlyPreviewSheetVirtualRange {
  start: number;
  end: number;
}

export const createOnlyPreviewSheetAxis = (
  count: number,
  defaultSize: number,
  overrides: OnlyPreviewSheetDimension[]
): OnlyPreviewSheetAxis => {
  const boundedCount = Math.max(1, Math.floor(count));
  const sizes = new Float64Array(boundedCount + 1);
  sizes.fill(defaultSize);
  for (const override of overrides) {
    if (
      Number.isSafeInteger(override.index) &&
      override.index >= 1 &&
      override.index <= boundedCount &&
      Number.isFinite(override.size) &&
      override.size > 0
    ) {
      sizes[override.index] = override.size;
    }
  }
  const offsets = new Float64Array(boundedCount + 1);
  for (let index = 1; index <= boundedCount; index += 1) {
    offsets[index] = offsets[index - 1] + sizes[index];
  }
  return { count: boundedCount, offsets };
};

export const getOnlyPreviewSheetAxisOffset = (axis: OnlyPreviewSheetAxis, index: number): number =>
  axis.offsets[Math.max(0, Math.min(axis.count, Math.floor(index) - 1))];

export const getOnlyPreviewSheetAxisSize = (axis: OnlyPreviewSheetAxis, index: number): number => {
  const bounded = Math.max(1, Math.min(axis.count, Math.floor(index)));
  return axis.offsets[bounded] - axis.offsets[bounded - 1];
};

export const findOnlyPreviewSheetAxisIndex = (
  axis: OnlyPreviewSheetAxis,
  offset: number
): number => {
  const boundedOffset = Math.max(0, Math.min(axis.offsets[axis.count], offset));
  let low = 0;
  let high = axis.count;
  while (low < high) {
    const middle = Math.floor((low + high + 1) / 2);
    if (axis.offsets[middle] <= boundedOffset) low = middle;
    else high = middle - 1;
  }
  return Math.min(axis.count, low + 1);
};

export const getOnlyPreviewSheetVirtualRange = (
  axis: OnlyPreviewSheetAxis,
  offset: number,
  viewportSize: number,
  overscan: number
): OnlyPreviewSheetVirtualRange => {
  const visibleStart = findOnlyPreviewSheetAxisIndex(axis, offset);
  const visibleEnd = findOnlyPreviewSheetAxisIndex(axis, offset + Math.max(0, viewportSize));
  return {
    start: Math.max(1, visibleStart - Math.max(0, Math.floor(overscan))),
    end: Math.min(axis.count, visibleEnd + Math.max(0, Math.floor(overscan)))
  };
};

export const getOnlyPreviewSheetSpanSize = (
  axis: OnlyPreviewSheetAxis,
  start: number,
  end: number
): number => {
  const first = Math.max(1, Math.min(axis.count, Math.floor(start)));
  const last = Math.max(first, Math.min(axis.count, Math.floor(end)));
  return axis.offsets[last] - axis.offsets[first - 1];
};
