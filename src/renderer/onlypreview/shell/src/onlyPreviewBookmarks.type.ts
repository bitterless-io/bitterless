import type { OnlyPreviewApi } from '@shared/onlypreview/onlyPreview.types';
export type OnlyPreviewBookmarksClient = Pick<
  OnlyPreviewApi,
  'getBookmarks' | 'addBookmark' | 'removeBookmark' | 'reorderBookmarks' | 'showBookmarkContextMenu'
>;
export interface OnlyPreviewBookmarksHost {
  hostToken: string | null;
  hostId: string | null;
  workspaceId: () => string | null;
}

export interface OnlyPreviewBookmarksStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export interface OnlyPreviewBookmarksPersistence {
  restore(): boolean;
  save(expanded: boolean): void;
}
