import { createXpcRendererEmitter } from 'electron-xpc/renderer';
import type { OnlyPreviewApi } from '@shared/onlypreview/onlyPreview.types';

export const onlyPreviewClient = createXpcRendererEmitter<OnlyPreviewApi>(
  'OnlyPreviewHandler'
) as OnlyPreviewApi;
