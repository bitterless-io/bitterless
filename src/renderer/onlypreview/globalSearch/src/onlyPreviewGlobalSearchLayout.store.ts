import { reactive } from 'vue';
import type { OnlyPreviewGlobalSearchLayout } from '@shared/onlypreview/onlyPreview.types';

class OnlyPreviewGlobalSearchLayoutStore {
  layout: OnlyPreviewGlobalSearchLayout | null = null;

  setLayout(layout: OnlyPreviewGlobalSearchLayout | null): void {
    this.layout = layout
      ? {
          viewBounds: { ...layout.viewBounds },
          workspaceBounds: { ...layout.workspaceBounds }
        }
      : null;
  }
}

export const onlyPreviewGlobalSearchLayoutStore = reactive(
  new OnlyPreviewGlobalSearchLayoutStore()
);
