import { randomUUID } from 'node:crypto';
import { lstat, opendir, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, resolve } from 'node:path';

import { classifySearchMediaType, mediaTypeToPreviewHint } from './classification.mjs';
import { pathIsWithin } from './workspace-config.mjs';

const naturalCollator = new Intl.Collator('und', { numeric: true, sensitivity: 'base' });

const sameIdentity = (left, right) => left.dev === right.dev && left.ino === right.ino;

const numericStatValue = (value) => (typeof value === 'bigint' ? Number(value) : value);

const normalizeRelativePath = (value) =>
  String(value ?? '')
    .replaceAll('\\', '/')
    .replace(/^\.\//u, '')
    .replace(/^\/+|\/+$/gu, '');

const parentRelativePath = (relativePath) => {
  const parent = normalizeRelativePath(dirname(relativePath));
  return parent === '.' ? '' : parent;
};

const compareBrowseEntries = (left, right) => {
  const leftDirectory = left.nodeKind === 'directory';
  const rightDirectory = right.nodeKind === 'directory';
  if (leftDirectory !== rightDirectory) return leftDirectory ? -1 : 1;
  return (
    naturalCollator.compare(left.name, right.name) || left.name.localeCompare(right.name, 'und')
  );
};

const createBrowseEntry = ({ relativePath, stat, nodeKind, directoryToken, searchExcluded }) => {
  const mediaType = nodeKind === 'file' ? classifySearchMediaType(relativePath) : 'unknown';
  return {
    relativePath,
    parentRelativePath: parentRelativePath(relativePath),
    name: basename(relativePath),
    nodeKind,
    size: nodeKind === 'file' ? numericStatValue(stat.size) : 0,
    modifiedAt: Math.trunc(numericStatValue(stat.mtimeMs ?? 0)),
    previewHint:
      nodeKind === 'file' ? mediaTypeToPreviewHint(mediaType, relativePath) : 'unsupported',
    mediaType,
    isText: nodeKind === 'file' && mediaType === 'text',
    directoryToken,
    searchExcluded
  };
};

export class OnlyPreviewBrowseIndex {
  constructor(rootPath, { raceHook, searchPolicy } = {}) {
    if (!isAbsolute(rootPath)) throw new TypeError('Browse workspace root must be absolute');
    if (raceHook !== undefined && typeof raceHook !== 'function') {
      throw new TypeError('Browse race hook must be a function');
    }
    if (
      !searchPolicy ||
      typeof searchPolicy.isExcludedFilePath !== 'function' ||
      typeof searchPolicy.isExcludedDirectoryPath !== 'function' ||
      typeof searchPolicy.canTraverseExcludedDirectoryPath !== 'function'
    ) {
      throw new TypeError('Browse search policy is required');
    }
    this.rootPath = rootPath;
    this.raceHook = raceHook;
    this.searchPolicy = searchPolicy;
    this.pathByToken = new Map();
    this.tokenByPath = new Map();
    this.listedPaths = new Set();
    this.rootDirectoryToken = this.issueDirectoryToken('');
  }

  reset() {
    this.pathByToken.clear();
    this.tokenByPath.clear();
    this.listedPaths.clear();
    this.rootDirectoryToken = this.issueDirectoryToken('');
  }

  setSearchPolicy(searchPolicy) {
    if (
      !searchPolicy ||
      typeof searchPolicy.isExcludedFilePath !== 'function' ||
      typeof searchPolicy.isExcludedDirectoryPath !== 'function' ||
      typeof searchPolicy.canTraverseExcludedDirectoryPath !== 'function'
    ) {
      throw new TypeError('Browse search policy is required');
    }
    this.searchPolicy = searchPolicy;
  }

  async rootListing({ workspaceId, generation }) {
    return await this.list({
      workspaceId,
      generation,
      directoryToken: this.rootDirectoryToken
    });
  }

  async list({ workspaceId, generation, directoryToken }) {
    const capability = this.pathByToken.get(directoryToken);
    if (capability === undefined) throw new TypeError('Browse directory capability is stale');
    const { relativePath, ancestorBlocked } = capability;
    const absolutePath = relativePath
      ? resolve(this.rootPath, ...relativePath.split('/'))
      : this.rootPath;
    if (!pathIsWithin(this.rootPath, absolutePath)) {
      throw new TypeError('Browse directory escaped its workspace');
    }
    const directoryIdentity = await this.readStableNonSymlink({
      absolutePath,
      expectedKind: 'directory'
    });

    await this.runRaceHook('before-directory-open', relativePath);
    const directory = await opendir(absolutePath);
    const children = [];
    for await (const child of directory) children.push(child.name);
    await this.assertDirectoryIdentity(absolutePath, directoryIdentity);

    const entries = [];
    const blockedDescendantsByPath = new Map();
    for (const childName of children) {
      await this.assertDirectoryIdentity(absolutePath, directoryIdentity);
      const childRelativePath = relativePath ? `${relativePath}/${childName}` : childName;
      const childAbsolutePath = resolve(absolutePath, childName);
      if (!pathIsWithin(this.rootPath, childAbsolutePath)) continue;
      let childIdentity;
      try {
        childIdentity = await this.readStableChild({
          absolutePath: childAbsolutePath,
          relativePath: childRelativePath
        });
      } catch {
        await this.assertDirectoryIdentity(absolutePath, directoryIdentity);
        continue;
      }
      await this.assertDirectoryIdentity(absolutePath, directoryIdentity);
      const { stat: childStat, nodeKind } = childIdentity;
      if (nodeKind === 'symlink') {
        entries.push(
          createBrowseEntry({
            relativePath: childRelativePath,
            stat: childStat,
            nodeKind: 'symlink',
            directoryToken: null,
            searchExcluded: false
          })
        );
        continue;
      }
      if (nodeKind === 'directory') {
        const directlyExcluded = this.searchPolicy.isExcludedDirectoryPath(childRelativePath);
        entries.push(
          createBrowseEntry({
            relativePath: childRelativePath,
            stat: childStat,
            nodeKind: 'directory',
            directoryToken: null,
            searchExcluded: ancestorBlocked || directlyExcluded
          })
        );
        blockedDescendantsByPath.set(
          childRelativePath,
          ancestorBlocked ||
            (directlyExcluded &&
              !this.searchPolicy.canTraverseExcludedDirectoryPath(childRelativePath))
        );
        continue;
      }
      if (nodeKind !== 'file') continue;
      entries.push(
        createBrowseEntry({
          relativePath: childRelativePath,
          stat: childStat,
          nodeKind: 'file',
          directoryToken: null,
          searchExcluded:
            ancestorBlocked || this.searchPolicy.isExcludedFilePath(childRelativePath)
        })
      );
    }
    await this.assertDirectoryIdentity(absolutePath, directoryIdentity);
    entries.sort(compareBrowseEntries);
    for (const entry of entries) {
      if (entry.nodeKind === 'directory') {
        entry.directoryToken = this.issueDirectoryToken(
          entry.relativePath,
          blockedDescendantsByPath.get(entry.relativePath) === true
        );
      }
    }
    this.listedPaths.add(relativePath);
    return { workspaceId, generation, directoryToken, relativePath, entries };
  }

  async readStableChild({ absolutePath, relativePath }) {
    const beforeStat = await lstat(absolutePath, { bigint: true });
    await this.runRaceHook('after-child-lstat', relativePath);
    if (beforeStat.isSymbolicLink()) {
      const afterStat = await lstat(absolutePath, { bigint: true });
      if (!afterStat.isSymbolicLink() || !sameIdentity(beforeStat, afterStat)) {
        throw new TypeError('Browse child identity changed');
      }
      return { stat: afterStat, nodeKind: 'symlink' };
    }
    const expectedKind = beforeStat.isDirectory()
      ? 'directory'
      : beforeStat.isFile()
        ? 'file'
        : undefined;
    if (!expectedKind) throw new TypeError('Browse child is not a supported filesystem node');
    return await this.readStableNonSymlink({ absolutePath, expectedKind, beforeStat });
  }

  async readStableNonSymlink({ absolutePath, expectedKind, beforeStat }) {
    const initialStat = beforeStat ?? (await lstat(absolutePath, { bigint: true }));
    if (
      initialStat.isSymbolicLink() ||
      (expectedKind === 'directory' && !initialStat.isDirectory()) ||
      (expectedKind === 'file' && !initialStat.isFile())
    ) {
      throw new TypeError('Browse path is not the expected non-symbolic node');
    }
    const canonicalBefore = await realpath(absolutePath);
    if (canonicalBefore !== absolutePath || !pathIsWithin(this.rootPath, canonicalBefore)) {
      throw new TypeError('Browse path escaped its workspace');
    }
    const afterStat = await lstat(absolutePath, { bigint: true });
    const canonicalAfter = await realpath(absolutePath);
    if (
      afterStat.isSymbolicLink() ||
      (expectedKind === 'directory' && !afterStat.isDirectory()) ||
      (expectedKind === 'file' && !afterStat.isFile()) ||
      !sameIdentity(initialStat, afterStat) ||
      canonicalAfter !== canonicalBefore ||
      canonicalAfter !== absolutePath ||
      !pathIsWithin(this.rootPath, canonicalAfter)
    ) {
      throw new TypeError('Browse path identity changed');
    }
    return { stat: afterStat, canonicalPath: canonicalAfter, nodeKind: expectedKind };
  }

  async assertDirectoryIdentity(absolutePath, expectedIdentity) {
    const currentIdentity = await this.readStableNonSymlink({
      absolutePath,
      expectedKind: 'directory'
    });
    if (
      !sameIdentity(expectedIdentity.stat, currentIdentity.stat) ||
      expectedIdentity.canonicalPath !== currentIdentity.canonicalPath
    ) {
      throw new TypeError('Browse directory identity changed');
    }
  }

  async runRaceHook(point, relativePath) {
    await this.raceHook?.({ point, relativePath });
  }

  hasDirectory(relativePath) {
    return relativePath === '' || this.tokenByPath.has(relativePath);
  }

  directoryTokenForListedPath(relativePath) {
    return this.listedPaths.has(relativePath) ? this.tokenByPath.get(relativePath) : undefined;
  }

  issueDirectoryToken(relativePath, ancestorBlocked = false) {
    const existing = this.tokenByPath.get(relativePath);
    if (existing) return existing;
    const token = randomUUID();
    this.tokenByPath.set(relativePath, token);
    this.pathByToken.set(token, { relativePath, ancestorBlocked });
    return token;
  }
}

export const createOnlyPreviewBrowseIndex = (rootPath, options) =>
  new OnlyPreviewBrowseIndex(rootPath, options);
