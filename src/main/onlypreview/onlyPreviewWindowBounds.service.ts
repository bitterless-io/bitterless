import type { OnlyPreviewBounds } from '@shared/onlypreview/onlyPreview.types';

export interface OnlyPreviewSettingsBoundsRequest {
  parentBounds: OnlyPreviewBounds;
  workArea: OnlyPreviewBounds;
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
}

export const resolveOnlyPreviewSettingsBounds = (
  request: OnlyPreviewSettingsBoundsRequest
): OnlyPreviewBounds => {
  const { parentBounds, workArea, minWidth, minHeight } = request;
  const width = Math.max(
    minWidth,
    Math.min(Math.round(request.width), Math.max(workArea.width, minWidth))
  );
  const height = Math.max(
    minHeight,
    Math.min(Math.round(request.height), Math.max(workArea.height, minHeight))
  );
  const maxX = workArea.x + Math.max(0, workArea.width - width);
  const maxY = workArea.y + Math.max(0, workArea.height - height);
  const centeredX = Math.round(parentBounds.x + (parentBounds.width - width) / 2);
  const centeredY = Math.round(parentBounds.y + (parentBounds.height - height) / 2);
  return {
    x: Math.min(maxX, Math.max(workArea.x, centeredX)),
    y: Math.min(maxY, Math.max(workArea.y, centeredY)),
    width,
    height
  };
};
