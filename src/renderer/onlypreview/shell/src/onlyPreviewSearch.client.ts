import { createXpcRendererEmitter } from 'electron-xpc/renderer';
import type { OnlyPreviewSearchRuntimeApi } from '@shared/onlypreview/onlyPreviewSearch.type';

export const onlyPreviewSearchClient = createXpcRendererEmitter<OnlyPreviewSearchRuntimeApi>(
  'OnlyPreviewSearchRuntimeHandler'
) as OnlyPreviewSearchRuntimeApi;
