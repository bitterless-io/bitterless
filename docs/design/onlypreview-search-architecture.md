# OnlyPreview 搜索与 Preview 视图边界

> **历史设计快照（2026-08-10，`0728afb`）**：本文原样保留当日基于 Main
> `buildIndex`/`listDirectory` 与单 Renderer 迁移讨论的决策过程和用户意图；它不再描述当前
> Runtime。后续 012–016 已把搜索、SQLite 双层索引、硬排除、watch 和完整按需目录浏览收敛到
> 专用 UtilityProcess，Main 仅校验并转发。当前事实以
> [`docs/features/onlypreview.md`](../features/onlypreview.md) 和
> [`docs/plan/analysis/onlypreview.md`](../plan/analysis/onlypreview.md) 为准；本文保留下来的产品
> 合同是“浏览不被搜索索引裁剪”和“构建期间仅显示 Project 底部 2px 无文案进度 rail”。

本文决定 OnlyPreview 的当前文件查找、项目全文搜索与 Preview 渲染边界。口径：文件系统
权限、内容读取和项目索引继续由 Main 持有，Renderer 只接收能力化结果。姊妹文档：
[`onlypreview.md`](../features/onlypreview.md)（已接受的产品与安全合同）、
[`onlypreview.md`](../plan/analysis/onlypreview.md)（现有交付分解）。核对日期 2026-08-10，
依据：实码 `src/main/windows/onlyPreviewWindow.helper.ts`、
`src/main/onlypreview/onlyPreviewIndex.service.ts`、`src/renderer/onlypreview/`。

## #0 · 总纲：搜索不是一个输入框

