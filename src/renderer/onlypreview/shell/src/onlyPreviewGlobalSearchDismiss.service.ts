import { onlyPreviewI18n } from '../../common/onlyPreviewI18n';
import { onlyPreviewGlobalSearchShellClient } from './onlyPreviewGlobalSearchShell.client';
import { onlyPreviewShellStore } from './onlyPreviewShell.store';

export const dismissOnlyPreviewGlobalSearch = async (): Promise<void> => {
  try {
    await onlyPreviewGlobalSearchShellClient.dismiss();
  } catch {
    onlyPreviewShellStore.errorMessage = onlyPreviewI18n.errors.OPERATION_FAILED;
  }
};
