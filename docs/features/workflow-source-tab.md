# Workflow 预览第三个 tab —— `Source` 原文

**状态:** 🚧 **实现中**(2026-09-18)。**来源:** Ral 2026-09-18 ——
「首先优化 cowork 和 bl 的 workbench workflow 展示, flow details 后补充 pure text 原文 tab」。

**配对:** 本功能是共用能力,`micromeet-cowork` 同步实现 ——
[`micromeet-cowork/docs/features/workflow-source-tab.md`](../../../micromeet-cowork/docs/features/workflow-source-tab.md)。
两侧**契约相同**,只在各自既有的类型形状与命名上适配。

---

## 0. 现状:两个 tab,而且"原文"根本没送到渲染端

Workbench 的 workflow 预览现在只有两个 tab:

| tab | 显示什么 | 数据来自 |
| --- | --- | --- |
| `flow` | 作者提供的流程图 | `manifest.graph`(节点 + 边) |
| `details` | 包元数据(引擎 / 修订 / 大小 / SHA-256 / 入口文件名) | 快照 + `manifest` |

**两个 tab 都读不到工作流本身写了什么。** 流程图是作者手写的示意,`details` 里的
`entry` 只是一个**文件名**。真正的定义 —— 那份会被引擎执行的脚本 —— 渲染端从来没拿到过。

关键事实,不认它会做出一个空白的 tab:

| 直觉 | 代码事实 |
| --- | --- |
| `entry` 字段里就是原文 | **不是。** 它是路径。bl:`workflowPackageStorage.ts` 里 `entry: join(this.root, row.directory, manifest.entry)` —— 绝对路径。cowork:`InstalledWorkflow.entryPath`,同样是路径 |
| 渲染端自己读文件就行 | 渲染端没有 `fs`。文件在 userData 下的安装目录里,只有 main 够得着 |
| 那把原文塞进快照 | 快照列的是**整个库**的每一个 workflow。把每份脚本都塞进去,等于每次刷新都把全部源码搬一遍,而用户绝大多数时候不看 |

> 所以正确形状是:**第三个 tab 按需拉一次** —— 切到 tab 才向 main 要,main 读那一个入口文件,
> 带上限地回给渲染端。不进快照,不预读。

---

## 1. 契约(两仓一致)

新增一个懒取接口。参数用各仓既有的选中标识(bl 是 `ref`,cowork 是 `reference`),不新造一套。

```ts
export interface WorkflowSource {
  path: string        // 入口文件的绝对路径,给"在访达中显示"之类的后续动作留的
  name: string        // manifest.entry,即包内相对文件名
  text: string        // 原文。未命中上限时是完整内容
  bytes: number       // 文件在磁盘上的真实字节数(不是 text 的长度)
  truncated: boolean  // true ⇒ text 只是前 MAX_SOURCE_BYTES 字节
}
```

```ts
// 加进各仓既有的 WorkflowLibraryApi
source(params: { /* bl: ref */ /* cowork: reference */ }): Promise<Reply<WorkflowSource>>
```

**上限 `MAX_SOURCE_BYTES = 256 * 1024`。** 工作流脚本正常是几 KB;256 KB 足够宽松,又不至于
让一个畸形包把渲染端卡死。

> ⚠️ **超限必须显式说出来,不许静默截断。** `truncated: true` 时界面上要有一行明说"只显示了前
> 256 KB",否则用户会把截断的脚本当成完整的脚本去读 —— 那比不显示更糟。

**读取规则:**

- 只读**已安装**的包。没装的工作流没有原文可读,返回一个可读的错误,不是空字符串。
- 路径必须落在该包的安装目录内(沿用两仓现有的 `safePackagePath` 同类约束),防止 manifest 里
  的 `entry` 用 `../` 穿出去。
- 以 `utf8` 读。二进制入口文件不在支持范围内 —— 真遇到就报错,不要把乱码当原文渲染。

---

## 2. UI

