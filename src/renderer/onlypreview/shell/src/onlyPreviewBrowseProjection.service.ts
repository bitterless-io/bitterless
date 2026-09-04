import { unwrapOnlyPreviewResult } from '@shared/onlypreview/onlyPreview.contract';
import type {
  OnlyPreviewIndex,
  OnlyPreviewIndexEntry
} from '@shared/onlypreview/onlyPreview.types';
import type {
  OnlyPreviewBrowseEntry,
  OnlyPreviewBrowseListing
} from '@shared/onlypreview/onlyPreviewSearch.type';
import { isOnlyPreviewBrowseListing } from './onlyPreviewBrowseListing.service';
import { onlyPreviewSearchClient } from './onlyPreviewSearch.client';
import { getOnlyPreviewParentPath } from './onlyPreviewTree.service';

export interface OnlyPreviewBrowseProjectionContext {
  hostToken: string;
  workspaceId: string;
  generation: number;
}

export interface OnlyPreviewBrowseProjectionResult {
  changed: boolean;
  loaded: boolean;
  rootReplaced: boolean;
  error: unknown | null;
  index: OnlyPreviewIndex | null;
}

const unchangedResult = (
  index: OnlyPreviewIndex | null,
  loaded = false,
  error: unknown | null = null
): OnlyPreviewBrowseProjectionResult => ({
  changed: false,
  loaded,
  rootReplaced: false,
  error,
  index
});

const toIndexEntry = (entry: OnlyPreviewBrowseEntry): OnlyPreviewIndexEntry => ({
  relativePath: entry.relativePath,
  parentRelativePath: entry.parentRelativePath,
  name: entry.name,
  nodeKind: entry.nodeKind,
  size: entry.size,
  modifiedAt: entry.modifiedAt,
  previewHint: entry.previewHint,
  mediaType: entry.mediaType,
  isText: entry.isText
});

export class OnlyPreviewBrowseProjectionService {
  private readonly entriesByPath = new Map<string, OnlyPreviewBrowseEntry[]>();
  private readonly directoryTokenByPath = new Map<string, string>();
  private readonly requestRevisionByToken = new Map<string, number>();
  private readonly excludedPaths = new Set<string>();
  private requestRevision = 0;
  private projection: OnlyPreviewIndex | null = null;

  get ready(): boolean {
    return this.entriesByPath.has('');
  }

  get searchExcludedPaths(): ReadonlySet<string> {
    return this.excludedPaths;
  }

  clear(expandedPaths: Set<string>): void {
    this.entriesByPath.clear();
    this.directoryTokenByPath.clear();
    this.requestRevisionByToken.clear();
    this.excludedPaths.clear();
    expandedPaths.clear();
    this.projection = null;
  }

  applyListing(
    listing: OnlyPreviewBrowseListing,
    context: OnlyPreviewBrowseProjectionContext,
    expandedPaths: Set<string>
  ): OnlyPreviewBrowseProjectionResult {
    if (listing.workspaceId !== context.workspaceId || listing.generation !== context.generation) {
      return unchangedResult(this.projection);
    }
    const currentToken = this.directoryTokenByPath.get(listing.relativePath);
    let rootReplaced = false;
    if (listing.relativePath === '') {
      if (currentToken && currentToken !== listing.directoryToken) {
        this.clear(expandedPaths);
        rootReplaced = true;
      }
    } else if (currentToken !== listing.directoryToken) {
      return unchangedResult(this.projection);
    }
    this.requestRevisionByToken.delete(listing.directoryToken);

    const previousEntries = this.entriesByPath.get(listing.relativePath) || [];
    const nextDirectoryPaths = new Set(
      listing.entries
        .filter((entry) => entry.nodeKind === 'directory')
        .map((entry) => entry.relativePath)
    );
    for (const previous of previousEntries) {
      if (previous.nodeKind === 'directory' && !nextDirectoryPaths.has(previous.relativePath)) {
        this.removeSubtree(previous.relativePath, expandedPaths);
      }
    }
    this.directoryTokenByPath.set(listing.relativePath, listing.directoryToken);
    for (const entry of listing.entries) {
      if (entry.nodeKind !== 'directory' || !entry.directoryToken) continue;
      const previousToken = this.directoryTokenByPath.get(entry.relativePath);
      if (previousToken && previousToken !== entry.directoryToken) {
        this.removeSubtree(entry.relativePath, expandedPaths);
      }
      this.directoryTokenByPath.set(entry.relativePath, entry.directoryToken);
    }
    this.entriesByPath.set(listing.relativePath, [...listing.entries]);
    this.rebuild(context.workspaceId);
    return {
      changed: true,
      loaded: true,
      rootReplaced,
      error: null,
      index: this.projection
    };
  }

