# OnlyPreview 预览视图合并与文件内查找归属

本文决定 OnlyPreview 的预览视图边界、Preview header 组成，以及当前文件查找（`Cmd+F`）的归属。
核对日期 2026-08-18，依据实码：`src/main/windows/onlyPreviewWindow.helper.ts`、
`src/renderer/onlypreview/{shell,previewHeader,preview}/`、`src/preload/onlypreview/`、
`src/shared/onlypreview/onlyPreview.types.ts`。

**取代关系**：本文取代
[`onlypreview-search-architecture.md`](onlypreview-search-architecture.md) 中
[#2](onlypreview-search-architecture.md#2--单-renderer-组件架构-已定-2026-08-10--未实施)、
[#4](onlypreview-search-architecture.md#4--迁移边界-已定-2026-08-10--未实施) 与 `PQ-1`
关于「把 Preview 合并进 Shell 单 renderer」的已定决策（该决策从未实施）。那份文档的
[#1](onlypreview-search-architecture.md#1--根因判断-已定-2026-08-10--已实施) 根因判断、
[#3](onlypreview-search-architecture.md#3--目标搜索流-已定-2026-08-10--未实施) 的两条搜索流分工，
以及「不能用 `webContents.findInPage()` 顶替当前文件查找」的判据继续有效。
姊妹文档：[`features/onlypreview.md`](../features/onlypreview.md)（当前产品与安全合同，实施后由本轮任务同步）。

## #0 · 总纲：查找框必须和内容同进程

| 目标 | 判据（怎么算达成） | 现状 |
|---|---|---|
| G1 视图收敛 | 预览侧只剩 1 个 `WebContentsView`；header 与内容在同一 renderer | ❌ 今天是 Shell + PreviewHeader + PreviewContent 三个 → [#1](#1--决策preview-保持独立视图但-header-并入-已定-2026-08-18) |
| G2 header 组成 | header 同时承载文件名/相对路径/类型、文件操作、`Cmd+F` 查找框 | ❌ 今天 header 只有身份信息，文件操作散在内容体的错误/不支持态 → [#3](#3--header-组成-已定-2026-08-18) |
| G3 查找闭环 | 查询、匹配、高亮、上一处/下一处、计数全部在 Preview 进程内完成，不跨进程往返 | ❌ 查找能力尚不存在（`findbar` 在 `src/` 与 `docs/` 零命中）→ [#4](#4--查找归属与三类-adapter-已定-2026-08-18) |
| G4 协议不增反减 | 合并后跨视图 XPC 事件数量下降，且 Shell 仍是文件选择与状态栏字符数的唯一显示方 | ❌ 今天 header 是 render/reload 编排的中间人 → [#5](#5--协议收敛账-已定-2026-08-18) |

Shell 侧（MenuBar、文件树、文件搜索、全局搜索）本轮不改行为，见 [#6](#6--shell-侧本轮不动-已定-2026-08-18)。

## #1 · 决策：Preview 保持独立视图，但 header 并入 `已定 2026-08-18`

Ral 2026-08-18：「previewHeaderView previewView 先合并吧 …… shellview 是整个窗口的 mainview
menubar 文件树 文件搜索 和全局搜索」。

| 备选 | 处置 | 依据 |
|---|---|---|
| Shell + Preview（header 并入 Preview） | **已定** | 查找框与内容同 DOM、同 selection tree，查找闭环无需任何新协议 |
| 全部合并进 Shell 单 renderer（2026-08-10 已定） | 已否 → [#rejected](#rejected--已否留档) | Monaco/PDF 重任务会与文件树共享事件循环，而这次要解决的查找问题并不要求合并 |
| 维持 Shell + Header + Content 三视图 | 已否 → [#rejected](#rejected--已否留档) | 查找框若落在 Header 视图，每次按键、匹配序号、高亮都要跨进程重造一套 host/revision 协议 |

三条支撑理由：

1. **查找是 DOM 局部操作。** 匹配定位靠 `Range`，高亮靠 `CSS.highlights`，计数靠同一棵
   selection tree。这些对象不可跨进程传递；跨视图只能传字符串与序号，等于把一个局部操作拆成
   一套增量协议。现有的选区字符数三方 revision gate
   （`onlyPreviewCharacterCountGate.service.ts` + Shell/Header/Content 三边 store）就是这种成本的
   实例证据。
2. **原生视图会盖住 Shell 的 DOM。** [`features/onlypreview.md`](../features/onlypreview.md) 已记录
   Guide 不能做成 Shell 内的 DOM modal，因为兄弟原生视图会覆盖它。Find Bar 放 Shell 会遇到同一
   条约束，只能反向压缩 Preview bounds 才能露出来。
3. **保留重任务隔离。** Monaco 与 PDF.js 继续独占一个 event loop，文件树输入与滚动不被 PDF 分页
   渲染阻塞。这正是 2026-08-10 全合并方案自陈的主要 tradeoff。

已知代价：**全局搜索结果跳转仍跨视图**（Shell → Preview 传 `relativePath` + 匹配位置）。可接受，
因为它是一次性 payload，不是每次按键的往返。

合并**不改变任何能力面**：`src/preload/onlypreview/onlypreview.preload.ts` 与
`onlypreviewContent.preload.ts` 今天内容完全一致（都只有 `import 'electron-xpc/preload'` +
`exposeOnlyPreviewEnv()`），header 从 `onlypreview.js` 换到 `onlypreviewContent.js` 既不加宽也不
收窄桥面。

## #2 · 目标视图拓扑 `已定 2026-08-18`

```text
┌──────────────────────────── BaseWindow ───────────────────────────────┐
│ Shell WebContentsView                                                 │
│ ┌───────────────────────────────────────────────────────────────────┐ │
│ │ 32px Royal Blue MenuBar + platform window controls                │ │
│ ├──────────────────────┬────────────────────────────────────────────┤ │
│ │ 文件树 / 文件搜索    │ preview host placeholder                   │ │
│ │ 全局搜索结果         │                                            │ │
│ │ ━ 2px index rail     │                                            │ │
│ ├──────────────────────┴────────────────────────────────────────────┤ │
│ │ selected-file metadata status（含选区字符数）                     │ │
│ └───────────────────────────────────────────────────────────────────┘ │
│                        ┌─────────────────────────────────────────────┐ │
│                        │ Preview WebContentsView                     │ │
│                        │ ┌─ 43px header（DOM，不再是原生视图）─────┐ │ │
│                        │ │ 文件名/路径 · 类型 · 文件操作 · 查找框  │ │ │
│                        │ ├─────────────────────────────────────────┤ │ │
│                        │ │ content：MD/HTML/Monaco/PDF/媒体        │ │ │
│                        │ └─────────────────────────────────────────┘ │ │
│                        └─────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────────┘

Main capability/XPC supervisor ── private typed XPC ── hidden fileSearch renderer preload
Setting BrowserWindow · Agent Guide BrowserWindow（均不变）
```

| 项 | 合并前 | 合并后 |
|---|---|---|
| 预览侧原生视图 | `previewHeaderView` + `previewView` | 仅 `previewView` |
| bounds 切分 | Main 把 Shell 上报矩形的前 43px 分给 Header，余下给 Content | Main 只 clamp 一个矩形并整块交给 Preview；43px 变成 Preview 内部 CSS |
| renderer 入口 | `onlypreview/{shell,previewHeader,preview,settings,guide}` | `onlypreview/{shell,preview,settings,guide}` |
| Preview preload | Header 用 `onlypreview.js`，Content 用 `onlypreviewContent.js` | 统一 `onlypreviewContent.js` |
| DevTools 目标 | Shell / Header / Content | Shell / Preview |
| 沙箱与导航围栏 | 每个可见视图 `sandbox: true` + 精确导航围栏 | 不变 |

## #3 · Header 组成 `已定 2026-08-18`

```text
未激活查找：
┌ 43px ─────────────────────────────────────────────────────────────────┐
│ README.md  docs/features/README.md                    [MD] [⋯ 操作]  │
└───────────────────────────────────────────────────────────────────────┘

Cmd+F 激活后（高度不变，查找框占右段，路径按需截断）：
┌ 43px ─────────────────────────────────────────────────────────────────┐
│ README.md  docs/…      [ 🔍 preview        ] ‹ › 3/17 ✕   [MD] [⋯]   │
└───────────────────────────────────────────────────────────────────────┘
```

| 区域 | 内容 | 状态 |
|---|---|---|
| 身份 | 文件名 + 相对路径（路径可截断，完整值进 `title`） | 无选中文件时整条 header 不渲染身份区 |
| 类型徽标 | `language` → 扩展名大写 → `kind` 回退，沿用现有 `descriptorType` | 同上 |
| 文件操作 | `FileActions` 常驻 header（有选中文件时） | 内容体的错误态/不支持态不再重复挂一份 |
| 查找框 | 默认不渲染；`Cmd+F` 激活后展开，含输入、上一处/下一处、`n/m` 计数、关闭 | `Esc` 或关闭按钮收起并清除高亮 |

header 高度保持 43px，不因查找框展开而变化。

## #4 · 查找归属与三类 adapter `已定 2026-08-18`

`Cmd+F` 路由：Main 用现有 `before-input-event` 机制在 Shell 与 Preview 两个视图上都识别
`Cmd/Ctrl+F`，聚焦 Preview 视图并广播 host-scoped find-open 事件；Preview 内部按 descriptor 分发。
沿用 2026-08-10 的判据：**不使用 `webContents.findInPage()`** —— Monaco 虚拟化只把可视行放进 DOM，
普通页面查找无法完整覆盖。

| 类型 | 匹配源 | 定位 | 高亮 |
|---|---|---|---|
| Monaco 文本/代码 | `model.findMatches()` | Monaco 自带 find widget | Monaco decorations（自带，虚拟化安全） |
| Markdown / HTML | 遍历 `article` 内 text node，拼 flat text + offset 表 | 由 offset 反查 text node 建 `Range` | `CSS.highlights` |
| PDF | 每页 `page.getTextContent()` 全量缓存，与是否已渲染无关 | offset → (page, item, charOffset) → textLayer span 内 `Range` | `CSS.highlights` |
| `.docx` 文档（[021](../plan/tasks/onlypreview-docx-render-021.md)） | 渲染结果就是 DOM | 与 Markdown/HTML 同一个 DOM adapter | `CSS.highlights` |
| `.xlsx` 表格（[020](../plan/tasks/onlypreview-xlsx-grid-020.md)） | 解析后的单元格数据，不依赖 DOM | 命中 → 定位 sheet/行/列 → 滚动该单元格进视口 | 单元格级 active 样式（网格虚拟化，同 Monaco 自管一类） |
| image / audio / video / unsupported | 不注册 adapter | — | 查找框不激活，不产生假结果 |

Find Bar 控件（`已定 2026-08-18`）：输入框、**大小写敏感开关**、上一处/下一处、`n/m` 计数、关闭。
regex 与整词匹配回头再定（Ral 2026-08-18「要大小写开关，其他回头搞」）。大小写开关对三类 adapter
统一生效：Monaco 传给它自己的 find controller，DOM/PDF adapter 用它选择匹配比较方式。

adapter 契约（在 Preview 进程内部，不跨进程）：

```ts
interface OnlyPreviewFindAdapter {
  find(query: string, options: { caseSensitive: boolean }): number; // 返回匹配总数
  reveal(index: number): void;        // 滚动并把第 index 个匹配置为 active
  clear(): void;                      // 清除高亮与内部索引
}
```

**高亮一律用 CSS Custom Highlight API**（`CSS.highlights.set(name, new Highlight(...ranges))` +
`::highlight(name)` 样式），不插 `<mark>`。三条理由：Markdown/HTML 的宿主是 `v-html` 输出，插入
标签会在下一次渲染被抹掉；PDF 的 textLayer span 靠精确定位对齐 canvas，插入元素破坏定位与文本
选择；现有选区字符数统计依赖未被切裂的 text node。运行环境 Electron `40.10.6` 满足该 API 的
Chromium 门槛。当前匹配用第二个 highlight 名着色，跨 item/跨 node 的一个匹配用多个 `Range` 组成
一个 highlight。

PDF 的一个现成便利条件：`PdfPreview.vue` 目前顺序渲染全部页，所有 textLayer 都在 DOM 中，高亮可
直接落。若将来改虚拟滚动，规则变为「索引全量、高亮只对已渲染页、跳转前先确保该页渲染」，匹配层
不需要改动 —— 这是把匹配源与高亮层分开的回报。

不引入 pdf.js 的 `PDFFindController`：那是 viewer 栈组件，会带入 `EventBus`/`PDFViewer` 依赖，而本
项目只使用 core 的 `unpdf/pdfjs` + `TextLayer`。

## #5 · 协议收敛账 `已定 2026-08-18`

| 事件 / 契约 | 处置 | 说明 |
|---|---|---|
| `ONLY_PREVIEW_HEADER_METADATA_EVENT` | **删除** | header 直接读同进程的 preview store descriptor |
| `ONLY_PREVIEW_HEADER_SYNC_REQUEST_EVENT` | **删除** | 同进程无需启动期回灌 |
| `ONLY_PREVIEW_PREVIEW_CONTROL_EVENT` | **改向（保留）** | render/reload 的决策与执行同在 Preview 进程，Preview 不再订阅它；但 Shell 的字符数 gate 需要知道"某个 revision 的 transition 已开始"，尤其 watch 触发的 reload 其 revision 由 Preview 侧生成。因此该事件变成**单向 Preview → Shell 的 transition-started 通知**，Shell 侧处理逻辑不变 |
| `OnlyPreviewHeaderMetadata` 类型与其 5 字段校验 | **内化或删除** | 不再跨进程传输，无需 shape 校验 |
| watch commit（`ONLY_PREVIEW_SEARCH_WATCH_COMMIT_EVENT`）订阅方 | **迁移** | previewHeader store → preview store，`onlyPreviewWatchReload.service.ts` 一并迁移 |
| `ONLY_PREVIEW_CHARACTER_COUNT_*` | **保留** | Shell 状态栏仍显示字符数，Shell 仍是选择与 transition 的发起方 |
| `ONLY_PREVIEW_WORKSPACE_CHANGED_EVENT` / `ONLY_PREVIEW_REFRESH_EVENT` | **保留** | 仍由 Shell/Main 发起 |
| Preview bounds 上报 | **简化** | 一个矩形，不再由 Main 切 43px |

净效果：跨视图事件减少 2 条、1 条编排事件改为单向通知，并去掉一处「Header 作为 render/reload 中间人」
的三方时序。Shell 仍是选择与 transition revision 的发起方，Preview 仅在自己发起（watch reload）时生成
新 revision 并通知 Shell。

## #6 · Shell 侧本轮不动 `已定 2026-08-18`

MenuBar、文件树、文件搜索（本地过滤）、全局搜索（Project Search）全部留在 Shell，本轮不改其行为、
契约或视觉。Ral 2026-08-18：「文件搜索和全局搜索后需要优化」—— 优化目标尚未定义，记入
[PQ-2](#pending-questions--待定项)，不属于本文两个交付任务的范围。

## #pending-questions · 待定项

| id | 项 | 所在 | 类型 | 阻塞性 | 倾向 / 拍板需要什么输入 | 状态 |
|---|---|---|---|---|---|---|
| **PQ-1** | Find Bar 是否需要 regex / 大小写敏感 / 整词 开关 | [#4](#4--查找归属与三类-adapter-已定-2026-08-18) | 待拍板 | 非阻塞 | 原倾向：MVP 全不做 | **已定 2026-08-18**（Ral「要大小写开关，其他回头搞」）——MVP 含**大小写敏感开关**；regex 与整词延后，不进 019 |
| **PQ-2** | 「文件搜索与全局搜索需要优化」指哪一处 | [#6](#6--shell-侧本轮不动-已定-2026-08-18) | 待补输入 | 非阻塞 | 需要 Ral 指明范围 | **已澄清 2026-08-18**（Ral「指的是文件目录上的那个搜索，后面再讨论」）——目标是 Shell 文件树上的那个搜索（本地过滤 / Project Search 输入），**另开一轮讨论**，不属本文与 018/019 |

已定：视图拓扑、header 组成、查找归属与高亮机制（含大小写开关）、协议收敛账、Shell 侧不动。
收敛记账：账本 2 行 · 已解 2 行 · 待拍板 0 行 · 未解的 `阻塞定案` **0 条**。本文可移交交付流程；
工程态为未实施，不能把设计定案误读成能力已经存在。

预览格式覆盖（Excel / Word / 幻灯片 / 图片 / 音视频「渲染一切」）是另一条设计线，见
[`onlypreview-format-coverage.md`](onlypreview-format-coverage.md)。本文只管视图边界与查找归属。

## #rejected · 已否留档

### 全部合并进 Shell 单 renderer `已否 2026-08-18`（原 2026-08-10 已定）

| 项 | 留档 |
|---|---|
| 所属决策章 | [#1](#1--决策preview-保持独立视图但-header-并入-已定-2026-08-18) |
| 原方案 | 删除 `previewView`，把 PreviewSurface、Monaco/PDF/媒体渲染与选区字符数状态全部移入 Shell renderer，Find Bar 与文件树共享一个 DOM 与焦点树（`onlypreview-search-architecture.md` #2/#4） |
| 否决理由 | 该方案的收益是「所有搜索/焦点/跳转协议简化」，但 header 并入 Preview 已经拿到查找闭环这份收益；剩下的只有它自陈的 tradeoff：Monaco/PDF 与文件树共享 event loop。全局搜索结果跳转的跨视图 payload 是一次性的，不构成持续协议成本 |
| 复议触发条件 | Find Bar 或查找结果需要与文件树共享同一焦点/选择行为；或 Preview 原生视图的覆盖特性成为布局阻碍（例如需要跨越 header 与树的浮层） |

### 维持三视图并跨进程查找 `已否 2026-08-18`

| 项 | 留档 |
|---|---|
| 所属决策章 | [#1](#1--决策preview-保持独立视图但-header-并入-已定-2026-08-18) |
| 原方案 | 保留 PreviewHeader 视图，Find Bar 放 Header 或 Shell，查询经 XPC 打进 Content 进程，回传 `{ total, activeIndex }`，用 host/revision 围栏防 stale（协议形状照抄选区字符数 gate） |
| 否决理由 | 匹配算法在两种拓扑下完全相同，跨进程那一层是纯增量成本，不换来任何查找能力；且 Find Bar 与内容分处两个视图后，焦点、`Esc`、失焦收起、高亮清理都要各自再造一遍 |
| 复议触发条件 | header 需要独立于内容渲染的崩溃隔离（例如内容进程被证明会频繁 `render-process-gone`，而 header 必须保持可用） |

---

实施侧路径：`src/main/windows/onlyPreviewWindow.helper.ts`、`src/renderer/onlypreview/preview/`、
`src/renderer/onlypreview/previewHeader/`（删除）、`src/shared/onlypreview/onlyPreview.types.ts`、
`electron.vite.config.ts`、`src/main/logging/logPolicy.service.ts`、
`scripts/renderer-i18n/check-renderer-i18n.mjs`。
交付任务：[onlypreview-preview-header-merge-018](../plan/tasks/onlypreview-preview-header-merge-018.md)（合并）、
[onlypreview-find-in-file-019](../plan/tasks/onlypreview-find-in-file-019.md)（Find Bar 与三类 adapter）。
