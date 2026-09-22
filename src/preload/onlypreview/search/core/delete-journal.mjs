import { open, readFile, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

/**
 * 删除任务日志 —— 让"删文件"和"清索引"成为一个可以跨重启续做的整体。
 *
 * 在此之前删除完全不通知索引:`commitDelete` 删完文件就返回,索引只能等 watcher 触发一次
 * reconcile(80–120 秒),这段时间里删掉的内容照样被搜得到;而如果在这中间关掉应用,那笔欠账
 * 就永远没人还了 —— 下次启动搜出来的还是已经不存在的文件。
 *
 * **日志刻意不放在索引库里。** 索引库损坏时会被整体隔离、重建,表连同欠账一起消失 —— 而
 * "索引损坏"和"删除没做完"很容易由同一次异常退出同时造成,那正是唯一真正需要这份日志的时刻。
 * 所以它是索引目录下的一个独立小文件,不参与 `.candidate-*` / `.previous-*` 的提升改名,也不被
 * 损坏回收扫走。设计见 `areas/agent-runtime/preview/index-solution.html` #6。
 *
 * 写入用 临时文件 → `rename`,POSIX 上是原子替换,所以读到的永远是某一次完整的写入,不会是
 * 写了一半的 JSON。
 */

export const DELETE_JOURNAL_FILENAME = 'delete-journal.json';

const JOURNAL_VERSION = 1;
// 一条任务最多携带的路径数。删除入口本身已有上限,这里只是防止一个损坏的文件把启动拖垮。
const MAX_TASK_PATHS = 10_000;
const MAX_TASKS = 64;

/**
 * 日志跟着**库文件**走,不是跟着目录走。
 *
 * 所有工作区的索引库都躺在同一个目录里,只靠 `sha256(rootRealPath)` 的文件名区分。早先这里用
 * `dirname(databasePath)` 拼名字,等于让全部工作区共用一份日志 —— 两个引擎同时活着是设计内的常态
 * (见 `index-queue.mjs` 开头),它们在**不同**的库路径上、因此在不同的队列里真并行,对同一个
 * 文件做无保护的读-改-写,后写的把先写的整条任务吞掉;而重启恢复还会拿 A 的根路径去解析 B 的
 * 相对路径,然后把 B 的任务一并销账。两种都让"删了还能搜到"永久化。
 *
 * `reclaimInterruptedSqliteArtifacts` 与 `removeSqliteArtifacts` 的模式都不匹配这个后缀,所以
 * 放在库文件旁边不会被当成索引残留扫走。
 */
export const deleteJournalPath = (databasePath) => `${databasePath}.${DELETE_JOURNAL_FILENAME}`;

const isPath = (value) => typeof value === 'string' && value.length > 0 && value.length <= 16_384;

const readTask = (value) => {
  if (!value || typeof value !== 'object') return undefined;
  const { taskId, workspaceId, rootPath, relativePaths, phase, createdAt } = value;
  if (!isPath(taskId) || !isPath(workspaceId) || !isPath(rootPath)) return undefined;
  if (phase !== 'files' && phase !== 'index') return undefined;
  if (!Array.isArray(relativePaths)) return undefined;
  const paths = relativePaths.filter(isPath).slice(0, MAX_TASK_PATHS);
  if (paths.length === 0) return undefined;
  return {
    taskId,
    workspaceId,
    rootPath,
    relativePaths: paths,
    phase,
    createdAt: Number.isFinite(createdAt) ? createdAt : 0
  };
};

/**
 * 读出全部未完成任务。
 *
 * 文件不存在、内容损坏、版本不认识 —— 一律当作"没有欠账"返回空表,而不是让启动失败。一份读不懂的
 * 日志挡住应用启动,比丢掉这次恢复更糟;而丢掉恢复的后果是下一次全量 reconcile 会把它补上。
 */
export const readDeleteJournal = async (databasePath, io = { readFile }) => {
  let raw;
  try {
    raw = await io.readFile(deleteJournalPath(databasePath), 'utf8');
  } catch (error) {
    // 文件不存在 = 确实没有欠账。其它读失败(EACCES、EMFILE —— 建索引时会开上千个文件句柄,
    // EMFILE 完全现实)**必须抛**:调用方拿它当读-改-写的读半边,把"读不出来"当成空表,下一步
    // 就会把既有欠账整个覆盖掉;`advanceDeleteTaskToIndex` 更会算出空表进而**删掉整份日志**
    // —— 恰好发生在文件刚被删、只欠索引清理的那一刻。恢复路径自己 catch,这里不替它兜。
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== 'object' || parsed.version !== JOURNAL_VERSION) return [];
  if (!Array.isArray(parsed.tasks)) return [];
  const tasks = [];
  // 保留**最新**的 MAX_TASKS 条:`beginDeleteTask` 往尾部追加,截头会让刚开的那条任务对之后
  // 每一次读都不可见,于是它的索引清理永远不会发生。
  for (const candidate of parsed.tasks.slice(-MAX_TASKS)) {
    const task = readTask(candidate);
    if (task) tasks.push(task);
  }
  return tasks;
};

const writeDeleteJournal = async (databasePath, tasks, io) => {
  const target = deleteJournalPath(databasePath);
  if (tasks.length === 0) {
    await io.rm(target, { force: true });
    return;
  }
  // 临时名带 uuid:两个进程同时写各自的临时文件,`rename` 再各自原子替换,不会互相截断。
  const staging = `${target}.${randomUUID()}.tmp`;
  try {
    // **写完必须 fsync 再 rename。** `rename` 给的是原子**可见性**,对"应用被杀"够用
    // (页缓存还在);对掉电/内核 panic 不够 —— 而那正是这份日志唯一真正要扛的场景。
    // 不 sync 的话,重命名可能先落盘而内容没落,重启后读到一个长度为零的文件,于是
    // 「文件已删、索引欠着」这笔账静悄悄地消失。
    const handle = await io.open(staging, 'w');
    try {
      await handle.writeFile(JSON.stringify({ version: JOURNAL_VERSION, tasks }), 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await io.rename(staging, target);
  } catch (error) {
    await io.rm(staging, { force: true }).catch(() => undefined);
    throw error;
  }
};

const defaultIo = { open, readFile, rename, rm };

/**
 * 开一条删除任务 —— **必须先于第一个 unlink**。
 *
 * 崩在这之前 = 什么都没发生;崩在这之后 = 有账可查。顺序反过来就等于放弃了整个方案。
 */
export const beginDeleteTask = async (
  databasePath,
  { workspaceId, rootPath, relativePaths, now = Date.now },
  io = defaultIo
) => {
  const paths = (Array.isArray(relativePaths) ? relativePaths : []).filter(isPath);
  if (paths.length === 0) throw new TypeError('Delete task needs at least one path');
  const task = {
    taskId: randomUUID(),
    workspaceId,
    rootPath,
    relativePaths: paths.slice(0, MAX_TASK_PATHS),
    phase: 'files',
    createdAt: now()
  };
  const tasks = await readDeleteJournal(databasePath, io);
  await writeDeleteJournal(databasePath, [...tasks, task], io);
  return task;
};

/**
 * 换挡到 `'index'`:把"文件已经没了、索引还欠着"这个事实固化下来。
 *
 * 只登记**真正删掉的**那些路径。部分失败时剩下的文件还在,不该被当作欠账去清索引 ——
 * 清了它们就会从搜索里消失,而文件其实还在盘上。
 */
export const advanceDeleteTaskToIndex = async (
  databasePath,
  { taskId, removedPaths },
  io = defaultIo
) => {
  const requested = new Set(
    (Array.isArray(removedPaths) ? removedPaths : []).filter(isPath)
  );
  const tasks = await readDeleteJournal(databasePath, io);
  const next = [];
  let found = false;
  for (const task of tasks) {
    if (task.taskId !== taskId) {
      next.push(task);
      continue;
    }
    found = true;
    // **只收任务本来就覆盖的路径。** 直接拿调用方给的清单替换,等于让一个调用方的 bug 或一份
    // 被截断的日志把从未授权过的路径写进欠账,恢复时就会把它从索引里抹掉。
    const paths = task.relativePaths.filter((relativePath) => requested.has(relativePath));
    // 一个都没删成:没有欠账,直接销账。
    if (paths.length === 0) continue;
    next.push({ ...task, relativePaths: paths, phase: 'index' });
  }
  // 找不到这个 id 却返回成功,调用方会接着去清索引 —— 此刻没有任何持久记录,崩在那里欠账就
  // 永久丢了。宁可让删除报错,也不要留一笔没有账本的删除。
  if (!found) throw new TypeError('Delete task is unknown');
  await writeDeleteJournal(databasePath, next, io);
};

export const clearDeleteTask = async (databasePath, taskId, io = defaultIo) => {
  const tasks = await readDeleteJournal(databasePath, io);
  const next = tasks.filter((task) => task.taskId !== taskId);
  if (next.length === tasks.length) return;
  await writeDeleteJournal(databasePath, next, io);
};
