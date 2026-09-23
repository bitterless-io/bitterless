import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';

import { parse } from 'yaml';

import { compileOrderedGlobRules } from './glob-config.mjs';
import {
  WORKSPACE_CONFIG_DIRECTORIES,
  WORKSPACE_CONFIG_FILE_NAME,
  WORKSPACE_CONFIG_RELATIVE_PATH
} from '../../../../shared/onlypreview/onlyPreviewWorkspaceConfigLocation.mjs';

// 位置常量的唯一来源是 `shared/onlypreview/onlyPreviewWorkspaceConfigLocation.mjs`
// (main 也 import 它,走 `@shared` 别名);这里原样再导出,
// 免得每个调用方都要知道它被拆到了哪个文件。
export { WORKSPACE_CONFIG_DIRECTORIES, WORKSPACE_CONFIG_RELATIVE_PATH };

/**
 * 放预览配置的目录名。**这两个值是本仓与 micromeet-cowork 之间唯一的差异**(其余代码逐字节相同)。
 *
 * 第一个是**主名字**;其余是**只读回落** —— 存在就照读,但新名字优先。回落的意义是
 * 「不丢已有的 per-project 配置」:这些文件是人手建在自己项目目录里的**数据**,改个名字不该让它们
 * 突然失效(Ral 2026-09-10:「cowork 的 OnlyPreview 应该叫做 .micromeet」)。
 *
 * 本模块**只读不写**,所以没有"写哪一个"的问题;人愿意的话可以自己把目录改名过去。
 */
const MAX_CONFIG_BYTES = 256 * 1024;

/**
 * 监听要认**全部**候选目录,不只是主名字。
 *
 * 少了回落那几个,人在旧目录里改一行配置不会触发重载 —— 表现是"改了没生效",而那是最难查的一种。
 */
export const isWorkspaceConfigWatchPath = (relativePath) =>
  WORKSPACE_CONFIG_DIRECTORIES.some(
    (directory) =>
      relativePath === directory || relativePath === `${directory}/${WORKSPACE_CONFIG_FILE_NAME}`
  );

/**
 * 第一个**真实存在且是目录**的候选。都不存在时返回 `null`。
 *
 * 判据是"是不是目录",不是"存不存在" —— 一个同名的普通文件或符号链接不该被当成配置目录,
 * 那两种情况下面的加载路径会各自抛出更准确的错误。
 */
const resolveWorkspaceConfigDirectory = async (rootPath, stat = lstat) => {
  for (const directory of WORKSPACE_CONFIG_DIRECTORIES) {
    const directoryPath = join(rootPath, directory);
    try {
      const stats = await stat(directoryPath);
      if (stats.isDirectory() && !stats.isSymbolicLink()) {
        return { directory, directoryPath, stats };
      }
      // 同名但不是目录 —— 交给调用方去报那个更准确的错,不要跳过它去读回落:
      // 那会把「你那个 .micromeet 是个文件」悄悄变成「读了旧目录」。
      return { directory, directoryPath, stats };
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  return null;
};

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
    hash: createHash('sha256').update(JSON.stringify({
      version: 1,
      rules: rules.map(({ include, regex }) => [include, regex.source])
    })).digest('hex')
  });
};

export const defaultOnlyPreviewWorkspaceConfig = () =>
  parseOnlyPreviewWorkspaceConfig('version: 1\nexclude: []\n');

export const readOnlyPreviewWorkspaceConfigSignature = async (rootPath) => {
  try {
    const resolved = await resolveWorkspaceConfigDirectory(rootPath);
    if (!resolved) return 'unavailable:ENOENT';
    // **目录名并进签名**:候选之间切换(人新建了主目录,而旧目录还在)必须算一次变化,
    // 否则配置换了源却不重载。
    const { directory, directoryPath, stats } = resolved;
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      return `directory:${directory}:${stats.mode}:${stats.dev}:${stats.ino}`;
    }
    const file = await lstat(join(directoryPath, WORKSPACE_CONFIG_FILE_NAME));
    return `${directory}:${file.mode}:${file.dev}:${file.ino}:${file.size}:${file.mtimeMs}:${file.ctimeMs}`;
  } catch (error) {
    return `unavailable:${error?.code ?? 'UNKNOWN'}`;
  }
};

export const loadOnlyPreviewWorkspaceConfig = async (rootPath) => {
  const rootRealPath = await realpath(rootPath);
  const resolved = await resolveWorkspaceConfigDirectory(rootRealPath);
  // 一个候选都没有 ⇒ 这个项目没配过,用默认配置。这与"目录存在但文件不存在"是同一个结果,
  // 也与改名前的行为一致。
  if (!resolved) return defaultOnlyPreviewWorkspaceConfig();
  const { directoryPath: configDirectoryPath, stats: directoryStat } = resolved;
  const filePath = join(configDirectoryPath, WORKSPACE_CONFIG_FILE_NAME);
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
