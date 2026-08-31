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
        lifetime:
          adapter.adapterId === 'audio' || adapter.adapterId === 'video' ? 'selection' : 'ttl'
      })
    };
    assetIssued = true;
  }
  return { descriptor, navigationUrl, assetIssued };
};