| 目标 | 判据（怎么算达成） | 现状 |
|---|---|---|
| G1 项目全文搜索 | `Shift+Cmd+F` 查询受支持文件的路径与内容；结果可稳定定位到文件和匹配位置 | ❌ 目前只有路径元数据索引 → [#1](#1--根因判断-已定-2026-08-10--已实施) |
| G2 当前文件查找 | `Cmd+F` 只查当前 Preview，支持上一处、下一处和关闭 | ❌ Preview 类型没有统一 Find contract → [#3](#3--目标搜索流-已定-2026-08-10--未实施) |
| G3 结果跳转 | 选择项目搜索结果后打开文件，并让相应 Preview 定位和高亮匹配 | ❌ 现有 selection 只携带文件引用 → [#3](#3--目标搜索流-已定-2026-08-10--未实施) |
| G4 权限不扩张 | Renderer 不持有绝对路径；全文索引、查询和读取均重进 workspace/realpath 校验 | ✅ 现有能力模型可复用 → [#4](#4--迁移边界-已定-2026-08-10--未实施) |

当前必须先定的是 Preview 是否继续作为兄弟 `WebContentsView`。搜索文件范围、索引持久化和
排序细节可以在视图边界确定后单独设计，不应反过来绑架这一决策。

## #1 · 根因判断 `已定 2026-08-10` · `已实施`

| 现状事实 | 实码依据 | 对搜索的影响 |
|---|---|---|
| Main 的 `buildIndex()` 只生成名称、相对路径、类型、大小和修改时间 | `src/main/onlypreview/onlyPreviewIndex.service.ts`、`src/shared/onlypreview/onlyPreview.types.ts` | 项目全文搜索没有内容数据源；这与 Preview 在哪个 View 无关 |
| `resolveNativeCommand()` 没有 `Cmd+F` 或 `Shift+Cmd+F` | `src/main/windows/onlyPreviewWindow.helper.ts` | 当前快捷键不响应是未定义命令，不是 Electron 无法跨 View |
| 双击 Shift 只把焦点送到 Shell 的路径搜索框 | `OnlyPreviewWindowHelper.bindNativeShortcuts()`、`ONLY_PREVIEW_FOCUS_SEARCH_EVENT` | 现有“搜索”实际是 bounded path search，不是全文搜索 |
| Shell 与 Preview 使用同一个 content host capability | `OnlyPreviewWindowHelper.ensureStandalone()`、`createView(host, mode)` | 分 View 没有形成更窄的文件读取权限边界 |
| 选区字符数已经通过 host-scoped event 从 Preview 回到 Shell | `onlyPreviewCharacterCountGate.service.ts` 与两侧 store | 跨 View 命令可做，但每增加一种交互都要再造协议、状态与竞态围栏 |

> 结论：独立 Preview View **不是项目全文搜索缺失的根因**。根因是尚无 Main-owned 内容索引与
> 查询合同。但是，双 View 会让当前文件查找、结果跳转、高亮、焦点、快捷键和无障碍形成持续的
> 跨 View 协调成本。

## #2 · 单 Renderer 组件架构 `已定 2026-08-10` · `未实施`

| 边界 | 已定做法 | 原因 |
|---|---|---|
| OnlyPreview 主工作区 | 只保留一个 Shell `WebContentsView` | 菜单、目录、搜索、Preview、状态共享一个 DOM、焦点树和状态图 |
| 文件类型渲染 | `PreviewSurface` 按 descriptor 只挂载一个当前组件 | code/text、Markdown、PDF、image、audio、video、unsupported 各自维护渲染细节，不并行占用资源 |
| 搜索 UI | Shell 持有一个项目搜索面板和一个当前文件 Find Bar | 不向兄弟 View 注入插件或 UI；当前组件只注册查找/跳转 adapter |
| 重型组件 | Monaco、PDF.js 按需 lazy-load，切换文件即 dispose/cancel | 控制单 renderer 的启动体积、内存和事件循环压力 |
| Settings | 继续使用独立 `BrowserWindow` | 它是独立顶层窗口，不参与主工作区搜索、焦点或 Preview 组合 |

本轮决定：把 `PreviewSurface` 合并进 Shell，再做全文搜索
(Ral 2026-08-10「不再用单独的渲染进程，直接一个渲染进程中增加一个多个组件去渲染各种页面」)。
这不是因为全文搜索技术上必须合并，而是因为当前两个 View 共享同一能力权限；继续增加
`Cmd+F`、`Shift+Cmd+F`、搜索结果跳转和高亮，会把一次迁移成本摊成长期协议成本。

主要 tradeoff：Monaco 或 PDF 的重任务将与目录树共享一个 renderer event loop。合并方案必须保留
现有取消/generation fencing，并用分段渲染和真实性能测试控制卡顿；如果实测仍阻塞 Shell，才以
“重型 Preview 隔离”为明确目标重新拆 View。

组件不各自注入一套搜索 UI。Shell 只渲染一个 Find Bar，当前 Preview 组件注册最小 adapter：

```ts
interface OnlyPreviewFindAdapter {
  find(query: string): OnlyPreviewCurrentFileMatch[];
  reveal(matchId: string): void;
  clear(): void;
}
```

Monaco adapter 查询 model，Markdown adapter 查询文章 DOM，PDF adapter 查询 PDF text content；
无文本语义的媒体组件不注册 adapter。该接口描述组件协作边界，不把绝对路径或文件读取权交给
Renderer。

已否的备选：继续使用独立或混合 Preview `WebContentsView` →
[#rejected](#rejected--已否留档)。

## #3 · 目标搜索流 `已定 2026-08-10` · `未实施`

### `Shift+Cmd+F`：项目全文搜索

```text
1. Shell 捕获 Shift+Cmd+F，打开项目搜索面板
        ↓
2. Shell 发送 { workspaceId, query, revision } 给 Main search service
        ↓
3. Main 查询内容索引，返回能力化的 { relativePath, matchRanges, excerpt }
        ↓
4. 用户选中结果，Shell 切换文件并把 match location 交给 Preview adapter
        ↓
5. Preview adapter 定位并高亮；stale revision 结果被丢弃
```

### `Cmd+F`：当前文件查找

| Preview 类型 | 查找所有权 | 最小行为 |
|---|---|---|
| Monaco text/code | Monaco adapter | 打开内建查找、下一处、上一处、关闭 |
| Markdown DOM | Markdown adapter | 只查文章正文并定位高亮，不搜索 Shell chrome |
| PDF.js | PDF adapter | 查 PDF text content 并跳页/高亮 |
| image/audio/video/unsupported | Preview surface | 明确不支持当前文件文本查找，不创建假结果 |

项目搜索和当前文件查找必须是两条合同。不能用 `webContents.findInPage()` 扫整个 Shell 页面来代替
当前文件查找，否则目录树、文件头和状态栏文字也会进入命中集，Monaco 的虚拟化模型也无法由普通
DOM 页面查找完整覆盖。

## #4 · 迁移边界 `已定 2026-08-10` · `未实施`

| 动作 | 范围 |
|---|---|
| 保留 | Main workspace capability、realpath containment、文件描述/读取、asset scheme、目录浏览索引、PreviewSurface 及各文件类型组件 |
| 移入 Shell | Preview store、PreviewSurface、Monaco/Markdown/PDF/media 渲染、选区字符数状态 |
| 删除 | 兄弟 `previewView` 生命周期与 bounds XPC、Preview renderer entry、跨 View selection-count 同步协议 |
| 新增 | Main-owned 内容索引/查询服务、项目搜索结果类型、Shell search panel、统一 Preview find/jump adapter |
| 不新增 | Renderer 绝对路径权限、文件写入、用页面 DOM 充当项目索引、依赖 native View 边界的搜索逻辑 |

目标结构：

```text
BaseWindow
└── Shell WebContentsView
    ├── MenuBar
    ├── Project tree + project full-text search
    ├── PreviewSurface + current-file find adapter
    └── selected-file metadata rail

Main
├── workspace/file capability services
├── complete demand-loaded directory browsing
└── metadata + content search index

Settings BrowserWindow
```

## #pending-questions · 待定项

| id | 项 | 所在 | 类型 | 阻塞性 | 倾向 / 拍板需要什么输入 | 状态 |
|---|---|---|---|---|---|---|
| **PQ-1** | Preview 是否在全文搜索实现前合并进 Shell？ | [#2](#2--单-renderer-组件架构-已定-2026-08-10--未实施) | 待拍板 | **阻塞定案** | **选定合并**。tradeoff：简化所有搜索/焦点/跳转协议，但 Monaco/PDF 不再有独立 renderer 隔离 | **已定 2026-08-10**（Ral「不再用单独的渲染进程，直接一个渲染进程中增加一个多个组件去渲染各种页面」）—— 接受推荐。**连带效应**：[#2](#2--单-renderer-组件架构-已定-2026-08-10--未实施)、[#3](#3--目标搜索流-已定-2026-08-10--未实施)、[#4](#4--迁移边界-已定-2026-08-10--未实施) 同时从待定翻为已定；兄弟/混合 Preview View 沉入 [#rejected](#rejected--已否留档)；方案可移交交付流程 |

已定：根因判断、单 Renderer 组件架构、两条搜索流和迁移边界。
收敛记账：账本 1 行 · 已解 1 行 · 待拍板 0 行 · 未解的 `阻塞定案` **0 条（由 1 降至 0）**。
本设计可以移交下游；工程态仍为未实施，不能把设计定案误读成能力已经存在。

## #rejected · 已否留档

### 独立或混合 Preview `WebContentsView` `已否 2026-08-10`

| 项 | 留档 |
|---|---|
| 所属决策章 | [#2 单 Renderer 组件架构](#2--单-renderer-组件架构-已定-2026-08-10--未实施) |
| 原方案 | Shell 和 Preview 使用兄弟 `WebContentsView`；或只把文本/Markdown 合入 Shell，继续用独立 View 渲染 PDF/媒体。搜索、跳转、焦点和状态通过 host/revision-scoped event 在 View 间同步 |
| 否决理由 | 当前两个 View 共享同一个 content host capability，没有形成更窄的读取权限；分离却要求每种搜索与交互持续新增 bridge、状态围栏和注入 UI。混合方案还会长期保留两套焦点与查找路径 |
| 复议触发条件 | 合并后有真实性能测试证明：在 lazy-load、dispose/cancel、分段渲染或 worker 后，Monaco/PDF 仍持续阻塞 Shell；或安全模型改为 Preview 独立、更窄的 capability。满足其一时，可按明确的隔离目标重新拆 View |

---

实现侧路径：`src/main/windows/onlyPreviewWindow.helper.ts`、`src/main/onlypreview/`、
`src/shared/onlypreview/`、`src/renderer/onlypreview/shell/`、
`src/renderer/onlypreview/preview/`。本文只负责搜索与 View 边界决策；已接受的安全和产品合同仍以
`docs/features/onlypreview.md` 为准，定案后的具体交付由 `docs/plan/tasks/` 承接。
