# OnlyPreview 预览格式覆盖

本文决定 OnlyPreview「渲染一切」的格式边界：哪些格式由谁渲染、保真上限在哪、哪些明确不渲染但要给
真话状态。

**状态：023/024 已实施双 surface、bounded HTML/PDF/asset 与 size-first tolerant text guards；020
XLSX/XLSM 为 `implemented; owner verification pending`（已通过独立复核，等待 Ral 手测），021 DOCX 为
`implemented; owner verification pending`（已通过独立复核，等待 Ral 真实 DOCX 视觉/运行时验证），022
媒体真话态为 `implemented; owner verification pending`（独立复核已通过，等待 Ral 真实图片/音视频
视觉与运行时验证）；025 设计收口的
[completion audit](../plan/reviews/onlypreview-design-completion-025-1.md) 已 **PASS**，当前为
`implemented; owner verification pending`；032 Draw.io 的
[independent review 3](../plan/reviews/onlypreview-drawio-readonly-032-3.md) 已 **PASS**，等待 Ral
运行时/视觉验证 ·
077 正在以一个精确 pin、按格式动态加载的 `@silurus/ooxml` adapter 取代 020/021 的旧 renderer，并新增
PPTX；三种 Office viewer 共享 worker mode、资源闸门和 model-backed Find/highlight ·
开题 2026-08-18 · Ral 于 2026-08-20 指定本文
已定内容为持续交付目标 · 未定且非阻塞的结论仍以 [#pending-questions](#pending-questions--待定项) 为准。**

核对日期 2026-08-20，依据实码：`src/main/onlypreview/onlyPreviewClassifier.service.ts`、
`src/main/onlypreview/onlyPreviewProtocol.service.ts`、
`src/main/onlypreview/onlyPreviewAsset.registry.ts`、
`src/renderer/onlypreview/preview/src/components/`、`package.json`；外部依据：Electron Process Model /
Performance、历史 `docx-preview` / ExcelJS 与当前 `@silurus/ooxml` 官方文档，见 [#1](#1--读取与解析执行边界-已定-2026-08-20-已通过独立复核等待-ral-真实-docx-验证)、
[#2](#2--xlsx--xlsm-已定-2026-08-20-已通过独立复核等待-ral-手测)、
[#3](#3--docx-已定-2026-08-20-已通过独立复核等待-ral-真实-docx-验证)。

来源：Ral 2026-08-18「Monaco 不够啊，我要渲染一切：excel pdf doc 等 图片，音视频就是播放器可播放」。
姊妹文档：[`onlypreview-preview-merge-find.md`](onlypreview-preview-merge-find.md)（视图边界与查找归属，
已定为 Shell Preview toolbar + 互斥的 `chromePreviewView` / `vuePreviewView`）、
[`features/onlypreview.md`](../features/onlypreview.md)（当前分类与渲染合同）。

## #0 · 总纲：真话优先于覆盖面

| 目标             | 判据                                                                                             | 现状                                                                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| G1 表格          | `.xlsx` / `.xlsm` 打开即见网格、sheet 页签、合并单元格与数字格式                                 | ⚠ 020 `implemented; owner verification pending` → [#2](#2--xlsx--xlsm-已定-2026-08-20-已通过独立复核等待-ral-手测)                     |
| G2 文档          | `.docx` 打开即见接近 Word 的分页版式，而不是纯文本                                               | ⚠ 021 `implemented; owner verification pending` → [#3](#3--docx-已定-2026-08-20-已通过独立复核等待-ral-真实-docx-验证)                 |
| G3 图片 / 音视频 | 能解码的直接看/直接播；不能解码的显示明确原因                                                    | ⚠ 022 `implemented; owner verification pending` → [#5](#5--图片与音视频-已定-2026-08-18)                                               |
| G4 不吹保真      | 每种格式写明保真上限与不做项，界面不假装渲染成功                                                 | ⚠ 020/021/022 已实施各自 bounded/typed truth，均已通过独立复核并等待 Ral 验证 → [#6](#6--保真上限与真话状态-已定-2026-08-18)           |
| G5 解析隔离      | Main 不做整包缓冲或 Office 解析；preload 不承担计算；OOXML 解析/布局/绘制使用 worker mode             | ⚠ 077 正在统一 XLSX/XLSM、DOCX、PPTX → [#1](#1--读取与解析执行边界-已定-2026-08-20-已通过独立复核等待-ral-真实-docx-验证)              |
| G9 演示文稿      | `.pptx` 打开即见虚拟化 slide list，并可跨未挂载 slide 查找、高亮与前后导航                           | ⚠ 077 in progress                                                                                                                |
| G6 文本输入有界  | 文本类后缀先选 adapter，再按大小限制 Preview 与正文索引；限额内允许乱码，不做内容拒绝            | ✅ 023 已实施 → [#8.1](#81--文本候选按后缀与大小准入-已定-2026-08-20-已实施)                                                           |
| G7 格式路由      | HTML/PDF 进入 `chromePreviewView`；需要代码或组件处理的格式进入 `vuePreviewView`                 | ✅ 024 已实施 → [姊妹文档 #7](onlypreview-preview-merge-find.md#dual-preview-region)                                                   |
| G8 Draw.io       | `.drawio` 先交付本地只读预览、缩放/分页；不加载远端服务、iframe、图片资源或完整编辑器            | ✅ 032 已实施并通过独立复核，等待 Ral 验证；图元文字搜索后置 → [#9](#9--drawio-已定-2026-08-26-已实施)                               |

覆盖面不是唯一目标。**能渲染的高保真渲染，不能渲染的说清楚为什么并给出外部打开**，比半坏的渲染更有用。

## #1 · 读取与解析执行边界 `已定 2026-08-20` `已通过独立复核，等待 Ral 真实 DOCX 验证`

Ral 2026-08-20：「解析加载最好是异步用 preload 解析加载不要占用主进程 io」。目标正确，执行位置
修正为：**异步读取沿用 `onlypreview://`，解析不放 preload**。Electron 官方
[Process Model](https://www.electronjs.org/docs/latest/tutorial/process-model) 明确 preload 运行在所附着的
renderer process；它不是后台线程。CPU 密集工作应按 Electron
[Performance](https://www.electronjs.org/docs/latest/tutorial/performance) 建议交给 Web Worker 或独立
renderer。把 Office 解析引擎塞进 preload 既不能隔离卡顿，又扩大特权代码与文件内容的接触面。

```text
Main protocol：校验 token / host / workspace / path → async createReadStream（不整包缓冲、不解析）
        ├─ chromePreviewView navigation
        │    ├─ HTML → document-scoped stream + contained relative JS/CSS/images
        │    └─ PDF  → Chromium 内置 PDF viewer
        └─ vuePreviewView fetch(assetUrl) → ArrayBuffer
             ├─ XLSX/XLSM → transferable ArrayBuffer → preflight Worker → lazy XlsxViewer(worker)
             ├─ DOCX      → transferable ArrayBuffer → preflight Worker → lazy DocxScrollViewer(worker)
             ├─ PPTX      → transferable ArrayBuffer → preflight Worker → lazy PptxScrollViewer(worker)
             └─ Draw.io   → disposable XML preflight Worker → local pinned viewer → owned DOM mount
```

024 已用 `onlyPreviewAsset.registry.ts#createOnlyPreviewFileResponse()` 把 `FileHandle.createReadStream()`
接入 bounded `Response`，并新增 `onlyPreviewDocument.registry.ts` 管理 contained HTML document 资源；
Main 仍负责安全授权与异步流创建，但不执行同步整文件读取、ZIP 展开或 Office 解析。「Main 零 IO」并
不准确；目标合同是 **Main JS event loop 不被整文件读取或解析阻塞**。XLSX Worker/parser 已由 020
实施并通过独立复核；DOCX parser 已由 021 实施，当前状态为
`implemented; owner verification pending`，独立复核已通过，等待 Ral 真实 DOCX 视觉/运行时验证。

| 层               | 改动                                                                                                                                         |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Main classifier  | `.xlsx`/`.xlsm` → `sheet`，`.docx` → `document`，`.pptx` → `presentation`；adapter 分别为 `ooxml-xlsx` / `ooxml-docx` / `ooxml-pptx` |
| Main 资产注册    | 保持 capability token + 相对路径 + async stream；不得 `readFile()` 整包或调用 Office parser                                                  |
| preload          | 只启动最小 capability / XPC bridge；不得导入解析引擎、接收整包 bytes 或生成 DOM                                                              |
| Chrome 直出单元  | `chromePreviewView` 不加载 renderer bundle 或 preload，只导航到 Main containment protocol；仅用于 HTML/PDF                                   |
| Office 执行单元  | `vuePreviewView` 异步取得 `ArrayBuffer`，先 transfer 给 disposable Worker 预检；通过后只动态加载当前 `@silurus/ooxml` subpath，并用 `mode: 'worker'` 解析/布局/绘制；切文件 destroy viewer、terminate preflight |
| Draw.io 执行单元 | `vuePreviewView` 把 bytes transfer 给 disposable Worker 做 XML/压缩页预检；通过后才加载本地 viewer 并直接挂入 owned DOM，不用 iframe         |
| 能力/权限边界    | renderer / worker 都拿不到绝对路径、Node、文件写入；只有不可复用的 asset URL                                                                 |

文件大小上限由一个 app-owned、穷举 adapter 配置字典统一决定，默认值为 10MiB；只有经过设计与资源
验收的格式才能覆盖默认值，例如 Monaco 8MiB、Markdown/HTML 1MiB、Office 25MiB、Draw.io 20MiB、
PDF/图片 100MiB。音视频是显式的 streaming 例外：不做产品字节上限，但仍把 capability 的有限
`maxBytes` 固定为选中时验证到的文件大小。新增 adapter 没有配置时必须回落到 10MiB，不能散落新增
常量或暗中继承另一个格式的限制。

大小校验不能只发生在 classifier 或 token 签发前。文件可能在检查后、protocol 真正开流前增长，因此每个
asset / document capability 必须至少绑定：

```ts
type PreviewAssetCapability = {
  hostId: string;
  workspaceId: string; // 不复用的 workspace-generation capability identity
  selectionRevision: number;
  canonicalPath: string;
  maxBytes: number; // 必填，不允许 Infinity / 缺省
};
```

protocol 每次请求都用新打开的 handle `fstat` 重验 regular file、canonical containment 和 `maxBytes`；
响应只交付声明的 bounded Range，不发送 probe byte；bounded transform 与 EOF 时同 handle `fstat`、当前
canonical path identity/size/mtime 重验共同拒绝读取中增长或替换，而不是把超限尾部交给 renderer。
selection / workspace revision 变化会撤销 token，并主动终止尚未完成的 response stream；旧 URL 不得在
下一 revision 复用。这一合同同时适用于 Vue `arrayBuffer()` 与 Chrome navigation，不能只保护前者。

HTML 的 document-scoped resolver 还要有资源预算：入口 HTML 沿用 1MiB；每个相对 JS/CSS/image/font/
media 资源最多 25MiB；同一 selection revision 的所有相对资源累计最多 100MiB。每个资源仍独立走上述
handle / containment / stream hard limit，任何一项超限只令该资源失败，不扩大到工作区外或无界读取。
若后续要放宽某类媒体，应修改集中常量和验收 fixture，不能把 `maxBytes` 留空。

集中字典进一步冻结为：默认 10MiB；Monaco 8MiB；Markdown/HTML 各 1MiB；Draw.io 20MiB；PDF 与
单个图片各 100MiB；XLSX/XLSM/DOCX/PPTX 各 25MiB；音频/视频保持 Range
流式读取，不设额外产品大小拒绝，但 capability 的有限 `maxBytes` 必须等于选中时 verified file size，
文件增长、替换或 revision 变化立即撤销。所有 buffered/parser 格式则取
`min(verifiedSize, formatHardCap)`。

Web Worker 提供线程隔离与可终止性，**不是独立进程或 OOM 隔离**。077 仍以硬 archive/raster/decode
上限约束峰值内存，生产 build 必须证明三个动态 subpath 的 WASM/worker 资源能从本地协议加载；允许
`vuePreviewView` `fetch()` 后 transfer `ArrayBuffer`，但不允许退回 Main / preload 解析。

### 077 当前 Office 覆盖（取代 #2/#3 的 renderer 与 Find 结论）

Task [077](../plan/tasks/onlypreview-office-ooxml-renderers-077.md) 保留 #2/#3 的扩展名、25MiB、签名、
OOXML preflight 与旧二进制 unsupported 边界，但取代其引擎和查找实现：XLSX/XLSM 使用
`@silurus/ooxml/xlsx`，DOCX 使用 `/docx`，PPTX 使用 `/pptx`；三个 viewer 都以 worker mode 运行，
禁用远端字体/超链接，并共享同一个 `office` content adapter。`findText()` 负责完整模型与所有命中
高亮，`findNext()` / `findPrev()` 负责活动命中和跨 sheet/page/slide 导航，`clearFind()` 绑定查询、文件与
viewer 生命周期。#2/#3 以下保留为 020/021 历史决策与交付证据，不再描述当前 renderer。

## #2 · `.xlsx` / `.xlsm` `历史 020，renderer 已被 077 取代`

决策者裁决：Ral 2026-08-20「XLSX/XLSM：exceljs 解析工作簿，自研只读虚拟表格渲染」。

| 项         | 决定                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 引擎       | **`exceljs`**（仓库已有 `^4.4.0`，Main 侧 Maestro 已在用，浏览器构建可直接读 `ArrayBuffer`）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 解析       | disposable Web Worker 内动态加载 ExcelJS，并由 Worker 持有 bounded workbook / search model；renderer 只接收 workbook manifest、当前 sheet 与可视范围需要的数据。虚拟表格只降低 DOM 成本，不能把整本 document parse 说成流式解析                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 渲染       | 自研只读网格：sheet 页签、列宽/行高、合并单元格、水平 left/center/right 与垂直 top/middle/bottom 对齐、数字格式（日期/百分比/货币）、基础字体与填充色；水平 `fill` / `justify` 暂不接受，直到有 bounded 可见语义                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 公式       | 显示 exceljs 读到的缓存结果值；**不重算**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 查找       | sheet adapter 把 query 发给 Worker 内完整的、已接纳的 workbook search model，不受虚拟 viewport 限制；结果携带 sheet / row / column，跨 sheet 切换、滚动并高亮单元格；匹配显示值与公式缓存结果，不匹配公式源码                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 取消       | 文件或 revision 切换时 `worker.terminate()`，并拒收旧 host / revision 结果；不能只丢弃旧 Promise 的回调                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 大表       | byte、ZIP metadata 与实际展开输出是**拒绝解析的硬闸门**；ZIP 上限为 5,000 entry、200MiB declared/actual uncompressed 总量、128MiB 单 entry、200:1 单项与汇总压缩比，并在 ExcelJS 前限制 100,000 merge records / 500,000 expanded merge cells；通过后只接纳前 64 个 sheet、每 sheet 前 100,000 行坐标/512 列坐标、全书 500,000 个非空 cell、单 cell 1,048,576 与全书 16,777,216 个 formatted UTF-16 code units。超长单 cell 完整跳过后继续；全书 text/cell cap 到达后不再接纳后续 cell。只在 model cap 截断时允许「部分预览 / 部分可搜索」，并回传 accepted sheets/cells；展示与搜索共用同一个未截断的 accepted string；搜索覆盖所有已接纳且未挂 DOM 的 cell，不把 bounded model 称作完整 workbook |
| 不做       | 图表、透视表、条件格式、批注、数据验证、宏、迷你图、图片浮动对象                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 选区字符数 | 网格选区不接入底部字符数（它统计的是文本选区语义）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

实现合同进一步冻结如下：

- Vue 先 fetch exact revision-bound 25MiB asset，再以 transfer list 把 `ArrayBuffer` 交给一个
  disposable ES module Worker；Main、preload、Shell 与 Vue UI thread 都不解析 workbook。
- exact asset 的 GET/HEAD response 为 first-party Vue fetch 提供最小 CORS 许可；token 仍是唯一 capability，
  document-scoped raw HTML resolver 不共享或放宽这条响应头合同。
- Worker 先调用 Preview service 根目录下可复用的纯 `ArrayBuffer` OOXML preflight。它以 10 秒为
  deadline，验证唯一 EOCD、central/local header 闭环与区间不重叠；仅接受 STORE/DEFLATE；拒绝
  data descriptor、encrypted/AES、multi-disk、Zip64、尾随/歧义/损坏结构。文件名按 UTF-8 flag 做 fatal
  UTF-8，否则按 CP437 解码，并拒绝控制字符、反斜杠、绝对/drive、内部 empty/dot/dot-dot、遍历与重复
  路径。合法 directory entry 可有且仅有一个终止 `/`，但必须 STORE 且压缩/解压大小均为 0；预检先
  移除该结构标记再做路径与重复 namespace 校验，因此 `//` 与 file/directory 同名碰撞仍拒绝。
  XLSX/XLSM 必须包含 `[Content_Types].xml`、`_rels/.rels` 与 `xl/workbook.xml`。
- 对未设置 UTF-8 flag 的名称，预检同时生成 canonical CP437、WHATWG tolerant UTF-8 与 JSZip browser
  decoder namespace key；任一不安全或重复都拒绝，`0x7075` Unicode path override 也不接受。
- 预检硬顶是 5,000 entries、200MiB declared/actual uncompressed 总量、128MiB 单 entry、200:1 单项与
  汇总压缩比。ExcelJS import 前逐 entry 流式验证 STORE/DEFLATE 的实际展开长度与 CRC32，实际输出超过
  declared size 时立即 cancel；实际单项/汇总 byte 与 ratio 复用同一硬顶。XLSX 还以 strict UTF-8
  流式扫描 `xl/**/*.xml`，在引擎前拒绝超过 100,000 个 merge record 或 merge range 合计展开超过
  500,000 cells 的包；`ref` 只接受一个显式 bounded `A1:B2` 两坐标范围，single-cell、entity 或歧义值
  都视为 archive invalid。纯 service 的内部 `OOXML_PREFLIGHT_TIMEOUT` 由 020 Worker 映射为
  `SHEET_RENDER_TIMEOUT`；真正硬取消由外层 disposable Worker 10 秒 timer 保证。预检成功后才动态
  `import('exceljs')`；解析加 bounded model 构建共用 30 秒 hard deadline。
- model cap 除 64 sheet、每 sheet 100,000 row coordinate / 512 column coordinate、全书 500,000
  非空 cell 外，再冻结为按原始稳定顺序只检查前 100,000 个 merge records、最多接纳 100,000 ranges、
  500,000 个显式 row/column dimension records、
  单 cell 1,048,576 与全书 16,777,216 个 formatted UTF-16 code units。按 workbook/sheet/row/column
  顺序接纳；超长单 cell 不截断而是完整跳过后继续，全书 text/cell cap 到达后停止接纳后续 cell。
  展示与 Worker search 只使用同一个完整 accepted string。仅这些 model cap 可产生
  `ready + sheet-model-cap` partial；所有 byte/ZIP/parser/timeout 闸门失败都是 unavailable。
- Worker 持有完整已接纳 model 与查找数据。Vue 只拿 manifest 和 viewport+overscan cell/intersecting-
  merge range，不复制全 sheet merge list；单次 viewport request 最多覆盖 50,000 个 row-column
  coordinates。renderer session 对 manifest/layout/viewport/search response 做 exact identity、shape 与
  model-cap runtime 校验；viewport merge 必须覆盖多个 cell、master 唯一、彼此不重叠，且与 request 的
  aggregate intersection work 不超过 viewport area。malformed message 终止为 `SHEET_PARSE_FAILED`；renderer-local
  sheet session 暴露 literal query/case/next/previous/clear/reveal，返回 total/active/coverage/target，
  不在 020 提前接入 Shell Find Bar。
- typed terminal error 至少包括 `OOXML_ARCHIVE_LIMIT`、`OOXML_ENCRYPTED`、
  `OOXML_ARCHIVE_INVALID`、`SHEET_PARSE_FAILED`、`SHEET_EMPTY`、`SHEET_RENDER_TIMEOUT`。超时、切换、
  unmount、Worker error 或 stale generation 都必须 terminate Worker 并清空 asset/viewport/search 状态。
  manifest ready 后的 unexpected terminal 由 session one-shot 通知 Store；Store 仅在 exact session + local
  generation + selection revision + reporting revision 仍当前时清 ready truth 并上报 Main。正常 dispose 与
  load failure 不触发该 observer。

日期/时间格式保留常见 `year/month/day/weekday`、`hour/minute/second`、`AM/PM` token 顺序，并明确处理
Excel 1900 闰日兼容值。ExcelJS 把 date-formatted numeric cell 读为 `Date` 后，formatter 按 workbook 的
1900/1904 epoch 反推 serial，再统一生成 display/search string，因此真实 round-trip 的 serial 59/60/61
与 1904 control 保持一致；不宣称任意 locale/calendar 或条件式自定义 number format 的像素级保真。

ExcelJS 官方只在 Node 端提供 streaming reader / writer，浏览器构建走 document-based workbook，见
[ExcelJS Browser](https://github.com/exceljs/exceljs#browser)。所以 Worker 解决的是 Main / UI 线程隔离和
可终止性，不是假装减少了完整 workbook 的解析成本。

`.csv` 继续走 Monaco 文本预览，不进网格 —— 它是文本文件，Monaco 的行列定位与查找对它更有用。

## #3 · `.docx` `历史 021，renderer/find 已被 077 取代`

[独立复核 round 2](../plan/reviews/onlypreview-docx-render-021-2.md) 已记录 **PASS**；当前账本为
`implemented; owner verification pending`，剩余闸门仅是 Ral 的真实 DOCX 视觉/运行时验证。

决策者裁决：Ral 2026-08-20「DOCX：docx-preview 渲染成接近 Word 的分页 DOM，完成安全清洗后挂载；
搜索直接使用 findInPage()」。

| 项            | 决定                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 引擎          | renderer-only 精确依赖 **`docx-preview@0.4.0`**。仓库里的 `mammoth` 只产语义 HTML、丢分页与版式，达不到「渲染」要求；`docx` 包是生成端，不是渲染端                                                                                                                                                                                                                                                                             |
| 装载前闸门    | exact revision-bound 25MiB asset 先 transfer 给 one-shot module Worker，复用同一纯 OOXML preflight 并要求 DOCX required parts；adapter 对 Worker 设 10 秒 hard timeout，成功前不得 import engine                                                                                                                                                                                                                               |
| 解析 / 渲染   | 预检通过后在 `vuePreviewView` 动态加载引擎，只调用稳定 `renderAsync()`，输出到 detached body/style；固定 `renderAltChunks/renderChanges/renderComments: false`、`ignoreFonts: true`、`renderHeaders/renderFooters: true`、`useBase64URL: false`、`experimental/debug: false`。保留分页版式、段落/表格/列表、内嵌图片与页眉页脚                                                                                                 |
| 安全          | 专用 DOM/CSS allowlist 在挂载前拒绝 active/navigation 标签与属性、`href`、不安全 `src/srcset`、remote/file/custom URL、`@import` 和所有未验证 `url()`；只有完整输出扫描已登记的 embedded `blob:` image 可留。CSP 只是纵深防御，不能替代清洗；宏、OLE、altChunk 永不执行                                                                                                                                                        |
| Blob 生命周期 | 成功时完整扫描 detached body/style，验证、登记全部 blob URL 后才挂载；普通切换、stale completion、失败与 teardown 都 revoke。engine rejection、无法取得/验证完整输出或超时必须由 Main 销毁并重建 exact `vuePreviewView`，释放 renderer 中可能失联的 URL                                                                                                                                                                        |
| 不做          | 修订痕迹与批注渲染、域代码重算、字体嵌入替换（缺字回退系统字体）、精确分页与 Word 的像素级一致                                                                                                                                                                                                                                                                                                                                 |
| 查找          | 安全 current DOM 实际 mount 且 `nextTick` 后只报告 ready 并保留 selected-text 能力；021 不发布 find capability。019 已从 ready current `docx-dom` 派生/登记 `webcontents-find` 并对当前 `vuePreviewView.webContents.findInPage()`，021 不加入 DOCX 专用索引或 Find Bar                                                                                                                                                         |
| 取消 / 超时   | `renderAsync()` 没有 `AbortSignal` 合同；普通 post-ready 切换串行 reset，并用 runtime + host + selection revision 丢弃旧结果；若离开时 DOCX 仍在 loading，Main 关闭 exact 旧 Vue view、旋转 runtime 后才进入新 revision。Main 在 DOCX loading 且 exact Vue view/token 存在时一次性 arm 30 秒外部 watchdog；首次 bounds 创建 view 也会 arm，重复 bounds/reset 不续期，renderer UI 卡死仍可超时；旧 timer 不得杀新 revision/view |
| Typed error   | 文档引擎边界固定为 `DOCUMENT_PARSE_FAILED`、`DOCUMENT_EMPTY`、`DOCUMENT_SANITIZE_FAILED`、`DOCUMENT_RENDER_TIMEOUT`；byte/signature/ZIP preflight 错误保留既有精确类型                                                                                                                                                                                                                                                         |

`docx-preview` 官方说明它依赖手工分页符、保存时记录的分页符与页面设置，**不做实时重新分页**，见
[Breaks](https://github.com/VolodymyrBaydalka/docxjs#breaks)。因此这里承诺的是 Word-like DOM，不是 Word
排版引擎的像素级结果。

## #4 · 旧二进制格式与幻灯片 `待定` `未实施`

### #4.1 · 旧 `.doc` `本轮不做` `未实施`

Ral 2026-08-20：「如果你说的是旧格式 .doc 而不是 .docx：建议暂不内置渲染，明确提示不支持并交给
系统应用打开」。因此 `.doc` 不进入 DOCX renderer，也不在 Main 静默转码；识别后显示明确
`unsupported` 真话态，并保留现有「用系统默认应用打开」。未来若复议，必须单独评估受控转换器、临时
文件生命周期、字体与分页漂移，不能伪装成 docx-preview 的扩展名支持。

`.xls` / `.ppt`（Office 97–2003 二进制）仍见 [PQ-A](#pending-questions--待定项)。`.pptx` 已由
[077](../plan/tasks/onlypreview-office-ooxml-renderers-077.md) 定为 `@silurus/ooxml/pptx`，不再属于待定项。

## #5 · 图片与音视频 `已定 2026-08-18`

[独立复核 round 1](../plan/reviews/onlypreview-media-truthful-state-022-1.md) 曾因 renderer error
family 授权过宽记录 **BLOCKED**；该发现已由 exhaustive adapter discriminator 与负向 Region 行为测试
修复。[独立复核 round 2](../plan/reviews/onlypreview-media-truthful-state-022-2.md) 已记录 **PASS**。
当前账本为 `implemented; owner verification pending`，剩余闸门仅是 Ral 的真实图片/音视频视觉与运行时
验证。

| 类别                     | 现状                                           | 本轮决定                                                                                                |
| ------------------------ | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 图片                     | `<img>` 覆盖 png/jpg/gif/webp/avif/bmp/ico/svg | 保持原生解码；**新增解码失败的真话状态**（文件名、扩展名、大小 + 外部打开），不再是破图图标             |
| HEIC / HEIF / TIFF / RAW | 未列入，落 `unsupported`                       | 保持不渲染；是否加 Main 侧转码见 PQ-C                                                                   |
| 音频                     | `<audio>` 覆盖 mp3/wav/ogg/m4a/aac/flac        | 保持原生播放器 + `MediaError` 真话状态                                                                  |
| 视频                     | `<video>` 覆盖 mp4/webm/ogv/mov/m4v            | 同上。`.mkv`/`.avi`/`.wmv`/`.flv` 与 ProRes 等平台不解码的容器/编码**不加进可预览集合**，落明确不支持态 |

判据：`Ral「音视频就是播放器可播放」` —— 能播的直接播，不能播的说明白，不做转码墙。

上述图片与媒体全部是 `vuePreviewView` 的 Vue 组件，不进入 `chromePreviewView`：图片组件至少提供
适应窗口、放大、缩小、重置，放大后可拖动查看；音频/视频封装原生 `<audio controls>` /
`<video controls>`，保持浏览器解码能力，不引入转码器。

022 将支持目录冻结为：图片 `.png/.jpg/.jpeg/.gif/.webp/.avif/.bmp/.ico/.svg`，音频
`.mp3/.wav/.ogg/.m4a/.aac/.flac`，视频 `.mp4/.webm/.ogv/.mov/.m4v`。这些目录只选择 native adapter，
不承诺当前 Chromium/OS 一定有对应 codec。明确识别但不内置解码的目录固定为图片
`.heic/.heif/.tif/.tiff/.raw` 与媒体 `.mkv/.avi/.wmv/.flv`；它们直接进入 unsupported 真话态，不签发
asset，也不挂 `<img>/<audio>/<video>`。其它相机 RAW 或媒体别名不能由实现自行扩张。

图片是 bounded-buffered adapter：Main 的 100MiB exact asset 由 Vue 完整 `fetch` 并核对预期长度；随后
创建 renderer-owned Blob URL，以未进入 live DOM/accessibility tree 的 `Image.decode()` 验证可解码，只有
exact revision 的 live `<img>` mount 成功后才报告 ready。Main 此时撤销原 asset；普通切换、读取/解码
失败和 unmount 都 abort fetch 并对每个已创建 Blob URL 恰好 revoke 一次。空文件、asset/stream 读取失败、
签名不符、decoder failure 分别使用独立 typed state，不让破图节点短暂进入界面。

图片 viewport 初始 Fit 不把小图放大到 100% 以上；Zoom In/Out 以 1.25 倍步进，最大为 `8`，有效最小值为
`min(0.1, currentFitScale)`：超大图片允许 Fit 降到 10% 以下，以保证完整图片仍能进入 viewport；Reset
回到精确 100%。居中平移每轴限制为
`±max(0, (naturalSize * scale - viewportSize) / 2)`。Fit resize 重算 scale 并归零 offset；manual/100%
resize 只重新 clamp。只有溢出轴可被 primary pointer 或聚焦 viewport 的方向键移动，pointer capture、
cancel/lost-capture 与 revision teardown 都清掉 drag state。

音视频在挂 player 前只做一次 exact asset `HEAD`：成功、`Content-Length` 等于 verified selection size，且
经 CORS 显式暴露的 `Accept-Ranges` 为 `bytes` 后才挂 native player；正文不 blob、不预读整包，仍由 Range
response 支持 seek。媒体 asset 使用 selection-lifetime authority，不受 legacy/unbound token 的 30 分钟
TTL；selection、workspace、host revoke 仍立即终止 stream，已有 bounded registry 达到容量时仍可淘汰最老
selection token。`MediaError.code` 1/2/3/4 分别映射 aborted/network/decode/source-not-supported；空文件、
HEAD/read failure 与无 `MediaError` 的 load failure 另有 typed state。播放器 30 秒内既没有
`loadedmetadata` 也没有 `error` 时进入 read failure，不能永久停留为 loading/dead player。扩展名永远不能
把播放器 ready 当成 codec 保证。

signature gate 保留 adapter 前的低成本真伪闸门，但不能误拒常见合法文件：SVG 在 bounded probe 内允许
XML declaration、comment 与 DOCTYPE 后出现 `<svg>`；AAC 接受 ADTS sync 或 `ADIF`；MOV/QuickTime 接受
plausible atom size 后的 `ftyp/moov/mdat/wide/free/skip` 首 atom。它们只决定是否尝试原生 decoder/player，
不替代离屏图片 decode 或 Chromium 的实际媒体 codec 结果。

## #6 · 保真上限与真话状态 `已定 2026-08-18`

每个格式组件必须区分四种终态，界面语义不同：

```text
渲染成功             → 完整内容体
adapter 支持有界模型  → "部分预览 / 部分可搜索：已接纳 N 行（或 N 个 cell）"，附外部打开
超过硬上限且不支持部分 → "超过预览上限，未加载内容"，正文 0 byte / parser 未启动，附外部打开
不支持 / 解码失败      → 类型 + 大小 + 修改时间 + 外部打开（现有 unsupported 态复用）
```

当前只有**通过 byte / ZIP 硬闸门后**的 XLSX bounded workbook model 允许「部分预览」；文本、HTML、
PDF、DOCX 超过各自 byte hard limit
都直接拒绝预览，不能显示「前 N 页/行」造成内容已部分加载的错觉。不允许出现：空白内容体、破图占位、
静默截断、把解析异常显示成「空文件」。

直接 unsupported 与所有 typed unavailable/error 共用同一份 compact metadata presentation：文件名、
类型或扩展名、大小、修改时间；其上保留具体 localized reason。系统打开/Reveal 仍由 Shell toolbar 的
唯一 FileActions 提供，Vue 内容态不复制操作按钮。该规则同样覆盖图片/媒体 decoder error、Office
parser/OOXML error、signature/empty/size error，而不只覆盖 classifier 直接落入 unsupported 的路径。

媒体终态进一步要求 Main 的单向状态门：exact image/media `ready` 只允许把 `loading` 推到 `ready`；
同 revision 的 runtime error 可把 `loading` 或 `ready` 推到 `unavailable`。错误之后迟到的 load/canplay
事件不能再把失败态复活。

## #7 · 引擎装载与包体 `已定 2026-08-18`

024 已删除 Vue 内的 `unpdf/pdfjs` 活跃 renderer，PDF 由 Chromium 直出；`vuePreviewView` 仍使用
Monaco/Markdown。077 在一次 Office 预检成功后只动态 import 当前
`@silurus/ooxml/{xlsx,docx,pptx}` subpath；引擎、WASM 与 viewer worker 都不得进入 Preview 首帧，
因为任一次预览只用得上一个重引擎。

决定：**为 `vuePreviewView` 的格式组件和引擎开一个记录在案的动态 `import()` 例外**，仅限
`src/renderer/onlypreview/preview/src/` 下明确承担格式引擎装载的 service、Worker 与 component
（Monaco/Markdown/Office/image/media/Draw.io component、OOXML preflight/viewer service、Draw.io
viewer loader）；`pdf.js` 不再属于目标 bundle。所有格式组件都由当前 adapter 通过
`defineAsyncComponent()` / 动态 `import()` 按需加载；Draw.io 的 4MiB 级 viewer runtime 还必须在
文件与 Worker 预检通过后才装载，不能因为创建 `vuePreviewView` 或预览其他格式进入首帧。
这与 bitterless「静态顶层 import，函数内禁止动态 import」的通用规则冲突，因此在此
显式留档：Vite 只能通过动态 import 做 code-split，没有例外就只能全量 eager 装载。规则的其余部分
（业务代码、store、service）不变。

## #8 · 扩展名路由与装载前闸门 `已定 2026-08-18`

来源：Ral 2026-08-18「注意要能依据不同的文件后缀进行渲染，而且防止出现视频文件改成 txt 结尾也去渲染
导致的性能问题」。

### 现状：023 的大小闸门由 035 扩展为未知文件文本兜底

| 步  | 机制       | 实码                                                                                              | 对"视频改名 `.txt`"的效果                                                      |
| --- | ---------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 1   | 扩展名路由 | `classifyOnlyPreviewExtension()`：已知专用/显式不支持集合优先，其余普通文件进入文本兜底         | `.txt` → `text`；未知/无后缀/复合后缀 → `text` + `plaintext`                   |
| 2   | 大小上限   | opened handle 的 metadata 先检查：Monaco 8MiB、Markdown/HTML 1MiB                                 | 500MiB 日志改名 `.txt` → `TEXT_TOO_LARGE`，正文 0 byte，不创建 model           |
| 3   | 有界读取   | 文本最多精确 `limit` chunk read + tolerant UTF-8 / BOM UTF-16 decode + 读后 identity/size/mtime fence | 限额内 mp4/ZIP 改名或未知后缀可显示乱码；增长/替换丢弃 revision，不返回截断正文 |
| 4   | 非文本签名 | `matchesSignature()`：PDF/image/audio/video/OOXML 最小签名                                        | 后缀与内容不符 → `SIGNATURE_MISMATCH`，Region 不签发 asset/document capability |

1GiB `.vue` 现在直接由 opened-file size 拒绝，正文读取为 0，不解码也不创建 Monaco model；它仍保留
目录/文件名 metadata。实现不尝试通过采样证明文本内容，只执行
[#8.1](#81--文本候选按后缀与大小准入-已定-2026-08-20-已实施) 的 extension/exact-basename → size →
bounded tolerant read 顺序。

### #8.1 · 文本候选按后缀与大小准入 `已定 2026-08-20` `已实施`

原始要求是防二进制伪装；曾拟定 ZIP 结构与严格编码校验。Ral 随后连续拍板：「优先按后缀来判断，
然后看大小，不要看开头的字节了」、「zip 改成 js 渲染的时候乱码就行了」，并补充「因为非正常行为
产生这种结果是可预料的，只要不产生困扰就行」(2026-08-20)。因此结论反转为：**文本类后缀是 adapter
权威，大小是唯一内容准入闸门；限额内不因 bytes、ZIP 结构或编码失败拒绝。异常结果可以难看，但影响
必须局限在该文件。** 被否的严格文本验证方案完整留在 [#rejected](#rejected--已否留档)。

```text
extension / known filename → candidate adapter
    → 安全打开 + handle fstat → adapter byte hard limit
        ├─ 超限：TEXT_TOO_LARGE；正文 0 byte
        └─ 未超限：bounded read → tolerant decode / format renderer
              → renderer ready；允许乱码
```

| 内容路径                                   | byte hard limit | 限额内                                                                                         | 超限后仍可用               |
| ------------------------------------------ | --------------: | ---------------------------------------------------------------------------------------------- | -------------------------- |
| Monaco 源码 / 普通文本（含已知源码与所有剩余未知/复合/无后缀文件） |            8MiB | 宽容解码；已知扩展用语言映射，其余用 `plaintext`；非法序列可显示为 `U+FFFD`                  | 目录列举与文件名搜索       |
| Markdown / HTML                            |            1MiB | 按扩展名进入既定 renderer；Markdown 仍经 DOMPurify，HTML 仍受 sandbox / CSP / 无 Node 权限约束 | 同上                       |
| Global Search 正文索引                     |            1MiB | 文本兜底按宽容解码结果写 SQLite chunks / FTS；小型二进制可能产生垃圾命中，这是已接受代价       | 文件 metadata 与 Files 结果 |

具体结果：

| 输入                  | Preview                                            | 当前文件 Find      | Global Search                         |
| --------------------- | -------------------------------------------------- | ------------------ | ------------------------------------- |
| 512KiB ZIP 政名 `.js` | Monaco 显示乱码，不执行                            | 可查找解码后的字符 | 可能索引乱码                          |
| 512KiB ZIP 保留 `.zip` | Monaco `plaintext` 显示乱码，不执行                | 可查找解码后的字符 | 可能索引乱码                          |
| 2MiB ZIP 政名 `.js`   | 同上                                               | 同上               | 超过 1MiB，只保留 filename / metadata |
| 1GiB 文件命名 `.vue`  | `TEXT_TOO_LARGE`，正文 0 byte，不创建 Monaco model | unavailable        | 只保留 filename / metadata            |

“不产生困扰”不是主观文案，而是以下扰动预算：

| 维度   | 验收边界                                                                                                                              |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| 故障域 | 乱码、解码替代字符和偶发垃圾命中只属于该文件；不得让 Preview host、Global Search、索引 generation 或其他文件进入 failed / pending     |
| 资源   | Preview 8MiB、Markdown/HTML 与正文索引 1MiB 的硬顶不变；读取、解码、SQLite chunk 数和 Monaco model 生命周期都有界，切文件立即 dispose |
| 编辑器 | Monaco 开启 large-file optimization，并按大小/单行长度限制 tokenization 与超长行渲染；这些限制只看规模，不重新引入内容嗅探            |
| UI     | 不为乱码弹 modal、toast 或自动重试；内容区正常显示可得到的字符，文件操作和切换保持可用                                                |
| 执行   | `.js` / `.mjs` / `.cjs` / `.vue` 等永不执行；Markdown 仍 sanitize；HTML 仍只在既定 sandbox content 中执行，不能获得 Node / Electron / filesystem 能力   |
| 搜索   | 垃圾字符只有真实匹配 query 时才可形成该文件的结果；不得触发逐次全文 fallback、阻塞索引 promotion 或清空上一版 active index            |

| 不变量        | 决定                                                                                                                                                                        |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 分类          | 扩展名选择 adapter：PDF/图片/媒体/Office/Draw.io 与显式不支持格式优先；其余普通文件一律进入 inert `plaintext` 兜底，不做自动 head sniff                                       |
| 大小          | 用安全打开 handle 的 `fstat` 先判上限；实际读取最多精确 `limit`，随后重验 identity/size/mtime 防 stat 后增长。禁止先整包 `readFile()` 再量大小                                  |
| 解码          | 文本路径使用宽容解码，解码失败不改变分类；乱码只进入 inert text / sanitizer / sandbox，不成为 Node、Electron 或 filesystem 权限                                             |
| 执行          | `.js` / `.mjs` / `.cjs` / `.vue` / `.css` 等源码在 Monaco 只展示，不编译、不执行；`.html` 的脚本执行边界仍以姊妹文档 #7.3 为准                                                                |
| 非文本 parser | PDF、图片、媒体、OOXML 仍保留签名、ZIP preflight 与解析上限；本次裁决只取消文本 adapter 的内容嗅探/拒绝，不能把错误 bytes 交给 Chromium PDF viewer 或 `@silurus/ooxml` viewer |
| revision      | 读取与结果仍绑定同一 opened handle、host、selection revision；文件变化或读取超过上限时丢弃旧结果                                                                            |

以下 exact case-insensitive basename 集合仍提供已知语言提示，但不再决定能否作为文本打开：`Dockerfile`、
`Containerfile`、`Makefile`、`Rakefile`、`Gemfile`、`Procfile`、`README`、`LICENSE`、`NOTICE`、
`CHANGELOG`、`AUTHORS`、`CODEOWNERS`、`.gitignore`、`.gitattributes`、`.gitmodules`、`.dockerignore`、
`.editorconfig`、`.npmrc`、`.yarnrc`、`.prettierrc`、`.eslintrc`、`.stylelintrc`、`.babelrc`。其中敏感
文件仍可显式预览，但 Global Search 正文资格继续受敏感文件 filename-only 规则约束。

回归合同至少覆盖：`.cjs` 与 `.js` 同样进入 Monaco、使用 JavaScript language、进入 Global
Search 正文资格并出现在系统文件关联清单；512KiB ZIP 无论改名 `.js` 或保留 `.zip` 都能以
inert 乱码进入 Monaco且不报错/不卡住索引；`AGENTS.md.bak` 使用 `plaintext`；1MiB / 8MiB
精确边界、稀疏 1GiB `.vue` 正文 0 byte、stat 后增长、切换后
model 释放，以及 Markdown sanitizer / HTML sandbox 不因宽容解码而放宽。023 已删除独立 head sample
与二进制/严格编码拒绝，并以 Main/Global Search parity matrix、exact cap、增长/替换行为测试锁定该合同。

### 本轮必须补齐的闸门

| id     | 闸门                                                                                                                                                                                                                                                                                                                                                                                                                                                   | 归属任务                                                                                               | 理由                                                                                                                                |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| **G1** | OOXML zip 魔数：`.xlsx`/`.xlsm`/`.docx`/`.pptx` 必须以 `50 4B 03 04`（`PK\x03\x04`）开头，否则 `SIGNATURE_MISMATCH` 且不签发 `assetUrl`                                                                                                                                                                                                                                                                                                                 | [077](../plan/tasks/onlypreview-office-ooxml-renderers-077.md)                                 | 伪装文件不得进入 OOXML viewer                                                                                                     |
| **G2** | 装载前大小硬顶：Office adapter 均为 25MiB；超限 → "超过预览上限"真话态 + 外部打开，**不解析**                                                                                                                                                                                                                                                                                                                                                     | 077                                                                                             | viewer 会把整包读入并展开，没有硬顶等于把渲染进程交给文件大小                                                                    |
| **G3** | 顺序不可颠倒：**扩展名 → 签名/大小闸门 → OOXML Worker preflight → 才动态 `import()` 当前 subpath**。伪装或超限文件不得触发引擎装载                                                                                                                                                                                                                                                                                                                   | 077                                                                                             | 否则一个改名文件就白拉一个 MiB 级 chunk 并进入解析                                                                                  |
| **G4** | 引擎加载前在 Worker 校验 ZIP exact closure、entries ≤ 5,000、declared/actual uncompressed sum ≤ 200MiB、single entry ≤128MiB、单项/汇总 ratio ≤200:1；逐 entry bounded stream 验 actual length + CRC32，namespace key 安全唯一，并拒绝 encrypted / multi-disk / Zip64 / duplicate / overlap / traversal / malformed package；三种格式还各自要求 workbook/document/presentation 根 part | 077                                                                                             | 只信 declared metadata 或把 bytes 直接交给 viewer 时，25MiB OOXML 仍可实际展开到 GB 级                                              |
| **G5** | 渲染侧纵深校验：`fetch` 得到 `ArrayBuffer` 后先核前 4 字节与长度，再交 Worker/引擎。主进程闸门是权威，这一层是防御深度                                                                                                                                                                                                                                                                                                                                | 077、[023](../plan/tasks/onlypreview-preview-guards-023.md)                                     | 单点闸门失效时不至于直接打死渲染进程                                                                                                |
| **G6** | `SIGNATURE_MISMATCH` 的界面文案明确说"后缀与内容不符"，而不是笼统失败                                                                                                                                                                                                                                                                                                                                                                                  | 023                                                                                                    | 用户需要知道是改名而不是文件坏了                                                                                                    |
| **G7** | PDF 100MiB 字节上限 + `chromePreviewView` 导航前/开流时闸门                                                                                                                                                                                                                                                                                                                                                                                            | 023/024 已实施                                                                                         | 签发 exact asset URL 前与 response stream/EOF 重验 100MiB 上限，再交 Chromium 内置 PDF viewer                                       |

G7 是这次顺带查出的既有性能缺口。023/024 已共同收口 PDF 直出、100MiB 与流期增长/替换边界；
同一 guard 任务也已覆盖图片 100MiB、Office 25MiB、文本 size-first 与音视频 verified-size Range。

## #9 · `.drawio` `已定 2026-08-26` `已实施`

`.drawio` 是需要解释 XML 模型后再绘制的结构化格式，不是 Chromium 原生可直接展示的文档。因此新增
`drawio-viewer` adapter，路由到 **`vuePreviewView`**。Vue 的 `DrawioPreview` 组件负责 loading/error、
页面与缩放控件及销毁；实际绘图使用固定版本、本地随包分发的 diagrams.net 官方只读 viewer。
**不引入完整 draw.io 编辑器，不在运行时加载 `viewer.diagrams.net` 或 `embed.diagrams.net`，也不依赖
非官方 Vue wrapper。**

阶段裁决：Ral 2026-08-26「好，参考他们的桌面端实现只读渲染先」，并补充「vuepreview 按需加载渲染
组件进行渲染哦」。因此 032 只交付标准 `.drawio` 的只读渲染、页面/图层/缩放与真话失败态；当前文件
Find 先注册 `none`，图元文字模型搜索与定位高亮在只读渲染稳定后单列任务，不能把当前可见 DOM 的
`findInPage()` 冒充完整图搜索。

### #9.1 · 无 iframe 的本地 DOM 挂载 `已定 2026-08-26` `已实施`

决策者裁决：Ral 2026-08-26「我不想用 iframe 不可以么」。结论是 **可以，且本方案不使用 iframe**。
官方 HTML viewer 本来就支持把 XML 配置放进普通 HTML 元素的 `data-mxgraph`，由 viewer runtime 直接在
当前 document 中渲染；iframe 是另一种独立的嵌入选项，并非只读 viewer 的前提：
[HTML viewer](https://www.drawio.com/docs/manual/export/embed-html/)、
[viewer-static source](https://github.com/jgraph/drawio/blob/dev/src/main/webapp/js/viewer-static.min.js)。

draw.io Desktop 也不是把主编辑器放进 iframe。官方源码显示它把 `jgraph/drawio` 作为 Git submodule，
Electron `BrowserWindow` 直接 `loadURL(file://.../drawio/src/main/webapp/index.html)`；preload/IPC 负责本地
文件能力，窗口开启 `webSecurity` 与 `contextIsolation`，并以 CSP 和请求拦截限制资源：
[desktop submodule](https://github.com/jgraph/drawio-desktop/blob/dev/.gitmodules)、
[desktop Electron main](https://github.com/jgraph/drawio-desktop/blob/dev/src/main/electron.js)。它证明 draw.io
runtime 可以作为 Electron WebContents 的顶层 DOM 应用运行；但 Desktop 携带的是完整编辑器，不适合直接
复制到只读 Preview。

更贴近本阶段的是 draw.io Desktop 的 macOS Quick Look：其 `quicklook-preview.html` 读取文件文字，给
普通 `.mxgraph` 节点设置 `data-mxgraph`，然后调用 `GraphViewer.processElements()`；构建脚本把
`viewer-static.min.js` 一起复制进 sandboxed Preview Extension，不走远端脚本。032 pin 当前 Desktop
submodule 对应的 drawio commit `85a95c9066d8db7e90a2a2aa25f1179945d08ab6`，viewer SHA-256 为
`2fabaaa3e28d5f80f943285a2ce19c22cf870857203255f1e0347ef93693a297`，并保留上游 Apache-2.0
许可。commit 或 hash 不符必须使资产审计失败，不能静默换成 `dev` 最新文件。

Bitterless 采用更小的对应结构：`vuePreviewView` 已是独立 sandboxed WebContents
（`sandbox: true`、`contextIsolation: true`、`nodeIntegration: false`），所以无需再套 iframe。
`DrawioPreview.vue` 给 viewer 一个专用 mount element，首次打开 `.drawio` 时动态装载本地 runtime；
切换 selection/revision 时销毁 graph 实例、移除 viewer 生成的 DOM/监听器并清空 mount element。

```text
.drawio extension → adapter size dictionary (20MiB override; 10MiB default) → revision-bound asset
    → 按需加载 DrawioPreview component → disposable Worker 预检 XML/压缩页
        ├─ 超出 32MiB expanded / 128 pages / 20,000 cells / 10s：真话拒绝，不装载 viewer
        ├─ 任何 embedded/external raster/SVG/data/blob/image shape/source：DIAGRAM_LIMIT
        └─ 通过：动态装载本地 viewer → 专用 DOM mount 只读渲染
                └─ 本阶段 Find = none；完整 label model 搜索后置
```

| 项       | 合同                                                                                                                                                                                                                                                                                                                                                                      |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 路由     | `.drawio` → `vuePreviewView` / `drawio-viewer`；它既不是 `chromePreviewView` 原生格式，也不是普通 text adapter                                                                                                                                                                                                                                                            |
| 按需加载 | `PreviewSurface` 对所有格式组件使用 async component；只有 `drawio-viewer` adapter 加载 `DrawioPreview` chunk，且只有 Worker 预检通过后加载本地 viewer 资产                                                                                                                                                                                                                |
| 引擎     | 本地固定版本的官方只读 viewer，独立资产；Vue wrapper 不复制 draw.io 渲染逻辑，**不用 iframe**，只管理专用 mount element 与 graph 生命周期                                                                                                                                                                                                                                 |
| DOM 边界 | viewer 只允许写入组件拥有的 mount element；每次 render 前后做基线检查，若产生 document 级残留 listener/style/global state，则重建整个 `vuePreviewView`，不让污染进入下一个格式                                                                                                                                                                                            |
| 网络     | viewer session 默认离线；阻断外部字体、链接导航、新窗口和下载。首期所有图片资源在预检阶段已拒绝，不进入 viewer。外链只允许交回 Shell 后按既有外部打开策略处理                                                                                                                                                                                                             |
| 安全     | `.drawio` 仍是非文本 parser 格式：扩展名先路由，集中字典给它 20MiB 文件上限（默认仍为 10MiB），再以 fixed-chunk outer XML、base64、DEFLATE、percent/UTF-8 与 XML scanner 做流式预检；拒绝 DOCTYPE/ENTITY，限制 32MiB 展开量、128 页、20,000 cells，并以 `DIAGRAM_LIMIT` 拒绝 embedded/external raster/SVG/data/blob、image shape/source、`mxImage`/`image` 等全部图片内容 |
| 性能     | Main 只签发 revision-bound bounded asset；Worker 在 10 秒内完成预检；30 秒 Main watchdog 可销毁阻塞的 Vue view。超限/超时/切文件终止 Worker，并销毁 graph/清空 mount                                                                                                                                                                                                      |
| 查找     | **032 注册 `none`**。`findInPage()` 只能看到当前已绘制 DOM，覆盖不了未显示页面/图层；后续必须搜索 bounded cell label model，再按 cell id 定位并高亮                                                                                                                                                                                                                       |
| 首期范围 | 无图片资源的标准 `.drawio` XML 只读预览、页面、图层、缩放；PNG/SVG 内嵌 draw.io XML 继续按普通图片显示；`.drawio` 内任何图片资源均以 `DIAGRAM_LIMIT` 真话拒绝，不做缺失资源降级                                                                                                                                                                                           |

主要 tradeoff：无 iframe 省掉一层 document/消息桥，但 viewer 与 Vue 共用同一个 renderer document；因此
必须验收全局污染与 teardown。若固定版本 viewer 无法做到可靠清理，fallback 是重建现有 `vuePreviewView`
WebContents，而不是重新引入 iframe。

## #pending-questions · 待定项

| id       | 项                                                     | 所在                                       | 类型   | 阻塞性         | 倾向 / 拍板需要什么输入                                                                                                                     | 状态                                                                                                                                    |
| -------- | ------------------------------------------------------ | ------------------------------------------ | ------ | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **PQ-A** | `.xls` / `.ppt`（97–2003 二进制）是否进入内置 renderer | [#4](#4--旧二进制格式与幻灯片-待定-未实施) | 待拍板 | 可后置         | **倾向不渲染**：SheetJS 只能解决 `.xls`，`.ppt` 仍无同等级方案；tradeoff 是依赖系统应用。拍板需要 Ral 明确这两种格式是否值得分别增加引擎    | **待定**；原问题中的 `.doc` 已拆入 PQ-D 并拍板，本行继续保留未决的 `.xls` / `.ppt`                                                      |
| **PQ-B** | `.pptx` 期望保真度？                                   | [#4](#4--旧二进制格式与幻灯片-待定-未实施) | 已拍板 | —              | 使用 `@silurus/ooxml/pptx` 的虚拟化只读 slide viewer，接受非 PowerPoint 像素/动画级保真                                                | **已定 2026-08-28 · 077 实施中**                                                                                                      |
| **PQ-C** | HEIC / HEIF / TIFF 是否需要 Main 侧转码后预览？        | [#5](#5--图片与音视频-已定-2026-08-18)     | 待拍板 | 不阻塞 022     | **倾向本轮不做**，先给真话不支持态；HEIC 在 macOS 相册/iPhone 照片里常见，若要做则单列一轮（Main 侧 `sips`/`sharp` 转码 + 缓存 + 失效策略） | 待定                                                                                                                                    |
| **PQ-D** | 旧 `.doc` 是否进入内置 renderer                        | [#4.1](#41--旧-doc-本轮不做-未实施)        | 待拍板 | 可后置         | 原倾向不渲染；tradeoff 是不能在 Bitterless 内看旧 Word 文件。拍板需要 Ral 选择内置转换或系统应用打开                                        | **本轮不做 · 未实施**（Ral 2026-08-20）：明确 unsupported + 系统应用打开；连带收口 021 的 `.doc` 范围，不再等待旧格式决策               |
| **PQ-E** | `.drawio` 是否按本地官方只读 viewer 方案进入实现       | [#9](#9--drawio-已定-2026-08-26-已实施)    | 待拍板 | 可后置         | `vuePreviewView` async component + 本地 viewer 直接 DOM mount；不用 iframe、完整 editor或在线服务；首期只读，Find 后置                      | **已定 2026-08-26 · 已实施**：032 已通过独立复核，等待 Ral 运行时/视觉验证；首期拒绝图片资源，图元 Find 继续后置                         |

收敛记账：账本 5 行 · 已解 3 行 · 待拍板 2 行 · 未解的 `阻塞定案` **0 条**。本轮把原 PQ-A 保留给
未决的 `.xls` / `.ppt`，并把已解 `.doc` 拆为 PQ-D，阻塞数未增加；`.xlsx` 已由 020 实施并通过独立
复核，当前等待 Ral 手测；`.docx` 已由 021 实施并通过独立复核，等待 Ral 真实 DOCX 视觉/运行时
验证。#8.1 是文本准入合同细化；#9/PQ-E 已由 032 实施首期只读渲染与按需组件加载，图元 Find 后置且
不阻塞首期；被否方案留在 [#rejected](#rejected--已否留档)，共 2 块。

## #rejected · 已否留档

### 文本候选 ZIP 结构与严格编码拒绝 `已否 2026-08-20`

| 项           | 留档                                                                                                                                                                                                                                                                                                         |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 所属决策章   | [#8.1](#81--文本候选按后缀与大小准入-已定-2026-08-20-已实施)                                                                                                                                                                                                                                                 |
| 原方案       | extension hint → size → `limit + 1` bounded read；验证 ZIP EOCD / central directory / local-header 闭环，再做 UTF-8 / BOM UTF-16 fatal decode、NUL/C0 control scan。ZIP、非法编码与控制字符分别落 `BINARY_TEXT` / `INVALID_ENCODING`，Preview 不创建 Monaco model，Project Search 只保留 filename / metadata |
| 原依据       | [PKWARE APPNOTE 6.3.10](https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT)（2022-11-01）规定 ZIP 内部记录结构，可在不解压 entry 的情况下验证；技术上可行且 8MiB 内成本有界                                                                                                                         |
| 否决理由     | Ral 接受异常改名文件显示乱码，只要求不产生困扰；严格识别增加两套执行边界的容器/编码策略与测试成本，却不改善正常后缀文件体验。最终安全边界改为大小硬顶、inert Monaco、sanitizer/sandbox 和故障域隔离                                                                                                          |
| 已接受代价   | 小二进制改名 `.js/.vue` 会显示乱码；1MiB 内可能进入正文索引并产生该文件的垃圾命中。它不得导致执行、卡顿、弹窗、索引失败或跨文件状态污染                                                                                                                                                                      |
| 复议触发条件 | 有真实 fixture 证明在现有大小硬顶与 renderer 隔离下，乱码文件仍造成 Preview/索引 crash、持续卡顿、权限逃逸或跨文件污染；仅“显示难看”不构成复议理由                                                                                                                                                           |

### Draw.io viewer iframe `已否 2026-08-26`

| 项           | 留档                                                                                                                                                     |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 所属决策章   | [#9.1](#91--无-iframe-的本地-dom-挂载-已定-2026-08-26-已实施)                                                                                            |
| 原方案       | `DrawioPreview.vue` 内创建隔离 iframe，在 iframe document 中装载本地官方只读 viewer，通过消息桥传 XML、查找与 cell 定位结果                              |
| 原依据       | iframe 可隔离 viewer 的全局脚本、样式和 DOM；完整 editor 的官方 embed mode 也采用 iframe + `postMessage`                                                 |
| 否决理由     | Ral 明确不希望使用 iframe；现有 `vuePreviewView` 已经是 sandboxed 独立 WebContents，可承担进程/权限故障域，额外 iframe 不是只读 viewer 的必要条件        |
| 已接受代价   | viewer 与 Vue 共用 document，必须实现 graph/DOM/listener teardown 并验证无跨格式污染；清理不可信时允许重建整个 `vuePreviewView`                          |
| 复议触发条件 | 固定版本 viewer 的 document-global 行为无法被可靠清理，且重建 `vuePreviewView` 导致不可接受的切换延迟或状态丢失；只有实测满足这两个条件才重新讨论 iframe |

---

交付基础：
[onlypreview-dual-preview-region-024](../plan/tasks/onlypreview-dual-preview-region-024.md) 已实施
`chromePreviewView` / `vuePreviewView` 双 surface、Chromium 直出 PDF，以及导航前和流期的 100MiB PDF
上限。[onlypreview-preview-guards-023](../plan/tasks/onlypreview-preview-guards-023.md) 已实施文本准入、
非文本 primitive guard 与 revision-bound stream fence。
[onlypreview-xlsx-grid-020](../plan/tasks/onlypreview-xlsx-grid-020.md) 已实施 ExcelJS Worker、动态 chunk、
ZIP preflight 与 bounded workbook model，已通过独立复核，当前为
`implemented; owner verification pending`，等待 Ral 手测。
[onlypreview-docx-render-021](../plan/tasks/onlypreview-docx-render-021.md) 已实施，状态为
`implemented; owner verification pending`；[独立复核 round 2](../plan/reviews/onlypreview-docx-render-021-2.md)
已记录 **PASS**，当前等待 Ral 真实 DOCX 视觉/运行时验证。
[onlypreview-media-truthful-state-022](../plan/tasks/onlypreview-media-truthful-state-022.md) 已实施，状态为
`implemented; owner verification pending`；
[独立复核 round 2](../plan/reviews/onlypreview-media-truthful-state-022-2.md) 已记录 **PASS**，当前等待 Ral
真实图片/音视频视觉与运行时验证。
[019 查找](../plan/tasks/onlypreview-find-in-file-019.md) 已按 Shell Find Bar、Main-owned revision 与
双 surface Region 实施，当前为 `implemented; owner verification pending`；
[独立复核 round 2](../plan/reviews/onlypreview-find-in-file-019-2.md) 已记录 **PASS**，格式组件已在该拓扑上
接入统一查找 adapter，剩余闸门为 Ral 的真实应用验证。

[onlypreview-design-completion-025](../plan/tasks/onlypreview-design-completion-025.md) 已把 direct
unsupported 与 image/media/Office/parser/signature/empty/size 失败统一到同一 metadata view model/SFC
block，同时保持 Shell toolbar 为唯一 native action owner；OOXML、Sheet 与相关回归源已拆到每文件不超过
800 行，动态格式实现仍只允许从 Preview format service、Worker 与 component 边界加载。当前为
`implemented; owner verification pending`；
[completion audit](../plan/reviews/onlypreview-design-completion-025-1.md) 已 **PASS**。本文与双 Preview
设计的非 E2E 实现已闭合，剩余仅 Ral 的真实应用、运行时与视觉手测。

下游交付闸门：020 已把「Preview renderer 直接解析 + generation 丢弃」改成 Worker + terminate，并把
ZIP preflight 放在 ExcelJS 之前，这一闸门已满足；021 已把「取消 render」拆成 fetch / preflight
真取消、`renderAsync()` revision 丢弃 + detached dispose、以及超时销毁 / 重建 `vuePreviewView`，当前
已通过独立复核，等待 Ral 真实 DOCX 视觉/运行时验证。
DOCX `findInPage()` 已确定由 Main 对 `vuePreviewView` 调用。023 已将旧的
text sniff 顺序替换为 **extension hint → size → bounded tolerant decode**，并纳入 #8.1 的扰动预算与
回归用例；非文本 parser 的 signature / preflight 不受影响。
