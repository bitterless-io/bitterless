import type { OnlyPreviewOfficeReadBridgeApi } from '@shared/onlypreview/onlyPreviewOfficeReadRuntime.types';

interface OnlyPreviewOfficeReadWindow {
  readonly onlyPreviewOfficeRead: OnlyPreviewOfficeReadBridgeApi;
}

export const onlyPreviewOfficeRead = (window as unknown as OnlyPreviewOfficeReadWindow)
  .onlyPreviewOfficeRead;