  async loadDirectory(
    relativePath: string,
    context: OnlyPreviewBrowseProjectionContext,
    expandedPaths: Set<string>
  ): Promise<OnlyPreviewBrowseProjectionResult> {
    const directoryToken = this.directoryTokenByPath.get(relativePath);
    if (!directoryToken) return unchangedResult(this.projection);
    if (this.entriesByPath.has(relativePath)) return unchangedResult(this.projection, true);
    const requestRevision = ++this.requestRevision;
    this.requestRevisionByToken.set(directoryToken, requestRevision);
    try {
      const listing = unwrapOnlyPreviewResult(
        await onlyPreviewSearchClient.browseDirectory({
          ...context,
          directoryToken
        })
      );
      if (
        this.requestRevisionByToken.get(directoryToken) !== requestRevision ||
        this.directoryTokenByPath.get(relativePath) !== directoryToken ||
        !isOnlyPreviewBrowseListing(listing) ||
        listing.relativePath !== relativePath ||
        listing.directoryToken !== directoryToken
      ) {
        return unchangedResult(this.projection);
      }
      return this.applyListing(listing, context, expandedPaths);
    } catch (error) {
      return this.requestRevisionByToken.get(directoryToken) === requestRevision
        ? unchangedResult(this.projection, false, error)
        : unchangedResult(this.projection);
    } finally {
      if (this.requestRevisionByToken.get(directoryToken) === requestRevision) {
        this.requestRevisionByToken.delete(directoryToken);
      }
    }
  }

  async loadSelectedParentListings(
    selectedRelativePath: string,
    context: OnlyPreviewBrowseProjectionContext,
    expandedPaths: Set<string>
  ): Promise<OnlyPreviewBrowseProjectionResult> {
    if (!selectedRelativePath || !this.ready) return unchangedResult(this.projection);
    const parents: string[] = [];
    let current = getOnlyPreviewParentPath(selectedRelativePath);
    while (current) {
      parents.unshift(current);
      current = getOnlyPreviewParentPath(current);
    }
    let result = unchangedResult(this.projection, true);
    for (const relativePath of parents) {
      result = await this.loadDirectory(relativePath, context, expandedPaths);
      if (!result.loaded) return result;
    }
    return result;
  }

  /**
   * Rows Main has already removed from disk.
   *
   * The delete announcement carries the exact set that went, so the projection drops those rows now
   * instead of waiting to rediscover them: the only other writer is a re-fetched listing, and the
   * refresh that would trigger one is a full workspace re-index
   * (`search-engine.mjs` `refreshInternal`). A folder's row therefore survived for as long as that
   * rescan took — see `docs/issues/onlypreview-delete-refreshes-the-wrong-index.md`.
   *
   * `removeSubtree` alone is not enough: it detaches the folder's own listing and tokens, but the
   * row itself lives in the PARENT's entry array, which is what `rebuild` reads.
   */
  removeDeletedPaths(
    relativePaths: readonly string[],
    workspaceId: string,
    expandedPaths: Set<string>
  ): OnlyPreviewBrowseProjectionResult {
    // The root is never a removable row, and an empty run must not match everything.
    const removed = relativePaths.filter((relativePath) => relativePath.length > 0);
    if (!removed.length || !this.ready) return unchangedResult(this.projection);
    let changed = false;
    for (const relativePath of removed) {
      const parentPath = getOnlyPreviewParentPath(relativePath);
      const siblings = this.entriesByPath.get(parentPath);
      if (siblings) {
        const remaining = siblings.filter((entry) => entry.relativePath !== relativePath);
        if (remaining.length !== siblings.length) {
          this.entriesByPath.set(parentPath, remaining);
          changed = true;
        }
      }
      if (this.entriesByPath.has(relativePath) || this.directoryTokenByPath.has(relativePath)) {
        changed = true;
      }
      this.removeSubtree(relativePath, expandedPaths);
    }
    if (!changed) return unchangedResult(this.projection);
    this.rebuild(workspaceId);
    return {
      changed: true,
      loaded: true,
      rootReplaced: false,
      error: null,
      index: this.projection
    };
  }

  private rebuild(workspaceId: string): void {
    const entries: OnlyPreviewIndexEntry[] = [];
    this.excludedPaths.clear();
    for (const listingEntries of this.entriesByPath.values()) {
      for (const entry of listingEntries) {
        if (entry.searchExcluded) this.excludedPaths.add(entry.relativePath);
        entries.push(toIndexEntry(entry));
      }
    }
    this.projection = {
      workspaceId,
      entries,
      truncated: false,
      limit: entries.length
    };
  }

  private removeSubtree(relativePath: string, expandedPaths: Set<string>): void {
    for (const path of [...this.entriesByPath.keys()]) {
      if (path === relativePath || path.startsWith(`${relativePath}/`)) {
        this.entriesByPath.delete(path);
      }
    }
    for (const path of [...this.directoryTokenByPath.keys()]) {
      if (path === relativePath || path.startsWith(`${relativePath}/`)) {
        this.directoryTokenByPath.delete(path);
      }
    }
    for (const path of [...expandedPaths]) {
      if (path === relativePath || path.startsWith(`${relativePath}/`)) expandedPaths.delete(path);
    }
  }
}
