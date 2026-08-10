import { lstat, readdir, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import {
  ONLY_PREVIEW_MAX_INDEX_DEPTH,
  ONLY_PREVIEW_MAX_INDEX_ENTRIES,
  type OnlyPreviewDirectoryListing,
  type OnlyPreviewIndex,
  type OnlyPreviewIndexEntry,
  type OnlyPreviewNodeKind
} from '@shared/onlypreview/onlyPreview.types';
import {
  isOnlyPreviewPermissionError,
  normalizeOnlyPreviewRelativePath,
  OnlyPreviewContractError
} from '@shared/onlypreview/onlyPreview.contract';
import {
  onlyPreviewWorkspaceRegistry,
  type OnlyPreviewWorkspaceRecord,
  type OnlyPreviewWorkspaceRegistry
} from './onlyPreviewWorkspace.registry';
import { classifyOnlyPreviewExtension } from './onlyPreviewClassifier.service';

export const ONLY_PREVIEW_EXCLUDED_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'out',
  '.next',
  'coverage',
  '.cache',
  '.turbo'
]);

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

const isContainedPath = (root: string, candidate: string): boolean => {
  const child = relative(root, candidate);
  return child === '' || (!child.startsWith(`..${sep}`) && child !== '..' && !isAbsolute(child));
};

const throwIndexAccessError = (error: unknown): never => {
  if (error instanceof OnlyPreviewContractError) throw error;
  if (isOnlyPreviewPermissionError(error)) {
    throw new OnlyPreviewContractError(
      'PATH_PERMISSION_DENIED',
      'Bitterless does not have permission to read this file or folder.'
    );
  }
  throw new OnlyPreviewContractError(
    'PATH_NOT_FOUND',
    'A project folder changed or disappeared while it was read.'
  );
};

const naturalNodeSort = (left: OnlyPreviewIndexEntry, right: OnlyPreviewIndexEntry): number => {
  if ((left.nodeKind === 'directory') !== (right.nodeKind === 'directory')) {
    return left.nodeKind === 'directory' ? -1 : 1;
  }
  return collator.compare(left.name, right.name) || left.name.localeCompare(right.name);
};

const toNodeKind = (entryStat: Awaited<ReturnType<typeof lstat>>): OnlyPreviewNodeKind => {
  if (entryStat.isSymbolicLink()) return 'symlink';
  if (entryStat.isDirectory()) return 'directory';
  return 'file';
};

const isExplicitSelectionPath = (
  selectedRelativePath: string | undefined,
  relativePath: string
): boolean =>
  selectedRelativePath === relativePath ||
  Boolean(selectedRelativePath?.startsWith(`${relativePath}/`));

export type OnlyPreviewIndexBuildProgress =
  | { phase: 'counting' }
  | { phase: 'indexing'; completed: number; total: number };

interface OnlyPreviewIndexTraversalResult {
  entries: OnlyPreviewIndexEntry[];
  count: number;
  truncated: boolean;
}

export class OnlyPreviewIndexService {
  constructor(private readonly workspaces: OnlyPreviewWorkspaceRegistry) {}

  async listDirectory(params: {
    hostToken: unknown;
    workspaceId: unknown;
    relativePath: unknown;
    showHiddenFiles: boolean;
  }): Promise<OnlyPreviewDirectoryListing> {
    const workspace = this.workspaces.requireWorkspace(params.hostToken, params.workspaceId);
    const relativePath = normalizeOnlyPreviewRelativePath(params.relativePath, { allowEmpty: true });
    const entries = await this.readDirectoryEntries({
      workspace,
      relativePath,
      showHiddenFiles: params.showHiddenFiles
    });
    return {
      workspaceId: workspace.workspaceId,
      relativePath,
      entries
    };
  }

  async build(params: {
    hostToken: unknown;
    workspaceId: unknown;
    showHiddenFiles: boolean;
    onProgress?: (progress: OnlyPreviewIndexBuildProgress) => void;
  }): Promise<OnlyPreviewIndex> {
    const workspace = this.workspaces.requireWorkspace(params.hostToken, params.workspaceId);

    try {
      params.onProgress?.({ phase: 'counting' });
      const counted = await this.traverseIndex({
        workspace,
        showHiddenFiles: params.showHiddenFiles,
        maximumEntries: ONLY_PREVIEW_MAX_INDEX_ENTRIES,
        collectEntries: false
      });
      const total = counted.count;
      params.onProgress?.({ phase: 'indexing', completed: 0, total });
      let lastReportedCompleted = 0;
      const generated = await this.traverseIndex({
        workspace,
        showHiddenFiles: params.showHiddenFiles,
        maximumEntries: total,
        collectEntries: true,
        onEntry: (completed) => {
          if (completed % 256 !== 0) return;
          lastReportedCompleted = completed;
          params.onProgress?.({ phase: 'indexing', completed, total });
        }
      });
      if (generated.count !== lastReportedCompleted) {
        params.onProgress?.({ phase: 'indexing', completed: generated.count, total });
      }

      return {
        workspaceId: workspace.workspaceId,
        entries: generated.entries,
        truncated: counted.truncated,
        limit: ONLY_PREVIEW_MAX_INDEX_ENTRIES
      };
    } catch (error) {
      if (error instanceof OnlyPreviewContractError) throw error;
      if (isOnlyPreviewPermissionError(error)) throwIndexAccessError(error);
      throw new OnlyPreviewContractError(
        'INDEX_FAILED',
        'OnlyPreview could not index this directory.'
      );
    }
  }

