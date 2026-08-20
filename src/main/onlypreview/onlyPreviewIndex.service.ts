import { lstat, readdir, realpath } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';
import {
  ONLY_PREVIEW_MAX_INDEX_DEPTH,
  ONLY_PREVIEW_MAX_INDEX_ENTRIES,
  type OnlyPreviewIndex,
  type OnlyPreviewIndexEntry,
  type OnlyPreviewNodeKind
} from '@shared/onlypreview/onlyPreview.types';
import {
  isOnlyPreviewPermissionError,
  OnlyPreviewContractError
} from '@shared/onlypreview/onlyPreview.contract';
import {
  onlyPreviewWorkspaceRegistry,
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
    'A project folder changed or disappeared while it was indexed.'
  );
};

const naturalNodeSort = (
  left: { name: string; isDirectory(): boolean },
  right: { name: string; isDirectory(): boolean }
): number => {
  if (left.isDirectory() !== right.isDirectory()) return left.isDirectory() ? -1 : 1;
  return collator.compare(left.name, right.name) || left.name.localeCompare(right.name);
};

const toNodeKind = (entryStat: Awaited<ReturnType<typeof lstat>>): OnlyPreviewNodeKind => {
  if (entryStat.isSymbolicLink()) return 'symlink';
  if (entryStat.isDirectory()) return 'directory';
  return 'file';
};

export class OnlyPreviewIndexService {
  constructor(private readonly workspaces: OnlyPreviewWorkspaceRegistry) {}

  async build(params: {
    hostToken: unknown;
    workspaceId: unknown;
    showHiddenFiles: boolean;
  }): Promise<OnlyPreviewIndex> {
    const workspace = this.workspaces.requireWorkspace(params.hostToken, params.workspaceId);
    const entries: OnlyPreviewIndexEntry[] = [];
    let truncated = false;
    let visitedSinceYield = 0;
    const selectedRelativePath = workspace.selectedRelativePath;

    const isExplicitSelectionPath = (relativePath: string): boolean =>
      selectedRelativePath === relativePath ||
      Boolean(selectedRelativePath?.startsWith(`${relativePath}/`));

    const isVisibleChild = (
      child: { name: string; isDirectory(): boolean },
      parentRelativePath: string
    ): boolean => {
      const relativePath = parentRelativePath ? `${parentRelativePath}/${child.name}` : child.name;
      if (
        !params.showHiddenFiles &&
        child.name.startsWith('.') &&
        !isExplicitSelectionPath(relativePath)
      ) {
        return false;
      }
      return !(child.isDirectory() && ONLY_PREVIEW_EXCLUDED_DIRECTORIES.has(child.name));
    };

    const walk = async (
      absoluteDirectory: string,
      parentRelativePath: string,
      depth: number
    ): Promise<void> => {
      if (truncated || depth > ONLY_PREVIEW_MAX_INDEX_DEPTH) return;
      let canonicalDirectory: string;
      let children: Dirent[];
      try {
        const directoryStat = await lstat(absoluteDirectory);
        if (directoryStat.isSymbolicLink()) {
          throw new OnlyPreviewContractError(
            'PATH_OUTSIDE_WORKSPACE',
            'A project directory became a symbolic link while it was indexed.'
          );
        }
        if (!directoryStat.isDirectory()) {
          throw new OnlyPreviewContractError(
            'PATH_NOT_REGULAR_FILE',
            'A project directory changed type while it was indexed.'
          );
        }
        canonicalDirectory = await realpath(absoluteDirectory);
        const isAuthorizedDirectory =
          parentRelativePath === ''
            ? canonicalDirectory === workspace.rootRealPath
            : isContainedPath(workspace.rootRealPath, canonicalDirectory);
        if (!isAuthorizedDirectory) {
          throw new OnlyPreviewContractError(
            'PATH_OUTSIDE_WORKSPACE',
            'A project directory resolved outside its workspace.'
          );
        }
        children = await readdir(canonicalDirectory, { withFileTypes: true });
      } catch (error) {
        throwIndexAccessError(error);
      }
      children.sort(naturalNodeSort);
      for (const child of children) {
        if (truncated) return;
        if (!isVisibleChild(child, parentRelativePath)) continue;
        if (entries.length >= ONLY_PREVIEW_MAX_INDEX_ENTRIES) {
          truncated = true;
          return;
        }
        const relativePath = parentRelativePath
          ? `${parentRelativePath}/${child.name}`
          : child.name;
        const absolutePath = join(canonicalDirectory, child.name);
        let entryStat: Awaited<ReturnType<typeof lstat>>;
        try {
          entryStat = await lstat(absolutePath);
        } catch (error) {
          if (isOnlyPreviewPermissionError(error)) throwIndexAccessError(error);
          continue;
        }
        const nodeKind = toNodeKind(entryStat);
        const previewHint =
          nodeKind === 'directory' ? 'unsupported' : classifyOnlyPreviewExtension(relativePath);
        const mediaType =
          nodeKind === 'file' &&
          (previewHint === 'text' ||
            previewHint === 'pdf' ||
            previewHint === 'image' ||
            previewHint === 'audio' ||
            previewHint === 'video')
            ? previewHint
            : 'unknown';
        entries.push({
          relativePath,
          parentRelativePath,
          name: child.name,
          nodeKind,
          size: entryStat.size,
          modifiedAt: entryStat.mtimeMs,
          previewHint,
          mediaType,
          isText: nodeKind === 'file' && previewHint === 'text'
        });
        visitedSinceYield += 1;
        if (visitedSinceYield >= 256) {
          visitedSinceYield = 0;
          await new Promise<void>((resolveYield) => setImmediate(resolveYield));
        }
        if (nodeKind === 'directory') {
          if (depth < ONLY_PREVIEW_MAX_INDEX_DEPTH) {
            await walk(absolutePath, relativePath, depth + 1);
          } else {
            let nestedChildren: Dirent[];
            try {
              const nestedStat = await lstat(absolutePath);
              if (nestedStat.isSymbolicLink() || !nestedStat.isDirectory()) {
                throw new OnlyPreviewContractError(
                  'PATH_OUTSIDE_WORKSPACE',
                  'A project directory changed while it was indexed.'
                );
              }
              const canonicalNested = await realpath(absolutePath);
              if (!isContainedPath(workspace.rootRealPath, canonicalNested)) {
                throw new OnlyPreviewContractError(
                  'PATH_OUTSIDE_WORKSPACE',
                  'A project directory resolved outside its workspace.'
                );
              }
              nestedChildren = await readdir(canonicalNested, { withFileTypes: true });
            } catch (error) {
              throwIndexAccessError(error);
            }
            if (nestedChildren.some((nested) => isVisibleChild(nested, relativePath))) {
              truncated = true;
              return;
            }
          }
        }
      }
    };

    try {
      await walk(workspace.rootRealPath, '', 1);
    } catch (error) {
      if (error instanceof OnlyPreviewContractError) throw error;
      if (isOnlyPreviewPermissionError(error)) throwIndexAccessError(error);
      throw new OnlyPreviewContractError(
        'INDEX_FAILED',
        'OnlyPreview could not index this directory.'
      );
    }
    return {
      workspaceId: workspace.workspaceId,
      entries,
      truncated,
      limit: ONLY_PREVIEW_MAX_INDEX_ENTRIES
    };
  }
}

export const onlyPreviewIndexService = new OnlyPreviewIndexService(onlyPreviewWorkspaceRegistry);
