import { onlyPreviewAssetRegistry } from '@main/onlypreview/onlyPreviewAsset.registry';
import { onlyPreviewDocumentRegistry } from '@main/onlypreview/onlyPreviewDocument.registry';
import {
  getOnlyPreviewFileSizeLimit,
  type OnlyPreviewDescriptor
} from '@shared/onlypreview/onlyPreview.types';
import type { OnlyPreviewPreviewReadPreparedSelection } from '@shared/onlypreview/onlyPreviewPreviewReadRuntime.types';
import type { getOnlyPreviewDescriptorAdapter } from './onlyPreviewPreviewAdapter.service';

export interface OnlyPreviewSelectionDelivery {
  descriptor: OnlyPreviewDescriptor;
  navigationUrl: string | null;
  assetIssued: boolean;
}

export const issueOnlyPreviewSelectionDelivery = (params: {
  hostToken: string;
  selectionRevision: number;
  prepared: OnlyPreviewPreviewReadPreparedSelection;
  adapter: ReturnType<typeof getOnlyPreviewDescriptorAdapter>;
}): OnlyPreviewSelectionDelivery => {
  const { adapter, hostToken, prepared, selectionRevision } = params;
  let descriptor = prepared.descriptor;
  let navigationUrl: string | null = null;
  let assetIssued = false;
  if (adapter.adapterId === 'html-page') {
    navigationUrl = onlyPreviewDocumentRegistry.issue(hostToken, prepared, selectionRevision);
    descriptor = { ...descriptor, assetUrl: navigationUrl };
  } else if (adapter.adapterId === 'chromium-pdf') {
    const maxBytes = getOnlyPreviewFileSizeLimit(adapter.adapterId);
    navigationUrl = onlyPreviewAssetRegistry.issue(hostToken, prepared, descriptor.mimeType, {
      selectionRevision,
      maxBytes: Math.min(descriptor.size, maxBytes ?? descriptor.size)
    });
    assetIssued = true;
    descriptor = { ...descriptor, assetUrl: navigationUrl };
  } else if (adapter.adapterId === 'drawio-viewer') {
    const maxBytes = getOnlyPreviewFileSizeLimit(adapter.adapterId);
    descriptor = {
      ...descriptor,
      assetUrl: onlyPreviewAssetRegistry.issue(hostToken, prepared, descriptor.mimeType, {
        selectionRevision,
        maxBytes: Math.min(descriptor.size, maxBytes ?? descriptor.size)
      })
    };
    assetIssued = true;
  } else if (
    adapter.adapterId === 'image' ||
    adapter.adapterId === 'audio' ||
    adapter.adapterId === 'video'
  ) {
    const adapterLimit = getOnlyPreviewFileSizeLimit(adapter.adapterId);
    descriptor = {
      ...descriptor,
      assetUrl: onlyPreviewAssetRegistry.issue(hostToken, prepared, descriptor.mimeType, {
        selectionRevision,
        maxBytes: Math.min(descriptor.size, adapterLimit ?? descriptor.size),
        // The element owns the request for all three: `<img>`, `<audio>` and `<video>` fetch the
        // asset themselves and may re-request it on a re-attach or a re-mount. A `ttl` token that
        // the one-shot revoke retired on ready made the second request 404.
        lifetime: 'selection'
      })
    };
    assetIssued = true;
  }
  return { descriptor, navigationUrl, assetIssued };
};
