import type { OnlyPreviewPreviewTextBridgeApi } from '@shared/onlypreview/onlyPreviewPreviewReadRuntime.types';

interface OnlyPreviewPreviewReadWindow {
  readonly onlyPreviewPreviewRead: OnlyPreviewPreviewTextBridgeApi;
}

export const onlyPreviewPreviewRead = (window as unknown as OnlyPreviewPreviewReadWindow)
  .onlyPreviewPreviewRead;