  private async traverseIndex(params: {
    workspace: OnlyPreviewWorkspaceRecord;
    showHiddenFiles: boolean;
    maximumEntries: number;
    collectEntries: boolean;
    onEntry?: (completed: number) => void;
  }): Promise<OnlyPreviewIndexTraversalResult> {
    const entries: OnlyPreviewIndexEntry[] = [];
    const directories: Array<{ relativePath: string; depth: number }> = [
      { relativePath: '', depth: 0 }
    ];
    let count = 0;
    let visitedSinceYield = 0;

    for (let directoryIndex = 0; directoryIndex < directories.length; directoryIndex += 1) {
      const directory = directories[directoryIndex];
      const children = await this.readDirectoryEntries({
        workspace: params.workspace,
        relativePath: directory.relativePath,
        showHiddenFiles: params.showHiddenFiles
      });
      for (const child of children) {
        if (count >= params.maximumEntries) {
          return { entries, count, truncated: true };
        }
        count += 1;
        if (params.collectEntries) entries.push(child);
        params.onEntry?.(count);
        visitedSinceYield += 1;
        if (child.nodeKind === 'directory') {
          const childDepth = directory.depth + 1;
          if (childDepth < ONLY_PREVIEW_MAX_INDEX_DEPTH) {
            directories.push({ relativePath: child.relativePath, depth: childDepth });
          }
        }
        if (visitedSinceYield >= 256) {
          visitedSinceYield = 0;
          await new Promise<void>((resolveYield) => setImmediate(resolveYield));
        }
      }
    }

    return { entries, count, truncated: false };
  }

  private async readDirectoryEntries(params: {
    workspace: OnlyPreviewWorkspaceRecord;
    relativePath: string;
    showHiddenFiles: boolean;
  }): Promise<OnlyPreviewIndexEntry[]> {
    const { workspace, relativePath, showHiddenFiles } = params;
    const absoluteDirectory = relativePath
      ? resolve(workspace.rootRealPath, ...relativePath.split('/'))
      : workspace.rootRealPath;
    if (!isContainedPath(workspace.rootRealPath, absoluteDirectory)) {
      throw new OnlyPreviewContractError(
        'PATH_OUTSIDE_WORKSPACE',
        'A project directory leaves its workspace.'
      );
    }

    let canonicalDirectory: string;
    let childNames: string[];
    try {
      const directoryStat = await lstat(absoluteDirectory);
      if (directoryStat.isSymbolicLink()) {
        throw new OnlyPreviewContractError(
          'PATH_OUTSIDE_WORKSPACE',
          'A project directory became a symbolic link while it was read.'
        );
      }
      if (!directoryStat.isDirectory()) {
        throw new OnlyPreviewContractError(
          'PATH_NOT_REGULAR_FILE',
          'The requested project path is not a directory.'
        );
      }
      canonicalDirectory = await realpath(absoluteDirectory);
      const isAuthorizedDirectory =
        relativePath === ''
          ? canonicalDirectory === workspace.rootRealPath
          : isContainedPath(workspace.rootRealPath, canonicalDirectory);
      if (!isAuthorizedDirectory) {
        throw new OnlyPreviewContractError(
          'PATH_OUTSIDE_WORKSPACE',
          'A project directory resolved outside its workspace.'
        );
      }
      childNames = await readdir(canonicalDirectory);
    } catch (error) {
      throwIndexAccessError(error);
    }

    const entries: OnlyPreviewIndexEntry[] = [];
    for (const name of childNames) {
      const childRelativePath = relativePath ? `${relativePath}/${name}` : name;
      if (
        !showHiddenFiles &&
        name.startsWith('.') &&
        !isExplicitSelectionPath(workspace.selectedRelativePath, childRelativePath)
      ) {
        continue;
      }
      let entryStat: Awaited<ReturnType<typeof lstat>>;
      try {
        entryStat = await lstat(resolve(canonicalDirectory, name));
      } catch (error) {
        if (isOnlyPreviewPermissionError(error)) throwIndexAccessError(error);
        continue;
      }
      const nodeKind = toNodeKind(entryStat);
      if (nodeKind === 'directory' && ONLY_PREVIEW_EXCLUDED_DIRECTORIES.has(name)) continue;
      entries.push({
        relativePath: childRelativePath,
        parentRelativePath: relativePath,
        name,
        nodeKind,
        size: entryStat.size,
        modifiedAt: entryStat.mtimeMs,
        previewHint:
          nodeKind === 'directory'
            ? 'unsupported'
            : classifyOnlyPreviewExtension(childRelativePath)
      });
    }
    entries.sort(naturalNodeSort);
    return entries;
  }
}

export const onlyPreviewIndexService = new OnlyPreviewIndexService(onlyPreviewWorkspaceRegistry);
