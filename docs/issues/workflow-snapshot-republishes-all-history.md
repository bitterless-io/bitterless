# Issue — 每条 agent 动作都把**全部历史 run** clone + stringify + 落盘 + 广播

**Status:** 🔧 Fixing — 2026-09-18
**Reported:** 2026-09-18 (Ral)，出自 xpc broadcast 全量审查
**Area:** `src/main/agent/workflowEngine/supervisor.ts`（micromeet-cowork 侧逐字节同形，同批修）

Apply the same behavior to BL and COWORK.

## 症状

启动慢、切 tab 卡、workflow 跑起来时整个 main 进程发涩。

## 根因

`publish()` 对**全部历史 run** 做四件全量的事，而它有约 20 个调用点，**包含每条 agent 动作和每条日志行**：

```ts
private snapshot(sessionId?) {
  return structuredClone({ runs: sessionId ? this.runs.filter(...) : this.runs, revision: this.revision })
}
private publish(): void {
  this.revision++
  const snapshot = this.snapshot()            // ① structuredClone 全部 runs
  const contents = JSON.stringify(snapshot)   // ② stringify 全部 runs
  this.writes = this.writes.then(async () => { /* 全量重写 runs.json */ })   // ③ 无背压链
  this.deps.broadcast(snapshot)               // ④ 广播全部 runs
  for (const notify of this.changed) notify()
}
```

两处无界：

1. **`runs` 只增不减。** 全文件只有两处写入：`push`（:166）和 `restore()` 整体赋值（:110）。没有裁剪、没有上限、没有按时间淘汰，**run 结束也不移除**；`restore()` 把未终结的 run 标成 `failed` 而不是丢弃，所以它**跨重启永久累加**。
2. **`this.writes` 是一条无背压 promise 链。** `this.writes = this.writes.then(...)` 每次 append 一个链节，每个链节闭包捕获一份**完整快照字符串**。只要 publish 速率高于磁盘写入速率，排队的链节就按字节堆积，而每份的大小本身还随 run 数增长。

于是每条 agent 动作的代价 = O(全部历史 run 的字节数)，而 run 数随使用单调增长 —— **O(n²)**。

实测（Ral 本机，读文件得出，非估算）：

| | 值 |
|---|---|
| `runs.json` | **95,550 字节** |
| run 数 | **4** |
| agent 数 | 12 |
| 每个 run 约 | 24 KB |

即**现在**每条 agent 动作就要 clone 95 KB、stringify 95 KB、写盘 95 KB、广播 95 KB。到 100 个 run 时是每条动作 2.4 MB。
本仓同文件 `runs.json` = 6,123 字节（用得少，但机制相同；上面 95,550 那组数来自 micromeet-cowork）。

## 不是 OOM

95 KB 离那次 3.6 GB 的 main 进程 OOM 差四个数量级。审查里有 lane 把它评为 OOM 成因，已推翻。
它是**卡顿**的确凿解释，不是内存爆掉的解释。

## 改动

**A. 给 `runs` 加上限。** 保留全部未终结的 run + 最近 `MAX_FINISHED_RUNS` 个已终结的 run，淘汰更旧的已终结 run。
沿用仓里同形先例 `MAX_FINISHED_TASKS = 20`（`shared/task.api.ts:229`，taskRegistry 对已完成 task 用的就是这个形状），取同一个数量级。
裁剪点放在 `publish()` 之前，且**永不淘汰未终结的 run** —— 否则正在跑的 workflow 会从 UI 上消失。

**B. 写盘改成 latest-wins，不再 append 链节。** 已经排队但还没落盘的快照没有任何价值 —— 它会被下一份整个覆盖。
保留"最新一份待写内容"，有在途写入时只替换内容、不新增链节。这同时消掉无界闭包链和冗余磁盘写入。
`flush()` 的语义保持不变：等到最新一份内容真正落盘。

## 不做（本次刻意留下）

**广播频率不动。** 把每条日志行都广播全量快照改成增量/节流，能再省一个数量级，但那要改 renderer 侧的收敛契约（现在收到的是全量快照），
需要两个仓的渲染端一起验。A 已经把 n 封住、B 已经把链封住，**先量一次再决定要不要做频率**。
分开落是为了让"无界增长"和"更新频率"两件事各自可验证 —— 混在一起就说不清是谁带来的改善。

## 验收

- `runs` 长度在任何时刻 ≤ 未终结数 + `MAX_FINISHED_RUNS`，跨重启仍然成立（`restore()` 之后也要裁）。
- 正在运行的 workflow 永远不会被裁掉。
- 连续高频 publish 时，在途写入链节数恒 ≤ 1；`flush()` 之后磁盘内容等于最后一次 publish 的快照。
- `list()` / `restore()` / 已有 workflow 测试全部保持通过。

## 验证

单元/源码测试、typecheck、仓内守卫。**不启动 Electron、不跑 E2E、不打包**（仓规：未经要求不得自行启动 Electron）。
