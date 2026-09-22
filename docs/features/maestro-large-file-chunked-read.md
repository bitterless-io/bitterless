# FEATURE · 大文件的读取闸、位置标记与分片

> Ral 2026-09-11 提出，2026-09-12 记录待办：「当一个文件太大，例如占用空闲提示词的大部分的时候，
> 就可以触发压缩再去读，或者按用户意图分片去读一个文件，并总结（并标记位置，例如读了 1-1000 行、
> 1001-2000 行），免得上下文不够导致 agent 无法读大文件」
>
> **Ral 2026-09-22 指定实现三项**：`read_file` 的输出闸（#1）、截断提示（#2）、
> 文档全文缓存 + 翻页（#3）。触发判据与读后总结仍未实现，见 #4。
>
> 依据与实测：`overmind:areas/agent-runtime/chat/file-reading.html`。

## 状态

| # | 项 | Cowork | BL |
|---|---|---|---|
| 1 | 输出闸：**字节 ∧ 行**双闸，口径对齐 pi 内置 `read` | implemented 2026-09-22 | implemented 2026-09-22 |
| 2 | 截断提示带**坐标 + 下一步**（含单行超限的 bash 兜底） | implemented 2026-09-22 | implemented 2026-09-22 |
| 3 | 全文缓存 + 翻页 | 已有（本次修掉文本路的 2000 行天花板） | implemented 2026-09-22（本次新建） |
| 4 | 读取前看剩余窗口（触发判据） | 未实现 | 未实现 |
| 5 | 分片后总结（读一片摘一片） | 未实现 | 未实现 |

## 为什么 —— 现场证据

2026-09-22 的一次真实会话（导出 `20260922100230249-z3d9wxk5dsmuc147gy`，
用 `gpt-tokenizer/o200k_base` 实测）：

```
read_file { path: "…_V6_2026-09.html", limit: 2000 }
→ 120,049 字符 / 72,541 token，其中 96% 是内嵌 base64 字体
→ …[truncated: output exceeded 120000 characters]        ← 文档正文一个字都没到
```

那份文件只有 **150 行**，所以 `limit: 2000` 毫无约束力；最长两行分别是 64,435 和 51,595 字符
（`@font-face` 的 base64）。**行不是它的计量单位，字节才是。**
同一份文件按 pi 的双闸只会给出 lines 1–140（3,839 字符 / **1,142 token**）
外加一句 `use offset=141`，再在 141 行上返回「这行 62.9KB 超限，用 `bash: sed -n`」——
那正是模型兜了一大圈才自己想到的下一步。

第二条证据（Cowork 内部，2026-09-02 已记录）：一份 493k 字符的 docx 只有前 24% 可读，
而模型拿着那 24% 写了一份读起来很完整的总结。**没有坐标的截断比报错更危险。**

## #1 输出闸 —— 字节 ∧ 行，先撞先赢

单次 `read_file` 能进上下文的量由**两个**上限共同决定，谁先撞到谁生效：

| 闸 | 值 | 出处 |
|---|---|---|
| 行 | `MAX_READ_LINES = 2000` | 与 pi `tools/truncate.js:10` 同值 |
| 字节 | `MAX_READ_BYTES = 50 * 1024` | 与 pi `tools/truncate.js:11` 同值 |

- **永不返回半行。** 累计字节超限时在行边界停下。
- **字节而不是字符**，因为 token 成本跟字节走而不跟字符走：120k 字符对普通中英文约 30–40k token，
  对 base64 是 72k。50KB 无论 ASCII 还是 CJK 都落在 12–17k token，这正是字节作为单位的理由。
- 旧的 `MAX_OUTPUT_CHARS = 120_000` 退为 **anydoc 转换阶段**的工作上限，不再是进上下文的闸。
- 闸只在**一个**函数里：`files/readGate.ts` 的 `applyReadGate()`。文本路与文档路共用它，
  所以「一个工具两套闸门」不会再长回来。

## #2 位置标记 —— 截断即坐标

`applyReadGate()` 的三种返回，逐字：

**a. 正常截断** —— 带下一次的 `offset`，并明确禁止据此总结：

```
…[PARTIAL: lines 1-140 of 3271 (50.0KB limit). The REST IS AVAILABLE — call read_file
again with offset=141 to continue. Do NOT summarise from this fragment alone; either page
through it or say which part you read.]
```

