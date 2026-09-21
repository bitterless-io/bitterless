/**
 * 索引**写入**任务队列 —— 每个库一条,并发度 1。
 *
 * 一切会改动索引的操作都必须从这里过:启动初始化、全量重建、增量 reconcile、删除后的索引清理、
 * 重启后补做的删除清理。它们之间没有"可以并行"的组合 —— 并行的后果 2026-09-21 已经在参考机上
 * 兑现过一次:同一个库上同时活着三个引擎,各拷一份 2.6 GB 候选,两小时吃掉 14 GB 磁盘,
 * 写出两份真损坏的库,还冤枉隔离了两份健康的库。
 *
 * **只串行写,读不进队列**(Ral 2026-09-21:「我说的索引串行,限写入操作」)。`search`、
 * `browseDirectory`、`preview`、`acquireSearchSnapshot` 一律不经过这里 —— 把读也排进来,
 * 一次 80–120 秒的重建就会把搜索框冻住整整两分钟,那是拿一个体验问题去换另一个。读者与写者之间
 * 靠 `acquireSearchSnapshotWriter` 的读者排空来隔离,那是另一道闸,粒度只覆盖真正改库的那一小段。
 *
 * 往这里加新任务之前先问一句:它会改库吗?不改就不该进来。
 *
 * **按库路径,不按引擎实例。** 引擎实例会叠:`fileSearchRuntime._shutdownActive()` 先把
 * `active` 置空再去 `await` 旧引擎的 shutdown,而那个 shutdown 排在一次 80–120 秒的构建后面,
 * 这段窗口里进来的 `initialize` 就会在同一个库上再起一个引擎。引擎自带的
 * `operationTail` / `buildEpoch` / `promotionPromise` 全是实例字段,跨实例一个都不起作用。
 *
 * 队列是**进程内**的。跨进程还需要文件锁,但目前所有索引写入都发生在同一个 fileSearch 渲染进程里
 * (`fileSearchWindowService` 是单例,`start()` 会先 `stop()` 上一个),所以进程内串行就够。
 * 这个前提一旦不成立,补的是这里,不是各个调用点。
 */

const queues = new Map();

const queueFor = (key) => {
  let queue = queues.get(key);
  if (!queue) {
    queue = { tail: Promise.resolve(), depth: 0, running: '' };
    queues.set(key, queue);
  }
  return queue;
};

/**
 * 把一个索引变更任务排进该库的队列,返回它的结果。
 *
 * 任务抛错只影响它自己:队尾用一条吞掉结果的链接续,所以一次失败的重建不会让后面所有任务
 * 连锁失败 —— 那会让一次偶发错误变成索引永久不再更新。
 */
export const submitIndexTask = async (databasePath, name, operation) => {
  const key = String(databasePath ?? '');
  const queue = queueFor(key);
  const previous = queue.tail;
  let release = () => undefined;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => held);
  queue.tail = tail;
  queue.depth += 1;
  await previous;
  queue.running = name;
  try {
    return await operation();
  } finally {
    queue.depth -= 1;
    queue.running = '';
    release();
    // 队尾还是自己才回收,否则会把后来者排好的队一起丢掉。
    if (queues.get(key) === queue && queue.tail === tail && queue.depth === 0) {
      queues.delete(key);
    }
  }
};

/** 诊断用:当前排队深度与正在跑的任务名。测试也用它断言"没有并发"。 */
export const indexQueueState = (databasePath) => {
  const queue = queues.get(String(databasePath ?? ''));
  return { depth: queue?.depth ?? 0, running: queue?.running ?? '' };
};
