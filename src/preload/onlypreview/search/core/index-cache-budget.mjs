import { opendir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

/**
 * `search-index-v6/` 的总量上限。
 *
 * 每开过一个 workspace 就永久留一个库,既没有预算也没有淘汰 —— 三个 edition 曾经堆到 24.5 GB
 * 把一块 926 GB 的盘塞满,2026-09-22 参考机上单个 edition 的目录也有 8 GB。
 *
 * 10 GB 是 Ral 2026-09-22「都修复掉」时采纳的建议值:在相位 1–2 之后单个大 workspace 的索引约
 * 1.4 GB,10 GB 能放七个左右,足够覆盖一周的正常轮换;而被淘汰的代价只是下次打开时后台重建 ——
 * **淘汰的是缓存,不是数据**,没有任何东西会丢。
 */
export const ONLY_PREVIEW_INDEX_CACHE_CAP_BYTES = 10 * 1024 * 1024 * 1024;

const USAGE_FILE = 'usage.json';
const DATABASE_SUFFIX = '.sqlite';

const usagePath = (directoryPath) => join(directoryPath, USAGE_FILE);

const readUsage = async (directoryPath) => {
  try {
    const parsed = JSON.parse(await readFile(usagePath(directoryPath), 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return new Map();
    const usage = new Map();
    for (const [name, at] of Object.entries(parsed)) {
      if (typeof name === 'string' && Number.isFinite(at)) usage.set(name, at);
    }
    return usage;
  } catch {
    // 没有账本、或者账本坏了,都不是错误:回退到文件 mtime,淘汰顺序只会不那么准。
    return new Map();
  }
};

const writeUsage = async (directoryPath, usage) => {
  const target = usagePath(directoryPath);
  // 先写临时文件再改名:账本半截写坏会让整轮淘汰顺序失忆,而它本身只有几百字节。
  const temporary = `${target}.${process.pid}.tmp`;
  const payload = JSON.stringify(Object.fromEntries(usage));
  try {
    await writeFile(temporary, payload, 'utf8');
    await rename(temporary, target);
  } catch {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
};

/**
 * 把一个库的所有伴生文件归到它名下:`-wal`、`-shm`,以及构建/恢复留下的 candidate、previous、
 * recovery、quarantine。规则是「名字以库名开头」,和 `sqlite-artifacts.mjs` 认的是同一批东西。
 *
 * 只按这条规则删,所以目录里任何不以某个库名开头的文件都不会被碰到 —— 包括账本自己。
 */
const collectGroups = async (directoryPath) => {
  const entries = [];
  const directory = await opendir(directoryPath);
  for await (const entry of directory) entries.push(entry.name);
  const databases = entries.filter((name) => name.endsWith(DATABASE_SUFFIX));
  const groups = new Map();
  for (const database of databases) groups.set(database, { names: [], bytes: 0, modifiedAt: 0 });
  for (const name of entries) {
    // 最长的库名优先,否则 `a.sqlite` 会把 `a.sqlite.candidate-…` 从 `a.sqlite` 手里抢走的反例
    // 不存在,但前缀相同的两个库名(`x.sqlite` / `x.sqlite2`)会。
    const owner = databases
      .filter((database) => name === database || name.startsWith(database))
      .sort((left, right) => right.length - left.length)[0];
    if (!owner) continue;
    const group = groups.get(owner);
    group.names.push(name);
    try {
      const info = await stat(join(directoryPath, name));
      group.bytes += info.size;
      group.modifiedAt = Math.max(group.modifiedAt, info.mtimeMs);
    } catch {
      // 正在被构建删掉的中间文件,按 0 计。
    }
  }
  return groups;
};

/** 记一次打开。淘汰顺序按这个账本,而不是 mtime —— 一个从没被写过的库 mtime 永远停在建成那天。 */
export const recordOnlyPreviewIndexUse = async (databasePath, now = Date.now()) => {
  const directoryPath = dirname(resolve(databasePath));
  const usage = await readUsage(directoryPath);
  usage.set(basename(databasePath), now);
  await writeUsage(directoryPath, usage);
};

/**
 * 把 `search-index-v6/` 压回上限以内,最久没打开的先淘汰。
 *
 * 正在用的那个库永远不淘汰,哪怕它自己就超过上限 —— 删掉当前 workspace 的索引不会省下任何
 * 东西,只会让眼前这次打开立刻重建一遍。
 */
export const evictOnlyPreviewIndexCache = async ({
  activeDatabasePath,
  capBytes = ONLY_PREVIEW_INDEX_CACHE_CAP_BYTES,
  now = Date.now(),
  onEvict
} = {}) => {
  const directoryPath = dirname(resolve(activeDatabasePath));
  const activeName = basename(activeDatabasePath);
  let groups;
  try {
    groups = await collectGroups(directoryPath);
  } catch {
    return { totalBytes: 0, evicted: [] };
  }
  let totalBytes = 0;
  for (const group of groups.values()) totalBytes += group.bytes;
  if (totalBytes <= capBytes) return { totalBytes, evicted: [] };

  const usage = await readUsage(directoryPath);
  const candidates = [...groups.entries()]
    .filter(([name]) => name !== activeName)
    .map(([name, group]) => ({ name, group, lastUsedAt: usage.get(name) ?? group.modifiedAt }))
    .sort((left, right) => left.lastUsedAt - right.lastUsedAt);

  const evicted = [];
  for (const { name, group } of candidates) {
    if (totalBytes <= capBytes) break;
    let removedBytes = 0;
    for (const fileName of group.names) {
      try {
        await rm(join(directoryPath, fileName), { recursive: true, force: true });
        removedBytes += 1;
      } catch {
        // 删不掉就跳过它:一个删不动的文件不该让整轮淘汰停下来。
      }
    }
    if (removedBytes === 0) continue;
    totalBytes -= group.bytes;
    usage.delete(name);
    evicted.push({ name, bytes: group.bytes });
  }
  if (evicted.length > 0) {
    await writeUsage(directoryPath, usage);
    onEvict?.({ evictedCount: evicted.length, totalBytes });
  }
  return { totalBytes, evicted };
};