括号里的原因三选一：`(50.0KB limit)` / `(2000-line limit)` / 无（调用方自己的 `limit` 先到）。

**b. 单行就超过字节闸** —— 不返回任何内容，改给可执行的下一步（pi `tools/read.js` 的同款）：

```
[Line 141 is 62.9KB, exceeds 50.0KB limit. Use bash: sed -n '141p' <path> | head -c 51200]
```

这一条是本次改动里唯一会让 `read_file` **不返回内容**的分支。它是对的：那一行是 base64，
读进来的 72k token 价值为零，而这句话把模型直接送上它最终自己找到的那条路。

**c. offset 越界** —— `(file has N lines; offset M is past the end)`，与既有话术一致。

被删掉的是 `…[truncated: output exceeded 120000 characters]` —— 它既没有坐标也没有下一步。

## #3 全文缓存 + 翻页

**缓存存全文，闸只在出口。** 这条顺序是整套机制成立的前提：先截后存等于把翻页焊死。

```
read_file(path, offset?, limit?)
  → documentReader.readDocumentForAgent
      ├─ 命中缓存 ─────────────────────────────┐
      └─ 未命中 → readFileForAgent(fullDocument: true)   ← 不截断
                   ├─ 文本路：全文逐行编号（1 起，tab 分隔）
                   └─ 文档路：anydoc → Markdown，上限 DOC_CACHE_MAX_CHARS = 2,000,000
                 → 写缓存（键 = path + mtimeMs + size + PARSER_VERSION + SCHEMA_VERSION）
                                                        │
      ← applyReadGate(全文, path, { offset, limit }) ←──┘
```

### Cowork 本次修掉的缺陷

`fullDocument: true` 以前**只对文档路生效**，文本路的 `formatText` 照旧按 2000 行 + 120k 字符截断
再写进缓存。后果：一个 10,000 行的文本文件，缓存里只有前 2000 行，
`read_file(offset: 3000)` 会回答「document has 2001 lines; offset 3000 is past the end」——
**一句听起来权威的错话**。现在 `fullDocument: true` 在两条路上都表示「不截断」。

### BL 本次新建

BL 此前没有缓存层：`anydocToMarkdown(absPath, { maxChars: MAX_OUTPUT_CHARS })` 直接转换，
所以一份长 docx **永远只有前 120k 字符可读**，且每次读都重新转换一遍。
本次移植 Cowork 的缓存 + 翻页（`docParseCache.service.ts` + `documentReader.service.ts`），
**不含** Cowork 的扫描件视觉兜底与百炼 relay —— 那是另一条历史落差，需 Ral 单独点名。

缓存参数（两边同值）：条数上限 500、目录上限 200MB、按写入时间淘汰最旧、同键并发只解析一次。

## #4 仍未实现

| 项 | 卡在哪 |
|---|---|
| 读取前看剩余窗口 | pi 的 `execute(…, ctx)` 给 `ctx.model`，**不给 usage**；宿主侧 `inputBudget` 算得出，但要新开一条把剩余窗口送进工具的通路。比例取多少也没有实测。 |
| 按用户意图分片 | 意图从哪来未定：模型自己给 offset/limit，还是宿主按关键词定位（那等于半个 `grep`，而 `grep` 已经有了）。 |
| 分片后总结 | 与「不做边读边摘」的决定冲突：读一片摘一片会让模型永远拿不到原文。需 Ral 定。 |

三条的待定账本在 `overmind:areas/agent-runtime/chat/file-reading.html#pending`（PQ-1 ~ PQ-4）。

## 验证

- `yarn test:read-gate` —— `applyReadGate` 的契约测试：
  双闸先撞先赢、永不半行、首行超限走 bash 兜底、坐标连续（`offset=end+1` 能接上）、
  越界话术、调用方 `limit` 与闸共同作用时的原因标注。
- 不跑 Electron E2E（CLAUDE.md：非 Ral 当场要求不得自行启动）。

## 相关

- `docs/features/maestro-long-paste-to-file.md` —— 把内容推到磁盘、提示词只留路径，
  两条机制都把「读得动吗」转移给了读取侧，所以读取侧必须有边界。
- `micromeet-cowork:docs/features/agent-file-reading.md` —— `read_file` 的总契约（两边同形）。
- `overmind:areas/agent-runtime/chat/file-reading.html` —— pi 能力清单、实测与方案。
