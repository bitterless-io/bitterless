import { copyFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';

/**
 * 把索引库复制成候选 —— 能用写时复制克隆就克隆,不能就退回普通拷贝。
 *
 * **为什么不再用 SQLite 的 `backup()`。** 同一个 2.7 GB 索引库,2026-09-22 在参考机上实测:
 *
 * | 做法                    | 耗时        |
 * |-------------------------|-------------|
 * | `backup()`(旧)        | 26,568 ms(病态情形见过 128,688) |
 * | 普通文件拷贝            | 7,906 ms    |
 * | `cp -c`(APFS clonefile) | **95 ms**   |
 *
 * `backup()` 逐页搬、遇到写者竞争还要重启,所以比裸拷贝慢 3–17 倍。而这一步是纯 IO,后台工作
 * 切片器(`work-slicer.mjs`)是单个 `await`,**一点都节流不到** —— 它把页缓存冲光,那才是
 * 4 核 8G 机器上"更新索引时整机发顿"的主因(Ral 2026-09-22)。
 *
 * **提速让方案变安全,不只是变快。** `backup()` 的唯一好处是能容忍并发写入;裸拷贝不能。
 * 但索引写入现在全部经过 `index-queue.mjs`(每库并发度 1),写者已经互斥,缺的只是"读者也不能
 * 动"和"WAL 是空的"——95 毫秒的拷贝可以整段放在读写闸内完成,26.5 秒的绝对不行。调用方因此负责:
 * 取 `acquireSearchSnapshotWriter()` → `PRAGMA wal_checkpoint(TRUNCATE)` → 调本函数 → 放闸。
 *
 * Node 自己给不了克隆:`fs.copyFile` 的 `COPYFILE_FICLONE_FORCE` 在 macOS 上是 `ENOSYS`,
 * 非 force 的 `COPYFILE_FICLONE` 则静默退化成普通拷贝(实测 7,510 ms,和裸拷贝一个量级)。
 * 所以 macOS 走系统 `cp -c`。Windows 的 NTFS 没有对应能力(ReFS 有,但罕见),直接走普通拷贝 ——
 * 仍然比 `backup()` 快 3 倍以上。本仓只支持 macOS 与 Windows,所以不为 Linux 的 `--reflink` 铺路。
 */

// `cp -c` 只在同卷内可能成功,而候选文件和源库本来就同目录,所以这个前提天然满足。
const CLONE_TIMEOUT_MS = 30_000;

const cloneViaSystemCp = (source, destination) =>
  new Promise((resolve) => {
    execFile(
      '/bin/cp',
      ['-c', source, destination],
      { timeout: CLONE_TIMEOUT_MS },
      (error) => resolve(!error)
    );
  });

/**
 * 复制 `source` 到 `destination`。返回实际用的方式,供诊断记录 —— 退化成普通拷贝时耗时会差两个
 * 数量级,不记下来的话现场会看不懂为什么忽然慢了。
 *
 * 克隆失败一律退回普通拷贝,不抛:文件系统不支持、`cp` 不在、超时 —— 任何一种都不该让索引构建
 * 失败,慢一点总比不能更新索引好。
 */
export const cloneDatabaseFile = async (source, destination) => {
  if (process.platform === 'darwin' && (await cloneViaSystemCp(source, destination))) {
    return 'clone';
  }
  // 克隆可能已经落下一个不完整的目标(超时被杀的 `cp`),普通拷贝会覆盖,但显式清掉更干净。
  await rm(destination, { force: true }).catch(() => undefined);
  await copyFile(source, destination);
  return 'copy';
};
