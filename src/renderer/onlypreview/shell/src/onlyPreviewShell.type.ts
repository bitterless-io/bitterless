import type { OnlyPreviewIndexEntry } from '@shared/onlypreview/onlyPreview.types';

export interface OnlyPreviewTreeRow {
  entry: OnlyPreviewIndexEntry;
  depth: number;
  expanded: boolean;
  hasChildren: boolean;
}
