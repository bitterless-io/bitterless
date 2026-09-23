import type {
  OnlyPreviewBookmarksPersistence,
  OnlyPreviewBookmarksStorage
} from './onlyPreviewBookmarks.type';

export const ONLY_PREVIEW_BOOKMARKS_EXPANDED_STORAGE_KEY = 'onlypreview.bookmarks-expanded.v1';

export class OnlyPreviewBookmarksPersistenceService implements OnlyPreviewBookmarksPersistence {
  constructor(private readonly storage: OnlyPreviewBookmarksStorage | null) {}

  restore(): boolean {
    try {
      return this.storage?.getItem(ONLY_PREVIEW_BOOKMARKS_EXPANDED_STORAGE_KEY) !== 'false';
    } catch {
      return true;
    }
  }

  save(expanded: boolean): void {
    try {
      this.storage?.setItem(ONLY_PREVIEW_BOOKMARKS_EXPANDED_STORAGE_KEY, String(expanded));
    } catch {
      // A failed preference write must not prevent expanding or collapsing the current list.
    }
  }
}

const resolveBrowserStorage = (): OnlyPreviewBookmarksStorage | null => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

export const onlyPreviewBookmarksPersistence = new OnlyPreviewBookmarksPersistenceService(
  resolveBrowserStorage()
);
