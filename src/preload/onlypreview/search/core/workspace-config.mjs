import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';

import { parse } from 'yaml';

import { compileOrderedGlobRules } from './glob-config.mjs';

export const WORKSPACE_CONFIG_RELATIVE_PATH = '.bitterless/preview-config.yml';
const MAX_CONFIG_BYTES = 256 * 1024;

export const pathIsWithin = (
  rootPath,
  candidatePath,
  {
    relative: relativePath = relative,
    isAbsolute: isAbsolutePath = isAbsolute,
    sep: separator = sep
  } = {}
) => {
  const fromRoot = relativePath(rootPath, candidatePath);
  return (
    fromRoot === '' ||
    (fromRoot !== '..' && !fromRoot.startsWith(`..${separator}`) && !isAbsolutePath(fromRoot))
  );
};

const exactKeys = (record, expected) => {
  const actual = Object.keys(record).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
};

export const parseOnlyPreviewWorkspaceConfig = (sourceValue) => {
  const source = String(sourceValue ?? '');
  const parsed = source.trim() ? parse(source) : {};
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TypeError('Preview config must be a YAML mapping');
  }
  if (!exactKeys(parsed, ['exclude', 'version'])) {
    throw new TypeError('Preview config supports only version and exclude');
  }
  if (parsed.version !== 1) throw new TypeError('Preview config version must be 1');
  if (!Array.isArray(parsed.exclude) || parsed.exclude.some((entry) => typeof entry !== 'string')) {
    throw new TypeError('Preview config exclude must be a string list');
  }
  if (parsed.exclude.length > 1024) throw new TypeError('Preview config has too many globs');
  const rules = compileOrderedGlobRules(parsed.exclude);
  return Object.freeze({
    version: 1,
    exclude: Object.freeze([...parsed.exclude]),
    rules: Object.freeze(rules),
    hash: createHash('sha256').update(source).digest('hex')
  });
};

export const defaultOnlyPreviewWorkspaceConfig = () =>
  parseOnlyPreviewWorkspaceConfig('version: 1\nexclude: []\n');

export const loadOnlyPreviewWorkspaceConfig = async (rootPath) => {
  const rootRealPath = await realpath(rootPath);
  const configDirectoryPath = join(rootRealPath, '.bitterless');
  const filePath = join(configDirectoryPath, 'preview-config.yml');
  let directoryStat;
  try {
    directoryStat = await lstat(configDirectoryPath);
  } catch (error) {
    if (error?.code === 'ENOENT') return defaultOnlyPreviewWorkspaceConfig();
    throw error;
  }
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
    throw new TypeError('Preview config directory must not be a symbolic link');
  }
  let beforeStat;
  try {
    beforeStat = await lstat(filePath);
  } catch (error) {
    if (error?.code === 'ENOENT') return defaultOnlyPreviewWorkspaceConfig();
    throw error;
  }
  if (!beforeStat.isFile() || beforeStat.isSymbolicLink()) {
    throw new TypeError('Preview config must be a regular non-symbolic file');
  }
  const canonicalPath = await realpath(filePath);
  if (!pathIsWithin(rootRealPath, canonicalPath)) {
    throw new TypeError('Preview config escaped the workspace');
  }
  if (beforeStat.size > MAX_CONFIG_BYTES) throw new TypeError('Preview config is too large');
  const handle = await open(filePath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
  try {
    const openedStat = await handle.stat();
    if (
      !openedStat.isFile() ||
      openedStat.dev !== beforeStat.dev ||
      openedStat.ino !== beforeStat.ino
    ) {
      throw new TypeError('Preview config identity changed');
    }
    const buffer = Buffer.alloc(MAX_CONFIG_BYTES + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const read = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (read.bytesRead === 0) break;
      offset += read.bytesRead;
    }
    if (offset > MAX_CONFIG_BYTES) throw new TypeError('Preview config is too large');
    const afterStat = await handle.stat();
    if (
      afterStat.dev !== openedStat.dev ||
      afterStat.ino !== openedStat.ino ||
      afterStat.size !== openedStat.size ||
      Math.trunc(afterStat.mtimeMs) !== Math.trunc(openedStat.mtimeMs)
    ) {
      throw new TypeError('Preview config changed while reading');
    }
    const payload = buffer.subarray(0, offset);
    const withoutBom =
      payload[0] === 0xef && payload[1] === 0xbb && payload[2] === 0xbf
        ? payload.subarray(3)
        : payload;
    return parseOnlyPreviewWorkspaceConfig(
      new TextDecoder('utf-8', { fatal: true }).decode(withoutBom)
    );
  } finally {
    await handle.close();
  }
};
