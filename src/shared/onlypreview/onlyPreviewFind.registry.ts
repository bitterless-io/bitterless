import type {
  OnlyPreviewFindCapability,
  OnlyPreviewPreviewAdapterId,
  OnlyPreviewPreviewSurface
} from './onlyPreview.types';

export type OnlyPreviewAdapterFindCapability = OnlyPreviewFindCapability | { mode: 'none' };

export interface OnlyPreviewAdapterSpec {
  surface: OnlyPreviewPreviewSurface;
  find: OnlyPreviewAdapterFindCapability;
}

export const ONLY_PREVIEW_ADAPTERS = {
  monaco: { surface: 'vue', find: { mode: 'content-adapter', adapter: 'monaco' } },
  'markdown-dom': { surface: 'vue', find: { mode: 'webcontents-find' } },
  'html-page': { surface: 'chrome', find: { mode: 'webcontents-find' } },
  'chromium-pdf': { surface: 'chrome', find: { mode: 'webcontents-find' } },
  'xlsx-grid': { surface: 'vue', find: { mode: 'content-adapter', adapter: 'sheet' } },
  'docx-dom': { surface: 'vue', find: { mode: 'webcontents-find' } },
  'drawio-viewer': { surface: 'vue', find: { mode: 'none' } },
  image: { surface: 'vue', find: { mode: 'none' } },
  audio: { surface: 'vue', find: { mode: 'none' } },
  video: { surface: 'vue', find: { mode: 'none' } },
  unsupported: { surface: 'vue', find: { mode: 'none' } }
} as const satisfies Record<OnlyPreviewPreviewAdapterId, OnlyPreviewAdapterSpec>;

export const getOnlyPreviewAdapterSpec = (
  adapterId: OnlyPreviewPreviewAdapterId
): OnlyPreviewAdapterSpec => ONLY_PREVIEW_ADAPTERS[adapterId];
