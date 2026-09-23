import type { OnlyPreviewBookmark } from './onlyPreviewBookmarks.type';
import type { OnlyPreviewResult } from './onlyPreview.types';

export type OnlyPreviewStoredBookmark = Pick<OnlyPreviewBookmark, 'relativePath' | 'nodeKind'>;
export interface OnlyPreviewBookmarkState {
  revision: number;
  entries: OnlyPreviewStoredBookmark[];
}
export type OnlyPreviewBookmarkStorageRequest = { rootRealPath: string } & (
  | { action: 'snapshot' }
  | { action: 'add'; entry: OnlyPreviewStoredBookmark }
  | { action: 'remove'; relativePath: string }
  | { action: 'reorder'; relativePaths: string[] }
);
export interface OnlyPreviewBookmarkStorageResult extends OnlyPreviewBookmarkState {
  /** Reorder reports its transaction outcome so Main broadcasts only committed changes. */
  changed?: boolean;
}
export interface OnlyPreviewBookmarkStorage {
  execute(request: OnlyPreviewBookmarkStorageRequest): Promise<OnlyPreviewBookmarkStorageResult>;
}
export type OnlyPreviewBookmarkStorageReply = OnlyPreviewResult<OnlyPreviewBookmarkStorageResult>;
export const ONLY_PREVIEW_BOOKMARK_CAPABILITY_ARG = '--onlypreview-bookmark-capability=';
export const bookmarkStorageChannel = (capability: string): string => `onlypreview:bookmarks:${capability}`;
