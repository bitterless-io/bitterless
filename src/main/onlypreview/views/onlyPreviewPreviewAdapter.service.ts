import type {
  OnlyPreviewDescriptor,
  OnlyPreviewErrorCode,
  OnlyPreviewPreviewAdapterId,
  OnlyPreviewPreviewPresentation,
  OnlyPreviewPreviewSurface
} from '@shared/onlypreview/onlyPreview.types';

export const ONLY_PREVIEW_DOCUMENT_REBUILD_ERRORS: ReadonlySet<OnlyPreviewErrorCode> = new Set([
  'DOCUMENT_PARSE_FAILED',
  'DOCUMENT_RENDER_FAILED',
  'DOCUMENT_SANITIZE_FAILED',
  'DOCUMENT_RENDER_TIMEOUT'
]);

export const ONLY_PREVIEW_SHEET_REBUILD_ERRORS: ReadonlySet<OnlyPreviewErrorCode> = new Set([
  'SHEET_PARSE_FAILED',
  'SHEET_RENDER_FAILED',
  'SHEET_EMPTY',
  'SHEET_RENDER_TIMEOUT'
]);

export const ONLY_PREVIEW_PRESENTATION_REBUILD_ERRORS: ReadonlySet<OnlyPreviewErrorCode> = new Set([
  'PRESENTATION_PARSE_FAILED',
  'PRESENTATION_RENDER_FAILED',
  'PRESENTATION_EMPTY',
  'PRESENTATION_RENDER_TIMEOUT'
]);

export const ONLY_PREVIEW_DIAGRAM_REBUILD_ERRORS: ReadonlySet<OnlyPreviewErrorCode> = new Set([
  'DIAGRAM_PARSE_FAILED',
  'DIAGRAM_LIMIT',
  'DIAGRAM_RENDER_TIMEOUT'
]);

export const createEmptyOnlyPreviewPresentation = (
  hostId: string,
  selectionRevision: number
): OnlyPreviewPreviewPresentation => ({
  hostId,
  workspaceId: null,
  selectionRevision,
  surface: 'vue',
  adapterId: 'unsupported',
  status: 'empty',
  fileRef: null,
  descriptor: null,
  error: null,
  selectedTextAvailable: false,
  // Placeholder only. `snapshotInternal` overrides it on the way out, so a cleared presentation
  // cannot erase the Project's index state.
  projectIndexState: null
});

export const getOnlyPreviewDescriptorAdapter = (
  descriptor: OnlyPreviewDescriptor
): { surface: OnlyPreviewPreviewSurface; adapterId: OnlyPreviewPreviewAdapterId } => {
  if (descriptor.previewError) return { surface: 'vue', adapterId: 'unsupported' };
  if (descriptor.extension === '.html' || descriptor.extension === '.htm') {
    return { surface: 'chrome', adapterId: 'html-page' };
  }
  if (descriptor.kind === 'pdf') return { surface: 'chrome', adapterId: 'chromium-pdf' };
  if (descriptor.kind === 'text') {
    return descriptor.extension === '.md'
      ? { surface: 'vue', adapterId: 'markdown-dom' }
      : { surface: 'vue', adapterId: 'monaco' };
  }
  if (descriptor.kind === 'sheet') return { surface: 'vue', adapterId: 'ooxml-xlsx' };
  if (descriptor.kind === 'document') return { surface: 'vue', adapterId: 'ooxml-docx' };
  if (descriptor.kind === 'presentation') return { surface: 'vue', adapterId: 'ooxml-pptx' };
  if (descriptor.kind === 'diagram') return { surface: 'vue', adapterId: 'drawio-viewer' };
  if (descriptor.kind === 'image') return { surface: 'vue', adapterId: 'image' };
  if (descriptor.kind === 'audio') return { surface: 'vue', adapterId: 'audio' };
  if (descriptor.kind === 'video') return { surface: 'vue', adapterId: 'video' };
  return { surface: 'vue', adapterId: 'unsupported' };
};

export const onlyPreviewAdapterProvidesSelectedText = (
  adapterId: OnlyPreviewPreviewAdapterId
): boolean =>
  adapterId === 'monaco' ||
  adapterId === 'markdown-dom' ||
  adapterId === 'ooxml-docx' ||
  adapterId === 'ooxml-pptx';

export const onlyPreviewAdapterUsesOneShotAsset = (
  adapterId: OnlyPreviewPreviewAdapterId
): boolean => adapterId === 'drawio-viewer';

// A one-shot asset is one the renderer copies into its own memory before reporting ready, so its
// token can be retired at that point. `drawio-viewer` reads the file into a document; the other
// three keep the URL on the element itself and are the only holders of the bytes, so their token
// has to survive ready — a re-attach or a re-mount re-requests it.
export const onlyPreviewAdapterUsesVueAsset = (adapterId: OnlyPreviewPreviewAdapterId): boolean =>
  onlyPreviewAdapterUsesOneShotAsset(adapterId) ||
  adapterId === 'image' ||
  adapterId === 'audio' ||
  adapterId === 'video';

export const getOnlyPreviewDescriptorErrorCode = (
  descriptor: OnlyPreviewDescriptor | null
): OnlyPreviewErrorCode | null => {
  const errorCode = descriptor?.previewError?.code;
  if (!errorCode) return null;
  return errorCode === 'UNSUPPORTED_CODEC' ? 'OPERATION_FAILED' : errorCode;
};

export const getOnlyPreviewDescriptorErrorPayload = (
  descriptor: OnlyPreviewDescriptor
): OnlyPreviewPreviewPresentation['error'] => {
  const errorCode = getOnlyPreviewDescriptorErrorCode(descriptor);
  if (!descriptor.previewError || !errorCode) return null;
  return { code: errorCode, message: descriptor.previewError.message };
};
