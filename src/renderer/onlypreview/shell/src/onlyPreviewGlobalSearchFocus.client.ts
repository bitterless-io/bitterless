import { unwrapOnlyPreviewResult } from '@shared/onlypreview/onlyPreview.contract';
import { onlyPreviewClient } from '../../common/onlyPreviewClient';
import { onlyPreviewEnv } from '../../common/contextBridge/onlyPreviewEnv.bridge';

export const restoreOnlyPreviewGlobalSearchFocus = async (
  mode: 'opener' | 'preview' | 'discard'
): Promise<boolean> => {
  const hostToken = onlyPreviewEnv.hostToken;
  if (!hostToken) return false;
  try {
    return unwrapOnlyPreviewResult(
      await onlyPreviewClient.restoreGlobalSearchFocus({ hostToken, mode })
    );
  } catch {
    return false;
  }
};
