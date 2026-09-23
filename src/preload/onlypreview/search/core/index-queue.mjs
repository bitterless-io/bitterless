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
    queue = { pending: [], running: null };
    queues.set(key, queue);
  }
  return queue;
};

/**
 * 交互式任务插到后台任务前面 —— **但不打断正在跑的那个。**
 *
 * 为什么不能沿用原来的 promise 链:链上每个任务都 `await` 前一个,排在队首的后台任务没有任何
 * 办法让身后的交互式任务先过,想让路就是死锁。所以这里改成显式队列 + 取活循环,让「取哪一个」
 * 成为一个可以做决定的地方。
 *
 * 要解决的是这个形状(参考机 2026-09-22 04:42):用户点开一个 workspace,`initialize` 在队里等,
 * 而后台 reconcile 一轮接一轮地**继续入队并抢先开跑** —— 五轮插在一个已经在等的用户请求前面,
 * 用户等了 5 分 7 秒。轮次本身由监听那边的退避压下去了,这里管的是顺序:只要有人在等,
 * 后台就不该再抢新的一轮。
 *
 * 不做抢占:正在跑的那一轮已经拷了一半的库,打断它只会浪费掉已经付出的 IO,并留下一份要回收的
 * 候选。所以最坏等待是「一轮在途任务」,不是「一串排队任务」。
 */
const pump = (key, queue) => {
  if (queue.running) return;
  if (queue.pending.length === 0) {
    // 队尾还是自己才回收,否则会把后来者排好的队一起丢掉。
    if (queues.get(key) === queue) queues.delete(key);
    return;
  }
  const interactiveIndex = queue.pending.findIndex((entry) => entry.interactive);
  const [entry] = queue.pending.splice(interactiveIndex >= 0 ? interactiveIndex : 0, 1);
  queue.running = entry;
  Promise.resolve()
    .then(() => entry.operation())
    .then(entry.resolve, entry.reject)
    .finally(() => {
      queue.running = null;
      pump(key, queue);
    });
};

/**
 * 把一个索引变更任务排进该库的队列,返回它的结果。
 *
 * 任务抛错只影响它自己:每个任务持有自己的 resolve/reject,所以一次失败的重建不会让后面所有
 * 任务连锁失败 —— 那会让一次偶发错误变成索引永久不再更新。
 *
 * `interactive` 表示「有人正在等这件事做完」。打开它的只有两处:`initialize` —— 用户点开
 * workspace 时盯着的就是它;以及删除的两跳 `begin-delete-task` / `finish-delete-task` ——
 * 用户正盯着一个没有关闭按钮的进度条,而删除真正的活只有 14 毫秒,排在一轮重建后面就是十几秒
 * (docs/issues/onlypreview-delete-waits-behind-index-rebuilds.md)。watcher 触发的 reconcile、
 * 启动时补做的删除日志恢复一律不打开:那两件事背后没有人在等。
 */
export const submitIndexTask = async (databasePath, name, operation, { interactive = false } = {}) => {
  const key = String(databasePath ?? '');
  const queue = queueFor(key);
  return await new Promise((resolve, reject) => {
    queue.pending.push({ name, operation, interactive, resolve, reject });
    pump(key, queue);
  });
};

/** 诊断用:当前排队深度与正在跑的任务名。测试也用它断言"没有并发"。 */
export const indexQueueState = (databasePath) => {
  const queue = queues.get(String(databasePath ?? ''));
  if (!queue) return { depth: 0, running: '' };
  return {
    depth: queue.pending.length + (queue.running ? 1 : 0),
    running: queue.running?.name ?? ''
  };
};
