import { createXpcRendererEmitter } from 'electron-xpc/renderer';
import type { OnlyPreviewApi } from '@shared/onlypreview/onlyPreview.types';

export const onlyPreviewEmitter =
  createXpcRendererEmitter<Pick<OnlyPreviewApi, 'openOnlyPreviewWindow'>>('OnlyPreviewHandler');