第三个 tab 排在 `details` **之后**,标识 `source`。

```
┌─ 流程 │ 详情 │ 原文 ─────────────────── r12 / 已安装 r12 ─┐
│                                                          │
│  workflow.mjs · 3.4 KB                        [复制原文]  │
│  ┌────────────────────────────────────────────────────┐  │
│  │ export const meta = { name: 'intake', … }          │  │
│  │ …                                                  │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

- **纯文本,不高亮、不折叠、不编辑。** Ral 的原话是 "pure text 原文" —— 这个 tab 的价值就是
  「所见即磁盘上那份」。加语法高亮就要引一个 highlighter,并且高亮器认错语言时会改变观感;
  加编辑会把一个只读视图变成一个需要保存语义的东西。都不做。
- 容器 `overflow: auto`,长行**不换行**(`white-space: pre`)—— 脚本的缩进是有意义的。
- 三个状态各有明确呈现:**未安装**(提示先下载)· **加载中**(spin)· **读失败**(错误 + 重试)。
  空字符串**不是**成功 —— 0 字节的入口文件按错误报。
- 顶部一行显示 `name` 与 `bytes`;`truncated` 时在同一行追加截断说明。
- 复制按钮复制 `text`(截断时复制的也只是截断的那部分,按钮文案要说明)。

### 无边框

按工作区的 *Borderless UI* 规则:tab 条与代码块**不用 border 表达层级** ——
代码块靠背景色与圆角与正文分开,tab 的选中态靠背景/字重,不靠下划线以外的框线。
复制按钮是无边框 icon 按钮。

---

## 3. 各仓落点

两仓结构历史上就不同,契约相同、落点不同。**不要为了对齐去重构任何一边既有的形状。**

| | `micromeet-cowork` | `bitterless` |
| --- | --- | --- |
| tab 状态字段 | `workflowLibrary.store.ts` 的 `tab` | `workflowLibrary.store.ts` 的 `activeTab` |
| 选中标识 | `reference` | `ref` |
| 安装物 | 快照项上的 `installed.entryPath` | `preview()` 回的 `detail.entry` |
| 契约文件 | `src/shared/workflowLibrary.api.ts` | `src/shared/workflowLibrary.type.ts` |
| main 服务 | `src/main/workflowLibrary/workflowLibrary.service.ts` | 同名 |
| xpc handler | `src/main/xpc/workflowLibrary.handler.ts` | 同名 |
| 视图 | `renderer/workbench/src/views/WorkflowLibraryView.vue` | `renderer/maestro/workbench/src/views/WorkbenchWorkflowsView.vue` |
| 文案 | `workflowLibrary.messages.ts`(en · zh-CN · zh-TW · id) | `renderer/common/i18n/{en,zh}.ts` 的 `workflowLibrary` |

**文案键(两仓同名):** `source` · `sourceEmpty` · `sourceTruncated` · `sourceFailed` ·
`sourceNotInstalled` · `copySource` · `sourceCopied`。

---

## 4. 验收

| 判据 | 怎么测 |
| --- | --- |
| 第三个 tab 出现在 `details` 之后,两仓都有 | 打开 workbench workflow,看 tab 条 |
| 选中已安装工作流 → 原文与磁盘上的入口文件逐字节一致 | 读 `path`,与界面文本比对 |
| 切 tab 才发请求,快照不含原文 | 不开 `source` tab 时,快照 payload 里没有脚本内容 |
| 未安装 → 明确提示,不是空白 | 选一个未下载的工作流 |
| 超 256 KB → `truncated: true` 且界面明说 | 合成一个超限入口文件 |
| 换一个工作流后原文跟着换,不留上一个的 | 连续点两个已安装工作流 |
| 0 字节入口文件报错而不是显示空白 | 合成一个空入口文件 |

> **读到空必须失败,不能通过。** 一个"成功但内容为空"的原文 tab 和一个真的空文件长得一模一样,
> 而前者是缺陷。
