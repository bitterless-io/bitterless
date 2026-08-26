import { OnlyPreviewSqliteIndex } from './sqlite-index.mjs';
import {
  createGlobalSearchContentAuthority,
  createGlobalSearchFileAuthority,
  isGlobalSearchPathInScope
} from './global-search-files.mjs';
import { normalizeSearchText } from './normalization.mjs';
import { isWorkspaceSearchPathWithinDepth } from './traversal.mjs';

const validRelativePath = (value) => {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > 16_384 ||
    value.includes('\0') ||
    value.startsWith('/') ||
    value.startsWith('\\') ||
    /^[a-zA-Z]:/u.test(value)
  ) {
    return false;
  }
  const normalized = value.replaceAll('\\', '/');
  return !normalized.split('/').some((segment) => !segment || segment === '.' || segment === '..');
};

const closeIndex = (index) => {
  try {
    index?.close();
  } catch {
    // The lane may be retired by promotion and a concurrent query completion.
  }
};

const isBuilding = (state) => state === 'building' || state === 'reconciling';

export class OnlyPreviewSelectedFilePriorityLane {
  constructor({ readWorkspaceFile, resolveContext }) {
    this.readWorkspaceFile = readWorkspaceFile;
    this.resolveContext = resolveContext;
    this.revision = 0;
    this.lane = undefined;
  }

  retire() {
    const lane = this.lane;
    this.lane = undefined;
    if (!lane) return;
    lane.retired = true;
    if (lane.queryCount === 0) closeIndex(lane.index);
  }

  revoke() {
    this.revision += 1;
    this.retire();
  }

  supersede({ workspaceId, generation, relativePath }) {
    const context = this.resolveContext();
    if (!context || context.workspaceId !== workspaceId || context.generation !== generation) {
      throw new TypeError('Search workspace generation is stale');
    }
    if (!validRelativePath(relativePath)) throw new TypeError('Search priority path is invalid');
    this.revoke();
    if (
      !isBuilding(context.state) ||
      !isWorkspaceSearchPathWithinDepth(relativePath, { isDirectory: false })
    ) {
      return undefined;
    }
    return {
      workspaceId,
      generation,
      relativePath,
      priorityRevision: this.revision,
      buildEpoch: context.buildEpoch
    };
  }

  isCurrent(priority, isCancelled = () => false) {
    const context = this.resolveContext();
    return (
      !isCancelled() &&
      context?.workspaceId === priority.workspaceId &&
      context.generation === priority.generation &&
      context.buildEpoch === priority.buildEpoch &&
      isBuilding(context.state) &&
      this.revision === priority.priorityRevision
    );
  }

  async prioritizeFile(priority) {
    const isCancelled = priority.isCancelled ?? (() => false);
    let context = this.resolveContext();
    if (!this.isCurrent(priority, isCancelled)) return;
    if (context.searchPolicy.isExcludedFilePath(priority.relativePath)) return;
    let entry;
    try {
      entry = await this.readWorkspaceFile({
        rootPath: context.rootPath,
        relativePath: priority.relativePath
      });
    } catch {
      return;
    }
    context = this.resolveContext();
    if (
      !this.isCurrent(priority, isCancelled) ||
      !entry ||
      entry.changed === true ||
      entry.relativePath !== priority.relativePath ||
      context.searchPolicy.isExcludedFilePath(priority.relativePath)
    ) {
      return;
    }
    const index = new OnlyPreviewSqliteIndex(':memory:');
    try {
      index.upsert(entry);
      if (!this.isCurrent(priority, isCancelled)) return;
      this.retire();
      this.lane = {
        index,
        entry: {
          relativePath: entry.relativePath,
          parentRelativePath: entry.relativePath.includes('/')
            ? entry.relativePath.slice(0, entry.relativePath.lastIndexOf('/'))
            : '',
          name: entry.relativePath.split('/').at(-1) ?? entry.relativePath,
          nodeKind: 'file',
          size: entry.size,
          modifiedAt: entry.modifiedMs,
          previewHint: entry.previewHint,
          mediaType: entry.mediaType
        },
        relativePath: priority.relativePath,
        priorityRevision: priority.priorityRevision,
        queryCount: 0,
        retired: false
      };
    } finally {
      if (this.lane?.index !== index) closeIndex(index);
    }
  }

  async search(query, { maxResults, scope, isCancelled, onResult }) {
    const context = this.resolveContext();
    const lane = isBuilding(context?.state) ? this.lane : undefined;
    const relativePaths = new Set();
    if (!lane) return { cancelled: false, relativePaths };
    lane.queryCount += 1;
    try {
      const outcome = await lane.index.search(query, {
        maxResults,
        scope,
        isCancelled,
        onResult: (result) => {
          if (lane.retired || lane.priorityRevision !== this.revision) return;
          relativePaths.add(result.relativePath);
          onResult?.(result);
        }
      });
      return { cancelled: outcome.cancelled, relativePaths };
    } finally {
      lane.queryCount -= 1;
      if (lane.retired && lane.queryCount === 0) closeIndex(lane.index);
    }
  }

  async searchGlobal(query, { maxResults, scope, isCancelled }) {
    const context = this.resolveContext();
    const lane = isBuilding(context?.state) ? this.lane : undefined;
    if (!lane || !isGlobalSearchPathInScope(lane.relativePath, scope)) {
      return { cancelled: false, files: [], contents: [] };
    }
    lane.queryCount += 1;
    try {
      const files = normalizeSearchText(lane.entry.name).includes(normalizeSearchText(query))
        ? [createGlobalSearchFileAuthority(lane.entry)]
        : [];
      const outcome = await lane.index.searchContents(query, {
        maxResults,
        scope,
        isCancelled
      });
      if (outcome.cancelled || lane.retired || lane.priorityRevision !== this.revision) {
        return { cancelled: true, files: [], contents: [] };
      }
      const contents = outcome.results.map((result) =>
        createGlobalSearchContentAuthority(result, lane.index.metadata(result.relativePath))
      );
      return { cancelled: false, files, contents };
    } finally {
      lane.queryCount -= 1;
      if (lane.retired && lane.queryCount === 0) closeIndex(lane.index);
    }
  }
}

export const createOnlyPreviewSelectedFilePriorityLane = (options) =>
  new OnlyPreviewSelectedFilePriorityLane(options);
