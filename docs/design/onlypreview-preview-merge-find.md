# OnlyPreview 双预览视图与文件内查找归属

本文决定 OnlyPreview 的预览视图边界、Preview header 组成，以及当前文件查找（`Cmd+F`）的归属。

**状态：024 双 Preview Region 基础已实施、待 Ral 验证；021 DOCX 为
`implemented; owner verification pending`，已通过独立复核并等待 Ral 真实 DOCX 视觉/运行时验证；022
媒体真话态为 `implemented; owner verification pending`，已通过独立复核并等待 Ral 真实图片/音视频
视觉与运行时验证；019 当前文件查找为 `implemented; owner verification pending`，已通过
[独立复核 round 2](../plan/reviews/onlypreview-find-in-file-019-2.md) 并等待 Ral 运行时/视觉验证；025
设计收口的 [completion audit](../plan/reviews/onlypreview-design-completion-025-1.md) 已 **PASS**，当前为
`implemented; owner verification pending` · 开题
2026-08-18 · Ral 于 2026-08-20 指定本文已定内容为持续交付目标 · 未定且非阻塞的结论仍以
[#pending-questions](#pending-questions--待定项) 为准。**

核对日期 2026-08-20，依据实码：`src/main/windows/onlyPreviewWindow.helper.ts`、
`src/renderer/onlypreview/{shell,preview}/`、`src/preload/onlypreview/`、
`src/shared/onlypreview/onlyPreview.types.ts`、`package.json`；外部依据：Electron `v40.10.6`
API 与 Chromium `144.0.7559.236` PDF plugin 源码，见 [#7](#dual-preview-region)。

**取代关系**：本文取代
[`onlypreview-search-architecture.md`](onlypreview-search-architecture.md) 中
[#2](onlypreview-search-architecture.md#2--单-renderer-组件架构-已定-2026-08-10--未实施)、
[#4](onlypreview-search-architecture.md#4--迁移边界-已定-2026-08-10--未实施) 与 `PQ-1`
关于「把 Preview 合并进 Shell 单 renderer」的已定决策（该决策从未实施）。那份文档的
[#1](onlypreview-search-architecture.md#1--根因判断-已定-2026-08-10--已实施) 根因判断、
[#3](onlypreview-search-architecture.md#3--目标搜索流-已定-2026-08-10--未实施) 的两条搜索流分工，
以及「不能只用 `webContents.findInPage()` 覆盖 Monaco 等虚拟化内容」的判据继续有效；HTML 与
Chromium 内置 PDF 改用该 API，已在
[#7](#dual-preview-region) 定案。
姊妹文档：[`features/onlypreview.md`](../features/onlypreview.md)（当前产品与安全合同，实施后由本轮任务同步）。

## #0 · 总纲：预览隔离与文件内查找

| 目标            | 判据（怎么算达成）                                                                                               | 现状                                                                                                                                                      |
| --------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1 内容安全边界 | raw HTML/PDF 与带 XPC 的 Vue 子应用绝不共享 `WebContents` / preload / session                                    | ✅ 024 已实施独立 `WebContents`、preload 与 session 边界 → [#7](#dual-preview-region)                                                                     |
| G2 稳定 toolbar | 文件身份、操作与唯一 Find Bar 留在现有 `ShellView` 的 Preview toolbar，不进入被查找内容                          | ✅ 024 已实施固定 toolbar、身份与操作；019 已实施唯一 Find Bar → [#7.2](#shell-toolbar-dual-view)                                                         |
| G3 双内容 View  | HTML/PDF 由零 preload 的 `chromePreviewView` 原生加载；其余由 `vuePreviewView` 组件渲染                          | ✅ 024 已实施 → [#7.2](#shell-toolbar-dual-view)                                                                                                          |
| G4 查找路由     | Shell toolbar 发出统一命令，Main 按 active preview surface 路由至 `findInPage()` 或 Vue model adapter            | ✅ 019 已实施 Main capability registry、native/content adapter 路由与结果围栏 → [#7.4](#find-capability-routing)                                          |
| G5 切换隔离     | 两个 Preview view 永不同时 attach/可见；旧 find、model、worker、media、navigation 在新 revision ready 前完成清理 | ✅ 024 已实施互斥 attach 与 view teardown；019 已实施 find 清理，020/021/022 已分别实施 Office/媒体清理并等待 Ral 验证 → [#7.2](#shell-toolbar-dual-view) |

Shell 侧（MenuBar、文件树、文件搜索、全局搜索）本轮不改行为，见 [#6](#6--shell-侧本轮不动-已定-2026-08-18)。

## #1 · 历史决策：header 并入单 Preview view `已被 #7 取代`

> 本章与 #2～#5 只保留 2026-08-18 的现状依据和决策演进，不再是目标实现合同。凡与 #7 冲突，
> 一律以 #7 为准；重写 018 / 019 时不得从这些历史章复制旧拓扑或旧查找协议。

Ral 2026-08-18：「previewHeaderView previewView 先合并吧 …… shellview 是整个窗口的 mainview
menubar 文件树 文件搜索 和全局搜索」。

| 备选                                            | 处置                                       | 依据                                                                                    |
| ----------------------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------- |
| Shell + Preview（header 并入 Preview）          | 曾定，现由 [#7](#dual-preview-region) 取代 | 当时认为查找框与内容同 DOM 可省协议；新要求引入 Chromium 直出后前提失效                 |
| 全部合并进 Shell 单 renderer（2026-08-10 已定） | 已否 → [#rejected](#rejected--已否留档)    | Monaco/PDF 重任务会与文件树共享事件循环，而这次要解决的查找问题并不要求合并             |
| 维持 Shell + Header + Content 三视图            | 已否 → [#rejected](#rejected--已否留档)    | 查找框若落在 Header 视图，每次按键、匹配序号、高亮都要跨进程重造一套 host/revision 协议 |

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

> 2026-08-20 复议结论：Ral 将内容 renderer 明确拆成「HTML / PDF 原生直出」和「Vue 子应用组件渲染」
> 两类。Electron 的 preload / `webPreferences` 是 `WebContents` 构造期安全边界，不能由一个可导航
> content view 同时承担。因此 #1～#5 只描述 2026-08-18 的历史实现与决策，目标拓扑由
> [#7](#dual-preview-region) 取代；024 已完成该拓扑基础，019 已在其上实现当前文件查找。

## #2 · 当前已实现视图拓扑 `历史基线 2026-08-18`

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

| 项              | 合并前                                                         | 合并后                                                               |
| --------------- | -------------------------------------------------------------- | -------------------------------------------------------------------- |
| 预览侧原生视图  | `previewHeaderView` + `previewView`                            | 仅 `previewView`                                                     |
| bounds 切分     | Main 把 Shell 上报矩形的前 43px 分给 Header，余下给 Content    | Main 只 clamp 一个矩形并整块交给 Preview；43px 变成 Preview 内部 CSS |
| renderer 入口   | `onlypreview/{shell,previewHeader,preview,settings,guide}`     | `onlypreview/{shell,preview,settings,guide}`                         |
| Preview preload | Header 用 `onlypreview.js`，Content 用 `onlypreviewContent.js` | 统一 `onlypreviewContent.js`                                         |
| DevTools 目标   | Shell / Header / Content                                       | Shell / Preview                                                      |
| 沙箱与导航围栏  | 每个可见视图 `sandbox: true` + 精确导航围栏                    | 不变                                                                 |

## #3 · 历史 Header 组成 `已被 #7 取代`

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

| 区域     | 内容                                                                    | 状态                                  |
| -------- | ----------------------------------------------------------------------- | ------------------------------------- |
| 身份     | 文件名 + 相对路径（路径可截断，完整值进 `title`）                       | 无选中文件时整条 header 不渲染身份区  |
| 类型徽标 | `language` → 扩展名大写 → `kind` 回退，沿用现有 `descriptorType`        | 同上                                  |
| 文件操作 | `FileActions` 常驻 header（有选中文件时）                               | 内容体的错误态/不支持态不再重复挂一份 |
| 查找框   | 默认不渲染；`Cmd+F` 激活后展开，含输入、上一处/下一处、`n/m` 计数、关闭 | `Esc` 或关闭按钮收起并清除高亮        |

header 高度保持 43px，不因查找框展开而变化。

## #4 · 历史查找归属与三类 adapter `已被 #7 取代`

`Cmd+F` 路由：Main 用现有 `before-input-event` 机制在 Shell 与 Preview 两个视图上都识别
`Cmd/Ctrl+F`，聚焦 Preview 视图并广播 host-scoped find-open 事件；Preview 内部按 descriptor 分发。
沿用 2026-08-10 的判据：**不使用 `webContents.findInPage()`** —— Monaco 虚拟化只把可视行放进 DOM，
普通页面查找无法完整覆盖。

| 类型                                                                | 匹配源                                                  | 定位                                                          | 高亮                                                   |
| ------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------ |
| Monaco 文本/代码                                                    | `model.findMatches()`                                   | Monaco 自带 find widget                                       | Monaco decorations（自带，虚拟化安全）                 |
| Markdown / HTML                                                     | 遍历 `article` 内 text node，拼 flat text + offset 表   | 由 offset 反查 text node 建 `Range`                           | `CSS.highlights`                                       |
| PDF                                                                 | 每页 `page.getTextContent()` 全量缓存，与是否已渲染无关 | offset → (page, item, charOffset) → textLayer span 内 `Range` | `CSS.highlights`                                       |
| `.docx` 文档（[021](../plan/tasks/onlypreview-docx-render-021.md)） | 渲染结果就是 DOM                                        | 与 Markdown/HTML 同一个 DOM adapter                           | `CSS.highlights`                                       |
| `.xlsx` 表格（[020](../plan/tasks/onlypreview-xlsx-grid-020.md)）   | 解析后的单元格数据，不依赖 DOM                          | 命中 → 定位 sheet/行/列 → 滚动该单元格进视口                  | 单元格级 active 样式（网格虚拟化，同 Monaco 自管一类） |
| image / audio / video / unsupported                                 | 不注册 adapter                                          | —                                                             | 查找框不激活，不产生假结果                             |

Find Bar 控件（`已定 2026-08-18`）：输入框、**大小写敏感开关**、上一处/下一处、`n/m` 计数、关闭。
regex 与整词匹配回头再定（Ral 2026-08-18「要大小写开关，其他回头搞」）。大小写开关对三类 adapter
统一生效：Monaco 传给它自己的 find controller，DOM/PDF adapter 用它选择匹配比较方式。

adapter 契约（在 Preview 进程内部，不跨进程）：

```ts
interface OnlyPreviewFindAdapter {
  find(query: string, options: { caseSensitive: boolean }): number; // 返回匹配总数
  reveal(index: number): void; // 滚动并把第 index 个匹配置为 active
  clear(): void; // 清除高亮与内部索引
}
```

**高亮一律用 CSS Custom Highlight API**（`CSS.highlights.set(name, new Highlight(...ranges))` +
`::highlight(name)` 样式），不插 `<mark>`。三条理由：Markdown/HTML 的宿主是 `v-html` 输出，插入
标签会在下一次渲染被抹掉；PDF 的 textLayer span 靠精确定位对齐 canvas，插入元素破坏定位与文本
选择；现有选区字符数统计依赖未被切裂的 text node。运行环境 Electron `40.10.6` 满足该 API 的
Chromium 门槛。当前匹配用第二个 highlight 名着色，跨 item/跨 node 的一个匹配用多个 `Range` 组成
一个 highlight。

在 2026-08-18 的历史基线中，`PdfPreview.vue` 顺序渲染全部页，所有 textLayer 都在 DOM 中；024 已删除
该 Vue/pdf.js 活跃路径并改用 Chromium 内置 PDF viewer。此段仅解释旧方案为何曾可直接落高亮，不再是
当前实现依据。

不引入 pdf.js 的 `PDFFindController`：那是 viewer 栈组件，会带入 `EventBus`/`PDFViewer` 依赖，而本
项目只使用 core 的 `unpdf/pdfjs` + `TextLayer`。

## #5 · 历史协议收敛提案 `未实施 · 已被 #7 取代`

| 事件 / 契约                                                            | 处置           | 说明                                                                                                  |
| ---------------------------------------------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------- |
| `ONLY_PREVIEW_HEADER_METADATA_EVENT`                                   | **删除**       | header 直接读同进程的 preview store descriptor                                                        |
| `ONLY_PREVIEW_HEADER_SYNC_REQUEST_EVENT`                               | **删除**       | 同进程无需启动期回灌                                                                                  |
| `ONLY_PREVIEW_PREVIEW_CONTROL_EVENT`                                   | **024 删除**   | selection/watch/reload revision 已由 Main Region 统一生成，不再保留 renderer-authored transition 通道 |
| `OnlyPreviewHeaderMetadata` 类型与其 5 字段校验                        | **内化或删除** | 不再跨进程传输，无需 shape 校验                                                                       |
| watch commit（`ONLY_PREVIEW_SEARCH_WATCH_COMMIT_EVENT`）订阅方         | **迁移**       | previewHeader store → preview store，`onlyPreviewWatchReload.service.ts` 一并迁移                     |
| `ONLY_PREVIEW_CHARACTER_COUNT_CHANGED_EVENT` / `READY_EVENT`           | **保留**       | Shell 状态栏仍显示字符数，并用 Main 数字 selection revision 派生 reporting revision                   |
| `ONLY_PREVIEW_CHARACTER_COUNT_TRANSITION_EVENT` / `SYNC_REQUEST_EVENT` | **024 删除**   | 两条旧 UUID/revision 编排通道已被 Main presentation revision 取代                                     |
| `ONLY_PREVIEW_WORKSPACE_CHANGED_EVENT` / `ONLY_PREVIEW_REFRESH_EVENT`  | **保留**       | 仍由 Shell/Main 发起                                                                                  |
| Preview bounds 上报                                                    | **简化**       | 一个矩形，不再由 Main 切 43px                                                                         |

024 的实际收敛结果是：删除 Header metadata/sync、Preview control、character-count transition/sync
request；presentation broadcast 只发 `{ hostId }` nudge，Shell/Vue 各自向 Main capability API 重取真值。
Main 是唯一 selection revision writer，renderer 不能生成可被其他层接受的 revision。

## #6 · Shell 侧本轮不动 `已定 2026-08-18`

MenuBar、文件树、文件搜索（本地过滤）、全局搜索（Project Search）全部留在 Shell，本轮不改这些
功能的行为或契约。Ral 2026-08-18：「文件搜索和全局搜索后需要优化」—— 优化目标尚未定义，记入
[PQ-2](#pending-questions--待定项)，不属于本文两个交付任务的范围。2026-08-20 的目标拓扑会在
`ShellView` 的 Preview host 内增加固定 toolbar；这是 Preview chrome，不改变文件树或 Project Search。

2026-08-24 的后续输入已把本地文件树优化收敛为
[`onlypreview-filter-directory-reveal-031`](../plan/tasks/onlypreview-filter-directory-reveal-031.md)：
点击当前查询中可见的目录，将其作为本次查询的内部 reveal root，以 O(path depth) 的分段祖先
`Set.has()` 判断放行已加载后代；查询文本变化立即清空 root，不递归加载磁盘、不改变 Project Search。

<a id="dual-preview-region"></a>

## #7 · `chromePreviewView` 与 `vuePreviewView` 双内容视图 `已定 2026-08-20` `024 基础已实施`

Ral 2026-08-20 先要求「preview 可以渲染一切，例如 md、html、pdf……支持文字搜索就像 Chrome
那样」，随后最终拍板：「preview 分为 `vuePreviewView` 和 `chromePreviewView`；HTML、PDF 等适合
Chrome 直接渲染的都直接用 `chromePreviewView`，需要程序处理的用 `vuePreviewView`。」因此内容
renderer 明确分为两类，以下名称也是实现合同：

1. **`chromePreviewView`**：HTML、PDF 等 Chromium 能直接加载的内容。
2. **`vuePreviewView`**：代码、Markdown 等嵌入式内容，以及图片、音频、视频和 Office 等专用组件。

唯一 Find Bar、文件身份和文件操作放在已有 `ShellView` 的 Preview toolbar，不再创建第三个搜索
renderer。内容区域任一时刻只 attach / 显示上述两个 view 中的一个。

工程状态（2026-08-21）：024 已实施 Shell toolbar、互斥双 view、Main presentation owner、Vue runtime
capability/reset acknowledgement，以及离线 raw HTML/PDF 的 bounded protocol；019 已实施唯一 Find
Bar、Main-owned `findRevision`、native/content adapter 路由和 stale-result 清理，当前为
`implemented; owner verification pending`；
[独立复核 round 2](../plan/reviews/onlypreview-find-in-file-019-2.md) 已记录 **PASS**。020 已实现
renderer-local XLSX adapter，021 DOCX 已实施并
通过 [独立复核 round 2](../plan/reviews/onlypreview-docx-render-021-2.md)，当前等待 Ral 真实 DOCX
视觉/运行时验证；媒体/额外 guard 分别由 022/023 延伸。022 的
[独立复核 round 1](../plan/reviews/onlypreview-media-truthful-state-022-1.md) 曾因 renderer error family
授权过宽记录 **BLOCKED**，修复后
[独立复核 round 2](../plan/reviews/onlypreview-media-truthful-state-022-2.md) 已记录 **PASS**；其账本为
`implemented; owner verification pending`，当前等待 Ral 真实图片/音视频视觉与运行时验证。

021 的 DOCX capability 合同进一步冻结为：exact 25MiB asset 先 transfer 到 one-shot module Worker，
复用纯 OOXML preflight 并由 adapter 施加 10 秒 hard timeout；通过后才动态加载
`docx-preview@0.4.0`。`renderAsync()` 只写 detached body/style，使用固定关闭 altChunk/修订/批注、
开启页眉页脚、忽略内嵌字体、`useBase64URL: false`、关闭 experimental/debug 的 options。专用
DOM/CSS allowlist 必须在 mount 前完整扫描输出并登记所有 verified embedded blob URL；普通切换和
stale completion 正常 revoke，而 engine rejection、无法取得完整输出或 timeout 由 Main 销毁并重建
exact Vue view。Main 在 DOCX loading 且 view/runtime token 建立时一次性 arm 30 秒外部 watchdog，
reset/resize 不续期，旧 timer 受 revision/runtime/view fence 约束。若 selection 在 render pending
期间离开 DOCX，Main 立即关闭 exact 旧 Vue view 并旋转 runtime；只有 post-ready 切换才允许串行清理后
复用 view。`renderAsync()` 没有
`AbortSignal`，不得把 fenced stale result 描述成取消了 library call。文档 only 在 sanitized current
DOM 实际 mount + `nextTick` 后报告 ready；失败使用 `DOCUMENT_PARSE_FAILED`、`DOCUMENT_EMPTY`、
`DOCUMENT_SANITIZE_FAILED` 或 `DOCUMENT_RENDER_TIMEOUT`。019 只在该 exact ready 状态上启用
`findInPage()`。

### #7.1 · Electron 能力边界 `已定 2026-08-20`

| 能力                        | Electron `40.10.6` 事实                                                                                                                                                   | 对方案的含义                                                   |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| 原生跨 `WebContents` 输入框 | 不存在。`MenuItem` 只有 normal / separator / submenu / checkbox / radio / header / palette；公开 `View` 只有子视图、bounds、背景和可见性，没有 `TextField`                | 方案 1 不可用；输入框必须属于某个 renderer                     |
| 当前页查找 backend          | `webContents.findInPage(text, { forward, findNext, matchCase })` 作用于调用它的单个 `WebContents`；结果通过 `found-in-page` 返回当前序号与总数；关闭用 `stopFindInPage()` | Electron 提供查找 engine，不提供 UI，也不跨内容视图聚合        |
| Chromium 内置 PDF           | Electron maintainer 验证内置 PDF 可由 `webContents.findInPage()` 查找；同版本 Chromium PDF plugin 实现 `StartFind` / `SelectFindResult` / `StopFind`                      | 直接 PDF 预览无需自己重写 PDF 文本匹配与高亮，但扫描件仍需 OCR |
| 虚拟化内容                  | `findInPage()` 只查 Chromium 当前页可查找内容；Monaco / 虚拟网格的完整 model 不等于 DOM                                                                                   | Monaco、XLSX 等仍须内容 renderer 内的专用 adapter              |

外部依据（均核对于 2026-08-20）：

- Electron `v40.10.6` [`webContents.findInPage` API](https://github.com/electron/electron/blob/v40.10.6/docs/api/web-contents.md#L1421-L1444)、
  [`MenuItem` 类型](https://github.com/electron/electron/blob/v40.10.6/docs/api/menu-item.md#L212-L244)、
  [`View` 公共能力](https://github.com/electron/electron/blob/v40.10.6/docs/api/view.md#L195-L300)。
- Electron maintainer 2022-10-31：内置 PDF 可用 `findInPage()`，但 Cmd+F dialog 由 app 自己构建；
  2022-11-07 再确认该 dialog 从未属于 Electron 暴露的 Chromium 子集，见
  [issue #9030](https://github.com/electron/electron/issues/9030#issuecomment-1297830618)。
- Chromium `144.0.7559.236`
  [`pdf_view_web_plugin.cc`](https://chromium.googlesource.com/chromium/src/+/refs/tags/144.0.7559.236/pdf/pdf_view_web_plugin.cc#989)
  的 PDF find implementation。

<a id="shell-toolbar-dual-view"></a>

### #7.2 · Shell toolbar 与双 Preview View `已定 2026-08-20` `024 已实施`

| 角色                        | 生命周期与权限                                                                                                         | 内容                                                                   |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `ShellView` Preview toolbar | 复用现有 renderer；固定 43px；不在 content bounds 内                                                                   | 文件名/路径、类型、文件操作、唯一 Find Bar、通用缩放状态               |
| `chromePreviewView`         | 每个 HTML/PDF selection revision 懒创建新实例；**无 preload / XPC / Node / Electron**；任意选择变化即 detach + destroy | raw HTML（含本地相对 JS/CSS/图片）与 Chromium 内置 PDF viewer          |
| `vuePreviewView`            | 加载固定 Vue bundle；最小 typed XPC；可常驻但每次 selection 必须 reset                                                 | Monaco、Markdown、DOCX、XLSX、图片、音频、视频、unsupported/error 组件 |

```text
BaseWindow
├─ ShellView
│  └─ PreviewRegion DOM
│     ├─ 43px toolbar                  ← 始终露出
│     └─ content host placeholder
└─ content bounds（从 toolbar 下方开始）← 同时只 attach 一个
   ├─ chromePreviewView                ← HTML / PDF
   └─ vuePreviewView                   ← Vue 预览子应用
```

toolbar 不是浮动 `BrowserWindow`，也不是新的 `WebContentsView`；它属于现有 Shell DOM。Main 只把内容
view 的 bounds 放到 toolbar 下方，所以 native view 不会盖住输入框，`findInPage()` 也不会把输入框、
文件名或操作文案算成命中。视觉上仍是一块 Preview。

不能让一个 `previewView` 在 raw HTML/PDF 与 Vue bundle 之间来回导航：preload、sandbox、session
和 `webPreferences` 是构造期能力边界。共用会在两个错误中二选一——要么把 Vue 的 XPC bridge 带进
任意 HTML，要么让 Vue 子应用失去所需的 typed capability；导航还会反复销毁 Monaco / Worker / 媒体
状态。因此这必须是两个 `WebContents` 身份，而不是同一个 Vue app 里的两个普通组件。

| 格式                          | Surface             | renderer / 组件                                            | 当前文件查找                                  |
| ----------------------------- | ------------------- | ---------------------------------------------------------- | --------------------------------------------- |
| `.html` / `.htm`              | `chromePreviewView` | Chromium 原生页面，允许受 containment 约束的本地相对资源   | `chromePreviewView.webContents.findInPage()`  |
| `.pdf`                        | `chromePreviewView` | Chromium 内置 PDF viewer                                   | `chromePreviewView.webContents.findInPage()`  |
| 源码 / 普通文本 / CSV         | `vuePreviewView`    | Monaco                                                     | `model.findMatches()` adapter                 |
| Markdown                      | `vuePreviewView`    | Markdown → DOMPurify → DOM                                 | `vuePreviewView.webContents.findInPage()`     |
| DOCX                          | `vuePreviewView`    | `docx-preview` → detached DOM → 清洗 → mount               | `vuePreviewView.webContents.findInPage()`     |
| XLSX / XLSM                   | `vuePreviewView`    | ExcelJS Worker model + 自研只读虚拟网格                    | sheet model adapter，跨 sheet 定位并高亮 cell |
| 图片                          | `vuePreviewView`    | 图片组件：适应窗口、放大、缩小、重置；放大后可拖动查看     | `none`                                        |
| 音频 / 视频                   | `vuePreviewView`    | `<audio controls>` / `<video controls>` 播放器组件；不转码 | `none`                                        |
| unsupported / 超限 / 解析失败 | `vuePreviewView`    | 统一真话状态与外部打开                                     | `none`                                        |

选择切换必须是一个原子 revision 流程：

```text
selectionRevision++
  → stop/clear 旧 find
  → teardown 旧 surface（超时则强制 destroy）
  → 更新 activeSurface
  → Vue 先在 detached 状态 reset 并回 exact runtime + revision acknowledgement；Chrome 创建新实例
  → exact acknowledgement 后 attach + layout Vue；Chrome 完成安全配置后 attach + load
  → load/render
  → exact host + selectionRevision ready
  → 才启用 Find Bar
```

`vuePreviewView` 切文件时必须 unmount/reset：dispose Monaco model、terminate XLSX Worker、pause media、
remove media listeners/src、调用 `load()` 释放 native resource、abort image/media preflight、revoke image
object URL、清除 DOM/zoom/pan/error 与搜索高亮；切到 Chrome 时保持 neutral empty state。图片从 Main asset
有界缓冲并离屏 decode 后只保留 revision-keyed renderer Blob，Main 在 ready/error 后撤销源 token。音视频
继续直接使用 Range asset；该 authority 跟随 selection 生命周期而非 30 分钟 TTL，直到 selection/host/
workspace revoke，保证长时间播放后的 seek 仍可用；bounded registry 在全局达到容量时仍可淘汰最老 token。
媒体先用可读 `Content-Length` 与经 CORS 暴露的 `Accept-Ranges` 完成 HEAD preflight，再挂
`preload="metadata"` player；30 秒内没有 `loadedmetadata` 或 `error` 就进入 typed read failure，而不是保留
dead player。`chromePreviewView`
以 selection revision 为一次性边界：HTML→HTML、HTML→PDF、PDF→HTML、reload 和切到 Vue 都先 destroy
旧 `WebContents`，再按新 revision 创建，避免页面 JS、timer、音视频、service worker、history、storage
或网络跨文件继续运行。
若未来出现内存压力，再加 Vue idle destroy；不能为省一个 renderer 合并安全边界。

布局与焦点有五条硬约束：

| 约束          | 合同                                                                                                                                                                                                                                     |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| host ref      | Shell 的 bounds ref / `ResizeObserver` 必须放在 toolbar **下方的 inner content host**，不能放在包含 toolbar 的 wrapper，否则 native view 会覆盖输入框                                                                                    |
| 首帧          | active content 在收到 Shell 首个有效 host bounds 前不得 attach / visible；不能沿用当前从 `y=32` 开始的临时 bounds，否则启动时会短暂盖住 toolbar                                                                                          |
| z-order       | Main 保存唯一 `activePreviewSurface`；旧 view 完成 stop-find / teardown / detach 后才能 attach 新 view，绝不把两个 view 同时叠在相同 bounds                                                                                              |
| 快捷键 / 焦点 | Main 从 Shell、`chromePreviewView`、`vuePreviewView` 的 `before-input-event` 统一截获 `Cmd/Ctrl+F`，先 focus `ShellView.webContents` 再聚焦 toolbar input；关闭 / `Esc` 后恢复当前 active content。`Option/Alt+Cmd/Ctrl+F` 与保留的 `Shift+Cmd/Ctrl+F` 属于 Project Search |
| renderer 崩溃 | active capability 立即变 `unavailable`，Shell toolbar 保持可用；Main 清理崩溃 view 并转到可重建的 Vue 真话错误态 / retry，不因单个 Preview renderer 崩溃关闭整个窗口；旧 ready/find 结果仍受 host + selection + surface revision 围栏    |

```text
Cmd/Ctrl+F
    ↓
ShellView Preview toolbar：Find Bar 输入、上一处/下一处、n/m、大小写、关闭
    ↓ typed host + selection revision
Main：按 current surface + adapter 路由
    ├─ chromePreviewView HTML/PDF       → webContents.findInPage()
    ├─ vuePreviewView Markdown/DOCX DOM → webContents.findInPage()
    ├─ vuePreviewView Monaco/XLSX model → capability-bound content adapter
    └─ image / audio / video     → unavailable，不打开 Find Bar
    ↓
统一结果 envelope：{ hostId, selectionRevision, surface, findRevision,
                     activeMatchOrdinal, matches, finalUpdate }
```

`selectionRevision` 只能隔离“切文件”，不能隔离同一文件内快速输入 `a → ab` 或连续上一处/下一处。
Shell 只提交不带 revision 的查找 intent；Main 接受每次 query、大小写变更、next/previous 或 clear 后，
单调递增唯一的 `findRevision`，立即把 accepted state 回给 Shell，再把带 revision 的命令发给 engine：

```ts
type PreviewFindIntent = {
  hostId: string;
  selectionRevision: number;
  surface: 'chrome' | 'vue';
  query: string;
  caseSensitive: boolean;
  direction: 'forward' | 'backward';
  findNext: boolean;
};

type PreviewFindCommand = {
  hostId: string;
  selectionRevision: number;
  surface: 'chrome' | 'vue';
  findRevision: number;
  query: string;
  caseSensitive: boolean;
  direction: 'forward' | 'backward';
  findNext: boolean;
};

type PreviewFindResult = {
  hostId: string;
  selectionRevision: number;
  surface: 'chrome' | 'vue';
  findRevision: number;
  activeMatchOrdinal: number;
  matches: number;
  finalUpdate: boolean;
  coverage:
    | { kind: 'complete' }
    | {
        kind: 'partial';
        reason: 'sheet-model-cap';
        acceptedSheets: number;
        acceptedCells: number;
      };
};
```

Main 只接受完整等于 current 的四元组 `hostId + selectionRevision + surface + findRevision`。对
`webContents.findInPage()`，Main 还要以内部 `WebContents identity/generation + Electron requestId` 为键
保存 `findRevision` 映射，并同时核对 `found-in-page.requestId`；不能只用可在 view 重建后复用的数字
`requestId`。Monaco / XLSX adapter 直接回显 `findRevision`。关闭 Find Bar 或切 surface 由 Main 递增并
作废旧 revision，再调用 `stopFindInPage('clearSelection')` / adapter `clear()`。

这比注入更像 Chrome：浏览器 chrome 与 tab content 本来就是两个边界。Find Bar 不在被查找的
`WebContents` 内，也避免 `findInPage()` 把输入框里的查询文字、文件名和 header 文案一起算成命中。

Markdown 由 Vue 子应用转 DOM，但 **preload 只暴露最小 bridge，不负责解析、拼 UI 或注入 DOM**；
解析与 DOMPurify 继续放 app-owned renderer 代码。任意本地 HTML 则进入独立 `chromePreviewView`，不能获得
Node / filesystem / Electron / XPC 能力。内容可执行不等于内容可信。

<a id="html-page-boundary"></a>

### #7.3 · HTML 页面脚本边界 `本地离线策略已实施` `远程策略待定`

Ral 2026-08-20 补充：「HTML 如果有引入 JS 应该也能渲染出来」。技术上成立：页面脚本在
`chromePreviewView` 的 Chromium sandbox 内运行，`findInPage()` 查它执行后已经进入可搜索 DOM 的
文字；canvas / WebGL 像素不是文字，异步新增 DOM 后若当前查找会话未自动刷新，则重新发同一 query。

| 能力                           | 推荐边界                                                                                                                                                                | 原因                                                                                                                    |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| HTML 自身 inline / relative JS | ✅ 允许执行                                                                                                                                                             | 这是浏览器式 HTML 预览的组成部分                                                                                        |
| 页面获得 Node / Electron / XPC | ❌ 不允许                                                                                                                                                               | 内容文件按不可信页面处理；搜索由 Main 直接控制 `webContents`，页面不需要权限                                            |
| preload                        | `chromePreviewView` **不配置 preload**；`vuePreviewView` 只挂 app-owned、最小 typed capability preload                                                                  | preload 不是后台解析器，更不能成为页面逃出 sandbox 的桥                                                                 |
| renderer 安全配置              | `sandbox: true`、`nodeIntegration: false`、`contextIsolation: true`、`webSecurity: true`；所有 Chrome selection revision 共用唯一常量持久 partition `persist:onlypreview-chrome`（2026-08-21 修正：内存 partition 下 Chromium PDF 阅读器不会创建文档帧，PDF 必然白屏），每次拆除时在无 raw view 挂载的前提下清空连接/存储/缓存 | 与 Electron 官方 untrusted-content 基线一致；不共享 Bitterless 应用 session 的登录态、Cookie、cache、service worker 或 local storage |
| 文件与资源 URL                 | `chromePreviewView` 使用 document-scoped custom protocol：入口文件授权目录内的相对 JS / CSS / 图片，经 canonical path containment 后出流；拒绝任意 `file://` 与越界路径 | 当前 exact-basename asset URL 不足以承载真实 HTML，目标实现必须新增受限 resolver                                        |
| 导航、弹窗、权限               | 非预期导航与 `window.open` 拒绝；permission check / request 默认拒绝                                                                                                    | 页面 JS 能渲染，不代表能接管窗口或系统能力                                                                              |
| protocol 注册                  | document resolver 必须注册在该实例的 `chromePreviewView.webContents.session.protocol`，不能只注册默认 `protocol`；销毁时撤销 handler 与 capability。session 共用后每次安装领取一个 generation，迟到的 cleanup 只在仍持有当前 generation 时才 unhandle | 独立 partition 不会自动继承默认 session 的 custom protocol handler；共用 session 时，晚到的拆除不得注销新一次选择的 handler |
| 生命周期                       | **任何 selection revision 变化**都销毁旧 `chromePreviewView`，包括 HTML→HTML、HTML↔PDF 和 watch reload；下一次重新创建                                                  | 清除页面进程内状态、timer、媒体、history 与临时 session 数据                                                            |

依据：Electron `v40.10.6` 对应的
[Security checklist](https://github.com/electron/electron/blob/v40.10.6/docs/tutorial/security.md)（版本发布文档，
核对 2026-08-20）明确要求 untrusted content 使用 sandbox、关闭 Node integration、开启 context
isolation / webSecurity、限制导航与新窗口、优先 custom protocol，并避免向内容暴露 Electron API。

024 已实施当前默认值：raw HTML 只允许 document-scoped containment 内的本地资源，并通过独立 session、
固定不可用代理、request/permission/navigation/popup/download 围栏与响应安全头拒绝远程访问。
远程 HTTPS 脚本与页面网络请求是否未来开放仍不暗定：如果要求「离线预览」，继续由 session
拦截；如果要求「像浏览器一样运行网页应用」，则允许 HTTPS，但仍不得共享 Bitterless 登录态、Cookie
或持久存储。**在 PQ-4 未被 Ral 进一步拍板前，实现默认值固定为拒绝所有远程网络**；raw HTML 只能
读取 document-scoped containment 下的本地相对资源，不能先上线开放网络再等待产品决定。该选择不会
改变 Shell toolbar + 双 Preview view 拓扑，未来若开放 HTTPS 再单独审查请求、重定向与数据外传边界。

<a id="find-capability-routing"></a>

### #7.4 · 查找能力按 renderer capability 路由 `已定 2026-08-20` `019 已通过独立复核，等待 Ral 验证`

Ral 2026-08-20 追问：「搜索触发要不要用白名单机制，例如 js、css 等各个语言的后缀都能搜索，还是
黑名单机制，除了图片音频视频都能搜索」。本轮决定：**两者都不用作 Find Bar 的最终开关**。扩展名
仍是格式 classifier 的第一层路由，但 Find Bar 只认 app-owned、TypeScript 穷举的 adapter registry 与
当前 host / selection revision / surface 的实际 ready 状态。任意本地 HTML 页面不参与声明能力，也
拿不到 XPC。

```text
扩展名路由 → adapter 大小闸门 → 文本宽容解码 / 非文本签名与 parser → renderer ready
                                                        ↓
                          findMode: webcontents-find | content-adapter | none
                                                        ↓
                                   Cmd/Ctrl+F 是否激活及使用哪个 engine
```

| `findMode`         | 格式                                                                                                 | engine                                                                                       | 行为                                                                                                              |
| ------------------ | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `webcontents-find` | `chromePreviewView` 的 HTML / PDF；`vuePreviewView` 的 Markdown / DOCX DOM                           | Main 对 registry 指定且当前 active 的 view `webContents` 调 `findInPage()`                   | 直接复用 Chromium 的匹配、滚动与高亮；扫描型 PDF 没有文字层时如实返回 0，OCR 另议                                 |
| `content-adapter`  | Monaco 文本/代码/CSV、XLSX 虚拟网格                                                                  | Monaco 直接查 model；sheet adapter 把 query 转给 Worker 持有的 bounded workbook search model | 查所有已接纳且未必挂 DOM 的内容，不受虚拟 viewport 限制；统一回传当前项与总数，XLSX 额外回传 sheet / row / column |
| `none`             | image / audio / video / unsupported、超过大小上限，以及未通过非文本格式签名或 parser 的损坏/加密内容 | 无                                                                                           | 不激活 Find Bar，不制造假的 `0/0` 搜索结果                                                                        |

Ral 2026-08-20 继续确认：「文件是否可搜索怎么配置也放到方案里了么」。配置放在 app-owned、TypeScript
穷举的 preview adapter registry，不放 Settings，也不写成散落在各组件里的 `if (extension)`：

```ts
type PreviewAdapterId =
  | 'monaco'
  | 'markdown-dom'
  | 'html-page'
  | 'chromium-pdf'
  | 'xlsx-grid'
  | 'docx-dom'
  | 'image'
  | 'audio'
  | 'video'
  | 'unsupported';

type PreviewSurface = 'chrome' | 'vue';

type PreviewFindCapability =
  | { mode: 'webcontents-find' }
  | { mode: 'content-adapter'; adapter: 'monaco' | 'sheet' }
  | { mode: 'none' };

type PreviewAdapterSpec = {
  surface: PreviewSurface;
  find: PreviewFindCapability;
};

const PREVIEW_ADAPTERS: Record<PreviewAdapterId, PreviewAdapterSpec> = {
  monaco: { surface: 'vue', find: { mode: 'content-adapter', adapter: 'monaco' } },
  'markdown-dom': { surface: 'vue', find: { mode: 'webcontents-find' } },
  'html-page': { surface: 'chrome', find: { mode: 'webcontents-find' } },
  'chromium-pdf': { surface: 'chrome', find: { mode: 'webcontents-find' } },
  'xlsx-grid': { surface: 'vue', find: { mode: 'content-adapter', adapter: 'sheet' } },
  'docx-dom': { surface: 'vue', find: { mode: 'webcontents-find' } },
  image: { surface: 'vue', find: { mode: 'none' } },
  audio: { surface: 'vue', find: { mode: 'none' } },
  video: { surface: 'vue', find: { mode: 'none' } },
  unsupported: { surface: 'vue', find: { mode: 'none' } }
};
```

`Record<PreviewAdapterId, ...>` 是完整性闸门：新增 preview adapter 却没决定查找行为时 TypeScript 直接
失败。它只定义“成功渲染后预期有什么能力”；真正是否激活还要叠加运行态：

```ts
type PreviewFindState =
  | {
      state: 'pending';
      hostId: string;
      selectionRevision: number;
      surface: PreviewSurface;
      findRevision: number;
    }
  | {
      state: 'ready';
      hostId: string;
      selectionRevision: number;
      surface: PreviewSurface;
      findRevision: number;
      capability: Exclude<PreviewFindCapability, { mode: 'none' }>;
      coverage:
        | { kind: 'complete' }
        | {
            kind: 'partial';
            reason: 'sheet-model-cap';
            acceptedSheets: number;
            acceptedCells: number;
          };
    }
  | {
      state: 'unavailable';
      hostId: string;
      selectionRevision: number;
      surface: PreviewSurface;
      findRevision: number;
      reason: 'non-text' | 'unsupported' | 'size-limit' | 'render-failed';
    };
```

这里还要与 Project Search 的正文索引资格分开。前者回答“当前 Preview 能否查找并高亮”，后者回答
“项目索引是否保存这份文件的正文”；目录列举与文件名搜索不依赖两者：

```ts
type ProjectSearchContentCapability = 'content' | 'filename-only' | 'none';
```

| 文件实例                      | 当前文件 Find Bar                                   | Project Search                        | 目录 / 文件名搜索 |
| ----------------------------- | --------------------------------------------------- | ------------------------------------- | ----------------- |
| 已知文本后缀且未超限          | `ready(content-adapter:monaco)`；宽容解码可显示乱码 | `content`（仍受 1MiB 索引上限）       | 可用              |
| 1GiB `.vue`                   | `unavailable(size-limit)`                           | `filename-only`                       | 可用              |
| 512KiB ZIP 政名 `.js`         | `ready(content-adapter:monaco)`；显示乱码           | `content`，可能产生垃圾命中           | 可用              |
| 2MiB ZIP 政名 `.js`           | 同上                                                | `filename-only`（超过 1MiB 索引上限） | 可用              |
| 文件本身不允许列举 / 无访问权 | 无 current-file capability                          | `none`                                | 不可用            |

静态 registry 只说明 adapter 成功渲染后的**预期**查找能力。文本实例按姊妹文档
[`onlypreview-format-coverage.md` #8.1](onlypreview-format-coverage.md#81--文本候选按后缀与大小准入-已定-2026-08-20-已实施)
只做 extension / known filename 路由与 size-first；限额内的 ZIP / 非法编码改名文本可宽容解码并进入
`ready`，乱码与垃圾命中是已接受结果。超限仍不能退回 SQLite `LIKE`、临时整文件扫描或截断后假装
得到完整结果；非文本 adapter 的签名与 parser 成功态仍是自身 capability ready 的前提。

```text
选中文件 / revision 变化
    → 清旧高亮与旧 adapter，state=pending
    → extension classifier + size 选择 PreviewAdapterId；非文本格式再过签名 / parser gate
    → registry 给出预期 capability
    → exact navigation / app-owned renderer render 成功，且 host + revision 仍为 current
        ├─ webcontents-find / content-adapter → state=ready
        └─ none / render failed          → state=unavailable
```

raw HTML 与 Chromium PDF 不挂 preload：由 Main 的 exact-navigation fence + `did-finish-load` 把 registry
中的 Chrome `webcontents-find` 翻为 ready。Markdown / DOCX / Monaco / XLSX 等 app-owned 页面则在内容实际
挂载后通过 capability-bound typed XPC 报 ready；Main 只接受当前 host + selection revision + surface，
不把 `webContentsId` 暴露给 renderer。XLSX 的 `sheet` adapter 是 `vuePreviewView` 内的薄协调层，完整 workbook
model 留在 Worker。只有文件已通过 byte / ZIP / uncompressed-size 硬闸门、随后超过 row/cell model cap
时，capability 才能 `ready + coverage.partial`；硬闸门失败必须 `unavailable`。Shell 的计数至少显示
`n/m · 部分`，不能把 partial matches 呈现为完整总数。

image/audio/video 永远不发布文字能力：transition 时只广播一次 `0` 以清掉前一份文本的状态，组件本身
不 arm 或上报 character count。它们的 `ready` 只允许 Main 把 exact `loading` 推到 `ready`；同 revision
解码/网络错误可把 `loading` 或 `ready` 推到 `unavailable`，而 error 之后迟到的 ready 必须 no-op。

快捷键仍由宿主统一识别，不要求每个文件后缀注册一遍。当前
`src/main/onlypreview/onlyPreviewClassifier.service.ts` 的 `TEXT_EXTENSIONS` 已覆盖 `.js`、`.css`、
`.ts`、`.tsx`、`.vue`、`.py`、`.go`、`.rs` 等常用语言。023 已删除 unknown extension 的 sample
回落：未知后缀默认 unsupported；如果以后需要「按文本打开」，由用户显式选择，
不能由文件头自动提升。新增语言的语法高亮需要补 extension / language mapping，但全文查找协议本身
不需要跟着扩展。

| 方案                             | 不采用的原因                                                                                             |
| -------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 纯后缀白名单决定 Find Bar        | 语言后缀会不断增长，并会把 DOCX / XLSX / PDF 这类「可查找但不是源码文本」的格式漏掉                      |
| 只把图片 / 音频 / 视频列入黑名单 | archive、database、executable、font、加密文件、损坏 OOXML 等都会被误判成「可搜索」，最终只得到空白或错误 |
| capability registry（本轮决定）  | 能力与真实渲染状态一致；代价是每个新 preview adapter 必须显式声明 capability，这是刻意保留的完整性闸门   |

激活细则：`findMode=none` 时快捷键不展开输入框，并给出轻量的「当前内容没有可搜索文字」反馈；可查找
格式仍在装载时可以先展开 Find Bar，输入框和关闭保持可用并允许排队一个 query，大小写与导航按钮
保持 disabled，且不能把「尚未 ready」显示成 0 个结果；ready 后只派发一次 queued query。HTML 引用的
JS 源码本身不属于当前页面文字，只有它最终写入 DOM 的文字会被 `findInPage()` 命中；单独打开 `.js`
文件时则走 Monaco 全文查找。

024 已建立新的 Main owner；Region 集中管理 selection/presentation/find authority，并把
`chromePreviewView` / `vuePreviewView` 的创建、session、navigation、attach/detach 与 teardown 委托给
同域 `onlyPreviewPreviewView.service.ts`，Shell store 不持有 `webContentsId`。019 已在该 Region contract 上实现 find intent、
`findRevision`、engine routing 与结果围栏；Shell/Vue 只把 `{ hostId }` 事件当 nudge，再 generation-fenced
refetch Main snapshot。native 结果额外绑定 exact WebContents identity/generation 与 Electron requestId；
content adapter command 绑定 exact adapter/revision/runtime，结果不会携带 runtime token 到 Shell。Monaco
对完整 8MiB accepted model 做 literal count，但不物化全量 Range；当前项通过 Monaco model 的
next/previous API 取得 original-model Range，只保留一个 active decoration，避免 Unicode case-fold
扩展后的偏移错位。XLSX 搜索继续使用 Worker accepted model，并只在 model cap 时声明 partial。不得复用
2026-08-18 的单 Preview renderer 编排。

<a id="main-preview-owner"></a>

### #7.5 · Main 所有权与事件入口 `已定 2026-08-20` `024 基础已实施`

Main 的 `onlyPreviewPreviewRegion.service.ts` 是 `selectionRevision`、`activePreviewSurface` 和 asset
capability 的唯一 owner。Shell、watch runtime、Vue renderer 都只能提交 intent / observation，不能自行
生成一个可被其他层接受的 selection revision。

024 已实现上述 selection/surface/presentation owner、host-only nudge、Vue runtime/reset/ready/error gate
以及 Chrome load/crash observation；019 已补齐 Main-only find authority、`findRevision`、capability-ready
握手、native request identity 和 content adapter result gate。

| 输入                     | Main 行为                                                                                                                | Shell 得到什么                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| 用户选择文件             | 校验 host/workspace/path，`selectionRevision++`，撤销旧 token/stream/find，classifier 选 adapter/surface，再执行原子切换 | descriptor、surface、loading/ready/unavailable、find capability；不暴露 `webContentsId` |
| watch commit             | 只接受 exact host/workspace/generation/path；若命中当前文件，Main `selectionRevision++` 并重建当前 Chrome 或重置 Vue     | 新 revision 的 descriptor / ready；旧查找结果自然失效                                   |
| workspace refresh/change | 先撤销当前 selection、asset capability、stream、find 与两个 view 的活动工作，再建立新 workspace generation               | neutral / pending 状态，不保留上一 workspace metadata                                   |
| Vue ready / error        | 只接受 app-owned URL、runtime capability 和 exact host/selection/surface revision                                        | 对应 revision 的 ready / truthful error                                                 |
| Chrome load / crash      | Main 直接观察 `did-finish-load` / `render-process-gone`，页面没有 XPC                                                    | ready，或 unavailable + retry；不关闭 BaseWindow                                        |

字符数能力按 surface 明确降级：`vuePreviewView` 的 Monaco/Markdown/DOCX 等继续用受 revision 围栏的
selection observation；`chromePreviewView` 不注入脚本，也没有 preload，所以 HTML/PDF 第一阶段不提供
选区字符数，Shell 隐藏该 metadata 字段而不是显示假 `0`。若未来必须支持，应单开浏览器内容 selection
设计，不能借此给 raw HTML 加 XPC。

绝对路径也按 surface/role 降级：Shell 的 workspace header 可以读取
`OnlyPreviewWorkspace.displayPath` 作为纯展示信息；selected-file `OnlyPreviewDescriptor`、公共 presentation
snapshot 与 runtime-token-bound Vue snapshot 只携带 workspace-relative identity 和文件 metadata，禁止
`displayPath`、canonical root 或 absolute selected-file path。raw Chrome 仍只取得一次性 document/asset URL。

`Cmd/Ctrl+F` 与选择事件相反：Shell toolbar 是 UI owner，Main 是路由与 `selectionRevision` /
`findRevision` 的**唯一 writer**，active content 只执行查找。watch reload、renderer crash、workspace
change 都必须先由 Main 递增两个 revision，再允许任何新结果出现；Shell 永远不能自行递增或合成一个
可被 engine 接受的 revision。

## #pending-questions · 待定项

| id       | 项                                                                                        | 所在                                       | 类型     | 阻塞性     | 倾向 / 拍板需要什么输入                                                                                                                                                    | 状态                                                                                                                                                                            |
| -------- | ----------------------------------------------------------------------------------------- | ------------------------------------------ | -------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **PQ-1** | Find Bar 是否需要 regex / 大小写敏感 / 整词 开关                                          | [#7.4](#find-capability-routing)           | 待拍板   | 非阻塞     | 原倾向：MVP 全不做                                                                                                                                                         | **已定 2026-08-18**（Ral「要大小写开关，其他回头搞」）——MVP 含**大小写敏感开关**；regex 与整词延后，不进 019                                                                    |
| **PQ-2** | 「文件搜索与全局搜索需要优化」指哪一处                                                    | [#6](#6--shell-侧本轮不动-已定-2026-08-18) | 待补输入 | 非阻塞     | 需要 Ral 指明范围                                                                                                                                                          | **已澄清 2026-08-18**（Ral「指的是文件目录上的那个搜索，后面再讨论」）——目标是 Shell 文件树上的那个搜索（本地过滤 / Project Search 输入），**另开一轮讨论**，不属本文与 018/019 |
| **PQ-3** | Preview 内容应使用一个可导航 view、还是分成原生浏览器与程序渲染两个 view；Find Bar 放哪里 | [#7](#dual-preview-region)                 | 待拍板   | 原阻塞定案 | 原倾向是单独 toolbar view + 双 content surface；Ral 最终进一步收敛为复用 Shell toolbar，不增加搜索 renderer                                                                | **已定 2026-08-20**：`chromePreviewView` 直出 HTML/PDF，`vuePreviewView` 处理其余格式；同时只 attach 一个。文件头与 Find Bar 放现有 `ShellView` Preview toolbar                 |
| **PQ-4** | HTML 引用的远程 HTTPS 脚本和页面网络请求是否默认开放                                      | [#7.3](#html-page-boundary)                | 待拍板   | 可后置     | **当前已实施：默认拒绝远程网络，只允许受 containment 约束的本地相对资源**；tradeoff 是依赖 CDN / API 的网页应用不能完整运行。未来拍板需要 Ral 说明是否转向「网页应用运行」 | **未来开放策略待定**；不阻塞已实施的离线边界、局部资源或查找方案定案                                                                                                            |

已定：当前实现的历史原因、大小写开关、文件树 / Project Search 范围、双 Preview view 拓扑、Shell
toolbar，以及查找资格按 renderer capability 而不是后缀白 / 黑名单路由。
收敛记账：账本 4 行 · 已解 3 行 · 待拍板 1 行 · 未解的 `阻塞定案` **0 条**。024 已交付基础拓扑；
023/024 已交付基础拓扑与 preview guards；020 renderer-local XLSX 网格与搜索 session 状态为
`implemented; owner verification pending`，已通过独立复核并等待 Ral 手测；021 为
`implemented; owner verification pending`，已通过独立复核并等待 Ral 真实 DOCX 视觉/运行时验证；
022 为 `implemented; owner verification pending`，已通过独立复核并等待 Ral 真实图片/音视频验证；019 为
`implemented; owner verification pending`；
[独立复核 round 2](../plan/reviews/onlypreview-find-in-file-019-2.md) 已记录 **PASS**，其自身行为测试、
安全构建与独立复核均已完成，剩余闸门为 Ral 的
[手工验证清单](../plan/tasks/onlypreview-find-in-file-019.md#owner-verification)。

跨姊妹文档盘点（2026-08-20）：未定共 **4** 项，blocker **0** 项；均可后置（本页远程 HTML 网络
策略，以及格式页 `.xls/.ppt`、`.pptx`、HEIC/HEIF/TIFF）。文本准入、
XLSX/XLSM、DOCX、旧 `.doc` 与查找 capability 已定，不再计入未定。

预览格式覆盖（Excel / Word / 幻灯片 / 图片 / 音视频「渲染一切」）是另一条设计线，见
[`onlypreview-format-coverage.md`](onlypreview-format-coverage.md)。本文只管视图边界与查找归属。

## #rejected · 已否留档

### 全部合并进 Shell 单 renderer `已否 2026-08-18`（原 2026-08-10 已定）

| 项           | 留档                                                                                                                                                                                                                            |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 所属决策章   | [历史 #1](#1--历史决策header-并入单-preview-view-已被-7-取代)                                                                                                                                                                   |
| 原方案       | 删除 `previewView`，把 PreviewSurface、Monaco/PDF/媒体渲染与选区字符数状态全部移入 Shell renderer，Find Bar 与文件树共享一个 DOM 与焦点树（`onlypreview-search-architecture.md` #2/#4）                                         |
| 否决理由     | 该方案的收益是「所有搜索/焦点/跳转协议简化」，但 header 并入 Preview 已经拿到查找闭环这份收益；剩下的只有它自陈的 tradeoff：Monaco/PDF 与文件树共享 event loop。全局搜索结果跳转的跨视图 payload 是一次性的，不构成持续协议成本 |
| 复议触发条件 | Find Bar 或查找结果需要与文件树共享同一焦点/选择行为；或 Preview 原生视图的覆盖特性成为布局阻碍（例如需要跨越 header 与树的浮层）                                                                                               |

### 独立 Header renderer 与单 Content renderer `已否 2026-08-18`

| 项           | 留档                                                                                                                                                                            |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 所属决策章   | [历史 #1](#1--历史决策header-并入单-preview-view-已被-7-取代)                                                                                                                   |
| 原方案       | 保留 PreviewHeader 视图，Find Bar 放 Header 或 Shell，查询经 XPC 打进 Content 进程，回传 `{ total, activeIndex }`，用 host/revision 围栏防 stale（协议形状照抄选区字符数 gate） |
| 否决理由     | 匹配算法在两种拓扑下完全相同，跨进程那一层是纯增量成本，不换来任何查找能力；且 Find Bar 与内容分处两个视图后，焦点、`Esc`、失焦收起、高亮清理都要各自再造一遍                   |
| 复议触发条件 | header 需要独立于内容渲染的崩溃隔离；或内容视图要直接加载 Chromium HTML / PDF，并复用只作用于该 `WebContents` 的 `findInPage()`                                                 |
| 复议状态     | **未恢复原方案**：新方案复用 `ShellView` DOM 承载 toolbar，不增加 Header renderer；新增的两个 content 身份用于隔离 Chromium 直出与 Vue 程序渲染，并且同时只 attach 一个         |

### 单一可导航 Preview content view 混用 raw 与 Vue `已否 2026-08-20`

| 项           | 留档                                                                                                                                                                                                      |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 所属决策章   | [#7.2](#shell-toolbar-dual-view)                                                                                                                                                                          |
| 原方案       | Shell / toolbar + 一个 `PreviewContentView`；该 view 在 raw HTML、Chromium PDF 与 app-owned Vue bundle 之间反复 navigation                                                                                |
| 否决理由     | preload、`webPreferences`、session 与 capability 是 `WebContents` 身份边界。共用会把 Vue XPC 暴露给不可信 HTML，或迫使 Vue 放弃 bridge；navigation 还会销毁 app model / Worker / media 状态并混用页面存储 |
| 复议触发条件 | Vue 预览完全不再需要 preload / typed XPC，或 Electron 未来提供可验证的 per-document capability / preload 隔离；仅“少一个 renderer”不足以复议安全边界                                                      |

---

024 实施侧路径：新增 `src/main/onlypreview/views/onlyPreviewPreviewRegion.service.ts` 作为双 view owner；
`src/main/windows/onlyPreviewWindow.helper.ts` 只保留 BaseWindow / Shell / settings 与总 teardown；
`src/renderer/onlypreview/shell/` 承载 Preview toolbar；现有 `src/renderer/onlypreview/preview/` 演进为
`vuePreviewView` 的 Vue 子应用；`chromePreviewView` 不新增 renderer bundle 或 preload；
`src/main/onlypreview/onlyPreviewDocument.registry.ts` 独立承担 document-scoped、path-contained HTML 资源，
`onlyPreviewAsset.registry.ts` 继续承担 exact-file assets；shared/preload/XPC/i18n 与测试合同已同步。

[onlypreview-dual-preview-region-024](../plan/tasks/onlypreview-dual-preview-region-024.md) 已取代 018 的单
Preview 目标并完成基础；[019](../plan/tasks/onlypreview-find-in-file-019.md) 已在新 Region 上实现 Find，
当前为 `implemented; owner verification pending`；
[独立复核 round 2](../plan/reviews/onlypreview-find-in-file-019-2.md) 已记录 **PASS**，等待 Ral 按任务内
手工清单完成运行时/视觉验证。
020 XLSX/XLSM 格式能力已通过独立复核，当前为 `implemented; owner verification pending`，等待 Ral
手测；021 DOCX renderer 已实施并通过独立复核，状态为
`implemented; owner verification pending`，当前等待 Ral 真实 DOCX 视觉/运行时验证；022 已实施，状态为
`implemented; owner verification pending`，其
[独立复核 round 2](../plan/reviews/onlypreview-media-truthful-state-022-2.md) 已记录 **PASS**，当前等待 Ral
真实图片/音视频视觉与运行时验证。023 guards 已实施。

[onlypreview-design-completion-025](../plan/tasks/onlypreview-design-completion-025.md) 已将 selected-file
descriptor/public/Vue snapshot 收口为 relative-only 白名单，统一 direct unsupported 与 typed failure 的
metadata surface，并在不新增 renderer、preload 或 FileActions 的前提下完成所有超限 TS/JS 拆分。当前
状态为 `implemented; owner verification pending`；
[completion audit](../plan/reviews/onlypreview-design-completion-025-1.md) 已 **PASS**。本文与格式设计的
非 E2E 实现已闭合，剩余仅 Ral 的真实应用、运行时与视觉手测。
