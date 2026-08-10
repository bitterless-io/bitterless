import { createXpcRendererEmitter } from 'electron-xpc/renderer';
import type { OnlyPreviewApi } from '@shared/onlypreview/onlyPreview.types';

type OnlyPreviewGuideApi = Pick<OnlyPreviewApi, 'getAgentSkillGuideInfo'>;

export const onlyPreviewGuideClient = createXpcRendererEmitter<OnlyPreviewGuideApi>(
  'OnlyPreviewHandler'
) as OnlyPreviewGuideApi;
