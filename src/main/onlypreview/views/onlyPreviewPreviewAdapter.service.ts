import type {
  OnlyPreviewDescriptor,
  OnlyPreviewErrorCode,
  OnlyPreviewPreviewAdapterId,
  OnlyPreviewPreviewPresentation,
  OnlyPreviewPreviewSurface
} from '@shared/onlypreview/onlyPreview.types';

export const ONLY_PREVIEW_DOCUMENT_REBUILD_ERRORS: ReadonlySet<OnlyPreviewErrorCode> = new Set([
  'DOCUMENT_PARSE_FAILED',
  'DOCUMENT_SANITIZE_FAILED',
  'DOCUMENT_RENDER_TIMEOUT'
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
  selectedTextAvailable: false
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
  if (descriptor.kind === 'sheet') return { surface: 'vue', adapterId: 'xlsx-grid' };
  if (descriptor.kind === 'document') return { surface: 'vue', adapterId: 'docx-dom' };
  if (descriptor.kind === 'diagram') return { surface: 'vue', adapterId: 'drawio-viewer' };
  if (descriptor.kind === 'image') return { surface: 'vue', adapterId: 'image' };
  if (descriptor.kind === 'audio') return { surface: 'vue', adapterId: 'audio' };
  if (descriptor.kind === 'video') return { surface: 'vue', adapterId: 'video' };
  return { surface: 'vue', adapterId: 'unsupported' };
};

export const onlyPreviewAdapterProvidesSelectedText = (
  adapterId: OnlyPreviewPreviewAdapterId
): boolean => adapterId === 'monaco' || adapterId === 'markdown-dom' || adapterId === 'docx-dom';

export const onlyPreviewAdapterUsesOneShotAsset = (
  adapterId: OnlyPreviewPreviewAdapterId
): boolean =>
  adapterId === 'image' ||
  adapterId === 'xlsx-grid' ||
  adapterId === 'docx-dom' ||
  adapterId === 'drawio-viewer';

export const onlyPreviewAdapterUsesVueAsset = (adapterId: OnlyPreviewPreviewAdapterId): boolean =>
  onlyPreviewAdapterUsesOneShotAsset(adapterId) || adapterId === 'audio' || adapterId === 'video';

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
