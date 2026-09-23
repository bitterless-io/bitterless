import type { OnlyPreviewFileRef, OnlyPreviewHostRequest } from './onlyPreview.types';

export interface OnlyPreviewBookmark {
  relativePath: string;
  name: string;
  nodeKind: 'file' | 'directory';
}
export interface OnlyPreviewBookmarksRequest extends OnlyPreviewHostRequest {
  workspaceId: string;
}
export interface OnlyPreviewBookmarksReorderRequest extends OnlyPreviewBookmarksRequest {
  relativePaths: string[];
}
export type OnlyPreviewBookmarkRequest = OnlyPreviewHostRequest & OnlyPreviewFileRef;
export interface OnlyPreviewBookmarksSnapshot {
  workspaceId: string;
  revision: number;
  entries: OnlyPreviewBookmark[];
}
export const ONLY_PREVIEW_BOOKMARKS_CHANGED_EVENT = 'onlypreview/bookmarksChanged' as const;
export const ONLY_PREVIEW_BOOKMARK_ADD_EVENT = 'onlypreview/bookmarkAdd' as const;
