# OnlyPreview 预览格式覆盖

本文决定 OnlyPreview「渲染一切」的格式边界：哪些格式由谁渲染、保真上限在哪、哪些明确不渲染但要给
真话状态。

**状态：023/024 已实施双 surface、bounded HTML/PDF/asset 与 size-first tolerant text guards；020/021/022
格式渲染能力仍待实施 · 开题 2026-08-18 · Ral 于 2026-08-20 指定本文已定内容为持续交付目标 · 未定且非阻塞的结论
仍以 [#pending-questions](#pending-questions--待定项) 为准。**

核对日期 2026-08-20，依据实码：`src/main/onlypreview/onlyPreviewClassifier.service.ts`、
`src/main/onlypreview/onlyPreviewProtocol.service.ts`、
`src/main/onlypreview/onlyPreviewAsset.registry.ts`、
`src/renderer/onlypreview/preview/src/components/`、`package.json`；外部依据：Electron Process Model /
Performance 与 `docx-preview` / ExcelJS 官方文档，见 [#1](#1--读取与解析执行边界-已定-2026-08-20-部分实施)、
[#2](#2--xlsx--xlsm-已定-2026-08-20-未实施)、[#3](#3--docx-已定-2026-08-20-未实施)。

来源：Ral 2026-08-18「Monaco 不够啊，我要渲染一切：excel pdf doc 等 图片，音视频就是播放器可播放」。
姊妹文档：[`onlypreview-preview-merge-find.md`](onlypreview-preview-merge-find.md)（视图边界与查找归属，
已定为 Shell Preview toolbar + 互斥的 `chromePreviewView` / `vuePreviewView`）、
[`features/onlypreview.md`](../features/onlypreview.md)（当前分类与渲染合同）。

## #0 · 总纲：真话优先于覆盖面

| 目标             | 判据                                                                                             | 现状                                                                                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1 表格          | `.xlsx` / `.xlsm` 打开即见网格、sheet 页签、合并单元格与数字格式                                 | ❌ 今天落 `unsupported` → [#2](#2--xlsx--xlsm-已定-2026-08-20-未实施)                                                                                             |
| G2 文档          | `.docx` 打开即见接近 Word 的分页版式，而不是纯文本                                               | ❌ 今天落 `unsupported` → [#3](#3--docx-已定-2026-08-20-未实施)                                                                                                   |
| G3 图片 / 音视频 | 能解码的直接看/直接播；不能解码的显示明确原因                                                    | ⚠ 能播的已能播，不能解码时是空白/破图 → [#5](#5--图片与音视频-已定-2026-08-18)                                                                                    |
| G4 不吹保真      | 每种格式写明保真上限与不做项，界面不假装渲染成功                                                 | ❌ 今天只有一个笼统 `unsupported` 态 → [#6](#6--保真上限与真话状态-已定-2026-08-18)                                                                               |
| G5 解析隔离      | Main 不做整包缓冲或 Office 解析；preload 不承担计算；XLSX 可终止、DOCX 被隔离在 `vuePreviewView` | ⚠ 024 已实施 Main bounded stream、最小 preload 与 Vue/Chrome 边界；XLSX Worker、DOCX 解析隔离仍属 020/021 → [#1](#1--读取与解析执行边界-已定-2026-08-20-部分实施) |
| G6 文本输入有界  | 文本类后缀先选 adapter，再按大小限制 Preview 与正文索引；限额内允许乱码，不做内容拒绝            | ✅ 023 已实施 → [#8.1](#81--文本候选按后缀与大小准入-已定-2026-08-20-已实施)                                                                                      |
| G7 格式路由      | HTML/PDF 进入 `chromePreviewView`；需要代码或组件处理的格式进入 `vuePreviewView`                 | ✅ 024 已实施 → [姊妹文档 #7](onlypreview-preview-merge-find.md#dual-preview-region)                                                                              |

覆盖面不是唯一目标。**能渲染的高保真渲染，不能渲染的说清楚为什么并给出外部打开**，比半坏的渲染更有用。

## #1 · 读取与解析执行边界 `已定 2026-08-20` `部分实施`

Ral 2026-08-20：「解析加载最好是异步用 preload 解析加载不要占用主进程 io」。目标正确，执行位置
修正为：**异步读取沿用 `onlypreview://`，解析不放 preload**。Electron 官方
[Process Model](https://www.electronjs.org/docs/latest/tutorial/process-model) 明确 preload 运行在所附着的
renderer process；它不是后台线程。CPU 密集工作应按 Electron
[Performance](https://www.electronjs.org/docs/latest/tutorial/performance) 建议交给 Web Worker 或独立
renderer。把 ExcelJS / docx-preview 塞进 preload 既不能隔离卡顿，又扩大特权代码与文件内容的接触面。

```text
Main protocol：校验 token / host / workspace / path → async createReadStream（不整包缓冲、不解析）
        ├─ chromePreviewView navigation
        │    ├─ HTML → document-scoped stream + contained relative JS/CSS/images
        │    └─ PDF  → Chromium 内置 PDF viewer
        └─ vuePreviewView fetch(assetUrl) → ArrayBuffer
             ├─ XLSX/XLSM → transferable ArrayBuffer → disposable Web Worker → ExcelJS → cell model
             └─ DOCX      → docx-preview detached DOM → sanitize → mount
```

024 已用 `onlyPreviewAsset.registry.ts#createOnlyPreviewFileResponse()` 把 `FileHandle.createReadStream()`
接入 bounded `Response`，并新增 `onlyPreviewDocument.registry.ts` 管理 contained HTML document 资源；
Main 仍负责安全授权与异步流创建，但不执行同步整文件读取、ZIP 展开或 Office 解析。「Main 零 IO」并
不准确；目标合同是 **Main JS event loop 不被整文件读取或解析阻塞**。Office Worker/parser 仍由
020/021 实施，因此本章整体状态是部分实施。

| 层              | 改动                                                                                                                                         |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Main classifier | 新增扩展名集合与 MIME，新增 `kind`：`sheet`、`document`（`slides` 视 PQ-B）                                                                  |
| Main 资产注册   | 保持 capability token + 相对路径 + async stream；不得 `readFile()` 整包或调用 Office parser                                                  |
| preload         | 只启动最小 capability / XPC bridge；不得导入解析引擎、接收整包 bytes 或生成 DOM                                                              |
| Chrome 直出单元 | `chromePreviewView` 不加载 renderer bundle 或 preload，只导航到 Main containment protocol；仅用于 HTML/PDF                                   |
| XLSX 执行单元   | `vuePreviewView` 异步取得 `ArrayBuffer` 后以 transfer list 零拷贝交给无 Node 权限的 disposable Web Worker；切文件 `terminate()` worker       |
| DOCX 执行单元   | Worker 可先做 ZIP metadata / 展开量预检；`docx-preview` 需要 DOM，最终解析渲染留在 `vuePreviewView`，先输出到 detached container，清洗后挂载 |
| 能力/权限边界   | renderer / worker 都拿不到绝对路径、Node、文件写入；只有不可复用的 asset URL                                                                 |

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

集中上限进一步冻结为：PDF 与单个图片各 100MiB；XLSX/XLSM/DOCX 各 25MiB；音频/视频保持 Range
流式读取，不设额外产品大小拒绝，但 capability 的有限 `maxBytes` 必须等于选中时 verified file size，
文件增长、替换或 revision 变化立即撤销。所有 buffered/parser 格式则取
`min(verifiedSize, formatHardCap)`。

Web Worker 提供线程隔离与可终止性，**不是独立进程或 OOM 隔离**。ExcelJS 官方未承诺 Worker 运行合同，
所以 020 验收必须包含真实 module Worker 解析 fixture 与生产 build；若 Worker 不能直接 fetch custom scheme，
允许 `vuePreviewView` `fetch()` 后 transfer `ArrayBuffer`，但不允许退回 Main / preload 解析。

## #2 · `.xlsx` / `.xlsm` `已定 2026-08-20` `未实施`

决策者裁决：Ral 2026-08-20「XLSX/XLSM：exceljs 解析工作簿，自研只读虚拟表格渲染」。

| 项         | 决定                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 引擎       | **`exceljs`**（仓库已有 `^4.4.0`，Main 侧 Maestro 已在用，浏览器构建可直接读 `ArrayBuffer`）                                                                                                                                                                                                                                                                                                                                    |
| 解析       | disposable Web Worker 内动态加载 ExcelJS，并由 Worker 持有 bounded workbook / search model；renderer 只接收 workbook manifest、当前 sheet 与可视范围需要的数据。虚拟表格只降低 DOM 成本，不能把整本 document parse 说成流式解析                                                                                                                                                                                                 |
| 渲染       | 自研只读网格：sheet 页签、列宽/行高、合并单元格、对齐、数字格式（日期/百分比/货币）、基础字体与填充色                                                                                                                                                                                                                                                                                                                           |
| 公式       | 显示 exceljs 读到的缓存结果值；**不重算**                                                                                                                                                                                                                                                                                                                                                                                       |
| 查找       | sheet adapter 把 query 发给 Worker 内完整的、已接纳的 workbook search model，不受虚拟 viewport 限制；结果携带 sheet / row / column，跨 sheet 切换、滚动并高亮单元格；匹配显示值与公式缓存结果，不匹配公式源码                                                                                                                                                                                                                   |
| 取消       | 文件或 revision 切换时 `worker.terminate()`，并拒收旧 host / revision 结果；不能只丢弃旧 Promise 的回调                                                                                                                                                                                                                                                                                                                         |
| 大表       | byte / ZIP / declared uncompressed-size 是**拒绝解析的硬闸门**；ZIP 上限为 5,000 entry、200MiB declared uncompressed 总量、128MiB 单 entry、200:1 单项与汇总压缩比；通过后只接纳前 64 个 sheet、每 sheet 前 100,000 行坐标/512 列坐标、全书 500,000 个非空 cell。只在该 model cap 截断时允许「部分预览 / 部分可搜索」，并回传 accepted sheets/cells；搜索覆盖所有已接纳且未挂 DOM 的 cell，不把 bounded model 称作完整 workbook |
| 不做       | 图表、透视表、条件格式、批注、数据验证、宏、迷你图、图片浮动对象                                                                                                                                                                                                                                                                                                                                                                |
| 选区字符数 | 网格选区不接入底部字符数（它统计的是文本选区语义）                                                                                                                                                                                                                                                                                                                                                                              |

ExcelJS 官方只在 Node 端提供 streaming reader / writer，浏览器构建走 document-based workbook，见
[ExcelJS Browser](https://github.com/exceljs/exceljs#browser)。所以 Worker 解决的是 Main / UI 线程隔离和
可终止性，不是假装减少了完整 workbook 的解析成本。

`.csv` 继续走 Monaco 文本预览，不进网格 —— 它是文本文件，Monaco 的行列定位与查找对它更有用。

## #3 · `.docx` `已定 2026-08-20` `未实施`

决策者裁决：Ral 2026-08-20「DOCX：docx-preview 渲染成接近 Word 的分页 DOM，完成安全清洗后挂载；
搜索直接使用 findInPage()」。

| 项          | 决定                                                                                                                                                                                           |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 引擎        | **`docx-preview`**（新依赖）。仓库里的 `mammoth` 只产语义 HTML、丢分页与版式，达不到「渲染」要求；`docx` 包是生成端，不是渲染端                                                                |
| 解析 / 渲染 | `vuePreviewView` 内动态加载 `docx-preview`，`renderAsync()` 到 detached container；分页版式、段落/表格/列表样式、内嵌图片（转 `blob:`）、页眉页脚                                              |
| 安全        | `renderAltChunks: false`；挂载前禁 `script`/`iframe`/`object`/`embed`，清洗 `href`/`src`/`srcset`/inline style/CSS `url()` 与外链资源。CSP 与「不出网」约束兜底；宏与 OLE 永不执行             |
| 不做        | 修订痕迹与批注渲染、域代码重算、字体嵌入替换（缺字回退系统字体）、精确分页与 Word 的像素级一致                                                                                                 |
| 查找        | 安全 DOM 挂载且 renderer capability ready 后，由 Main 对当前 `vuePreviewView.webContents.findInPage()`；无需 DOCX 专用文本索引。Find Bar 在 Shell toolbar，不会被算入命中                      |
| 取消边界    | `renderAsync()` 没有 `AbortSignal` 合同；普通切换用 detached DOM + host/selection/surface revision 丢弃旧结果，超时或 renderer 无响应时销毁并重建 `vuePreviewView`，不能宣称库调用本身可 abort |

`docx-preview` 官方说明它依赖手工分页符、保存时记录的分页符与页面设置，**不做实时重新分页**，见
[Breaks](https://github.com/VolodymyrBaydalka/docxjs#breaks)。因此这里承诺的是 Word-like DOM，不是 Word
排版引擎的像素级结果。

## #4 · 旧二进制格式与幻灯片 `待定` `未实施`

### #4.1 · 旧 `.doc` `本轮不做` `未实施`

Ral 2026-08-20：「如果你说的是旧格式 .doc 而不是 .docx：建议暂不内置渲染，明确提示不支持并交给
系统应用打开」。因此 `.doc` 不进入 DOCX renderer，也不在 Main 静默转码；识别后显示明确
`unsupported` 真话态，并保留现有「用系统默认应用打开」。未来若复议，必须单独评估受控转换器、临时
文件生命周期、字体与分页漂移，不能伪装成 docx-preview 的扩展名支持。

`.xls` / `.ppt`（Office 97–2003 二进制）仍见 [PQ-A](#pending-questions--待定项)，`.pptx` 见
[PQ-B](#pending-questions--待定项)；本轮 `.doc` 裁决不替它们暗中拍板。

## #5 · 图片与音视频 `已定 2026-08-18`

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

## #7 · 引擎装载与包体 `已定 2026-08-18`

024 已删除 Vue 内的 `unpdf/pdfjs` 活跃 renderer，PDF 由 Chromium 直出；`vuePreviewView` 仍使用
Monaco/Markdown，并且 020/021 未来叠加 ExcelJS 与 docx-preview 时仍会扩大首帧体积，而任一次预览
只用得上其中一个重引擎。

决定：**为 `vuePreviewView` 的格式引擎开一个记录在案的动态 `import()` 例外**，仅限
`src/renderer/onlypreview/preview/src/components/` 下的格式引擎模块（Monaco、exceljs、
docx-preview）；`pdf.js` 不再属于目标 bundle。这与 bitterless「静态顶层 import，函数内禁止动态
import」的通用规则冲突，因此在此
显式留档：Vite 只能通过动态 import 做 code-split，没有例外就只能全量 eager 装载。规则的其余部分
（业务代码、store、service）不变。

## #8 · 扩展名路由与装载前闸门 `已定 2026-08-18`

来源：Ral 2026-08-18「注意要能依据不同的文件后缀进行渲染，而且防止出现视频文件改成 txt 结尾也去渲染
导致的性能问题」。

### 现状：023 已实施按后缀与大小准入的文本闸门链

| 步  | 机制       | 实码                                                                                              | 对"视频改名 `.txt`"的效果                                                      |
| --- | ---------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 1   | 扩展名路由 | `classifyOnlyPreviewExtension()`：显式文本扩展名/精确 basename 与非文本扩展名集合                 | `.txt` → `text`；未知后缀 → `unsupported`                                      |
| 2   | 大小上限   | opened handle 的 metadata 先检查：Monaco 8MiB、Markdown/HTML 1MiB                                 | 500MiB 日志改名 `.txt` → `TEXT_TOO_LARGE`，正文 0 byte，不创建 model           |
| 3   | 有界读取   | 文本 `limit + 1` chunk read + tolerant UTF-8 / BOM UTF-16 decode + 读后 identity/size/mtime fence | 限额内 mp4/ZIP 改名 `.txt` 可显示乱码；增长/替换丢弃 revision，不返回截断正文  |
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
| Monaco 源码 / 普通文本（含 `.js`、`.vue`） |            8MiB | 宽容解码；非法序列可显示为 `U+FFFD`，不返回 `BINARY_TEXT` / `INVALID_ENCODING`                 | 目录列举与文件名搜索       |
| Markdown / HTML                            |            1MiB | 按扩展名进入既定 renderer；Markdown 仍经 DOMPurify，HTML 仍受 sandbox / CSP / 无 Node 权限约束 | 同上                       |
| Project Search 正文索引                    |            1MiB | 文本类后缀按宽容解码结果写 SQLite chunks / FTS；二进制改名可能产生垃圾命中，这是已接受代价     | 文件 metadata 与文件名搜索 |

具体结果：

| 输入                  | Preview                                            | 当前文件 Find      | Project Search                        |
| --------------------- | -------------------------------------------------- | ------------------ | ------------------------------------- |
| 512KiB ZIP 政名 `.js` | Monaco 显示乱码，不执行                            | 可查找解码后的字符 | 可能索引乱码                          |
| 2MiB ZIP 政名 `.js`   | 同上                                               | 同上               | 超过 1MiB，只保留 filename / metadata |
| 1GiB 文件命名 `.vue`  | `TEXT_TOO_LARGE`，正文 0 byte，不创建 Monaco model | unavailable        | 只保留 filename / metadata            |

“不产生困扰”不是主观文案，而是以下扰动预算：

| 维度   | 验收边界                                                                                                                              |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| 故障域 | 乱码、解码替代字符和偶发垃圾命中只属于该文件；不得让 Preview host、Project Search、索引 generation 或其他文件进入 failed / pending    |
| 资源   | Preview 8MiB、Markdown/HTML 与正文索引 1MiB 的硬顶不变；读取、解码、SQLite chunk 数和 Monaco model 生命周期都有界，切文件立即 dispose |
| 编辑器 | Monaco 开启 large-file optimization，并按大小/单行长度限制 tokenization 与超长行渲染；这些限制只看规模，不重新引入内容嗅探            |
| UI     | 不为乱码弹 modal、toast 或自动重试；内容区正常显示可得到的字符，文件操作和切换保持可用                                                |
| 执行   | `.js` / `.vue` 等永不执行；Markdown 仍 sanitize；HTML 仍只在既定 sandbox content 中执行，不能获得 Node / Electron / filesystem 能力   |
| 搜索   | 垃圾字符只有真实匹配 query 时才可形成该文件的结果；不得触发逐次全文 fallback、阻塞索引 promotion 或清空上一版 active index            |

| 不变量        | 决定                                                                                                                                                                        |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 分类          | 扩展名或已知无扩展文件名选择 adapter；未知后缀默认 unsupported。未来若需要可另设显式「按文本打开」，不恢复自动 head sniff                                                   |
| 大小          | 用安全打开 handle 的 `fstat` 先判上限；实际读取仍硬顶 `limit + 1`，防 stat 后增长。禁止先整包 `readFile()` 再量大小                                                         |
| 解码          | 文本路径使用宽容解码，解码失败不改变分类；乱码只进入 inert text / sanitizer / sandbox，不成为 Node、Electron 或 filesystem 权限                                             |
| 执行          | `.js` / `.vue` / `.css` 等源码在 Monaco 只展示，不编译、不执行；`.html` 的脚本执行边界仍以姊妹文档 #7.3 为准                                                                |
| 非文本 parser | PDF、图片、媒体、OOXML 仍保留签名、ZIP preflight 与解析上限；本次裁决只取消文本 adapter 的内容嗅探/拒绝，不能把错误 bytes 交给 Chromium PDF viewer、ExcelJS 或 docx-preview |
| revision      | 读取与结果仍绑定同一 opened handle、host、selection revision；文件变化或读取超过上限时丢弃旧结果                                                                            |

「已知无扩展文件名」是以下 exact case-insensitive basename 集合，不由实现者自行扩张：`Dockerfile`、
`Containerfile`、`Makefile`、`Rakefile`、`Gemfile`、`Procfile`、`README`、`LICENSE`、`NOTICE`、
`CHANGELOG`、`AUTHORS`、`CODEOWNERS`、`.gitignore`、`.gitattributes`、`.gitmodules`、`.dockerignore`、
`.editorconfig`、`.npmrc`、`.yarnrc`、`.prettierrc`、`.eslintrc`、`.stylelintrc`、`.babelrc`。其中敏感
文件仍可显式预览，但 Project Search 正文资格继续受敏感文件 filename-only 规则约束。

回归合同至少覆盖：512KiB ZIP 政名 `.js` 能以乱码进入 Monaco且不报错/不卡住索引、同文件改名
`.zip` 不进文本 adapter、1MiB / 8MiB 精确边界、稀疏 1GiB `.vue` 正文 0 byte、stat 后增长、切换后
model 释放，以及 Markdown sanitizer / HTML sandbox 不因宽容解码而放宽。023 已删除独立 head sample
与二进制/严格编码拒绝，并以 Main/Project Search parity matrix、exact cap、增长/替换行为测试锁定该合同。

### 本轮必须补齐的闸门

| id     | 闸门                                                                                                                                                                                                                                                                                            | 归属任务                                                                                               | 理由                                                                                                  |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| **G1** | OOXML zip 魔数：`.xlsx`/`.xlsm`/`.docx` 必须以 `50 4B 03 04`（`PK\x03\x04`）开头，否则 `SIGNATURE_MISMATCH` 且不签发 `assetUrl`                                                                                                                                                                 | [020](../plan/tasks/onlypreview-xlsx-grid-020.md)、[021](../plan/tasks/onlypreview-docx-render-021.md) | 伪装文件不得进入 exceljs / docx-preview                                                               |
| **G2** | 装载前大小硬顶：新增 `ONLY_PREVIEW_MAX_SHEET_BYTES` 与 `ONLY_PREVIEW_MAX_DOCUMENT_BYTES`（各 25MiB）；超限 → "超过预览上限"真话态 + 外部打开，**不解析**                                                                                                                                        | 020、021                                                                                               | exceljs 与 docx-preview 都把整包读进内存再展开，没有硬顶等于把渲染进程交给文件大小                    |
| **G3** | 顺序不可颠倒：**扩展名 → 签名/大小闸门 → 才动态 `import()` 引擎**。伪装或超限文件不得触发引擎装载                                                                                                                                                                                               | 020、021                                                                                               | 否则一个改名文件就白拉一个 MiB 级 chunk 并进入解析                                                    |
| **G4** | 引擎加载前在 Worker 读取 ZIP central directory，校验 entries ≤ 5,000、declared uncompressed sum ≤ 200MiB、single entry ≤128MiB、单项与汇总 compression ratio ≤200:1，并拒绝 encrypted / multi-disk / Zip64 / duplicate / overlap / traversal / malformed package；超限立即 terminate 并落真话态 | 020、021                                                                                               | ExcelJS / docx-preview 都不会替宿主提供这组上限；把 bytes 直接交给引擎时 25MiB OOXML 仍可展开到 GB 级 |
| **G5** | 渲染侧纵深校验：`fetch` 得到 `ArrayBuffer` 后先核前 4 字节与长度，再交引擎。主进程闸门是权威，这一层是防御深度                                                                                                                                                                                  | 020、021、[023](../plan/tasks/onlypreview-preview-guards-023.md)                                       | 单点闸门失效时不至于直接打死渲染进程                                                                  |
| **G6** | `SIGNATURE_MISMATCH` 的界面文案明确说"后缀与内容不符"，而不是笼统失败                                                                                                                                                                                                                           | 023                                                                                                    | 用户需要知道是改名而不是文件坏了                                                                      |
| **G7** | PDF 100MiB 字节上限 + `chromePreviewView` 导航前/开流时闸门                                                                                                                                                                                                                                     | 023/024 已实施                                                                                         | 签发 exact asset URL 前与 response stream/EOF 重验 100MiB 上限，再交 Chromium 内置 PDF viewer         |

G7 是这次顺带查出的既有性能缺口。023/024 已共同收口 PDF 直出、100MiB 与流期增长/替换边界；
同一 guard 任务也已覆盖图片 100MiB、Office 25MiB、文本 size-first 与音视频 verified-size Range。

## #pending-questions · 待定项

| id       | 项                                                     | 所在                                       | 类型   | 阻塞性         | 倾向 / 拍板需要什么输入                                                                                                                     | 状态                                                                                                                      |
| -------- | ------------------------------------------------------ | ------------------------------------------ | ------ | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **PQ-A** | `.xls` / `.ppt`（97–2003 二进制）是否进入内置 renderer | [#4](#4--旧二进制格式与幻灯片-待定-未实施) | 待拍板 | 可后置         | **倾向不渲染**：SheetJS 只能解决 `.xls`，`.ppt` 仍无同等级方案；tradeoff 是依赖系统应用。拍板需要 Ral 明确这两种格式是否值得分别增加引擎    | **待定**；原问题中的 `.doc` 已拆入 PQ-D 并拍板，本行继续保留未决的 `.xls` / `.ppt`                                        |
| **PQ-B** | `.pptx` 期望保真度？                                   | [#4](#4--旧二进制格式与幻灯片-待定-未实施) | 待拍板 | 不阻塞 020/021 | **倾向先不做**，或只做"按幻灯片分块的文本+图片大纲"低保真；浏览器端没有成熟的 pptx 渲染库（`pptxgenjs` 是生成端）                           | 待定                                                                                                                      |
| **PQ-C** | HEIC / HEIF / TIFF 是否需要 Main 侧转码后预览？        | [#5](#5--图片与音视频-已定-2026-08-18)     | 待拍板 | 不阻塞 022     | **倾向本轮不做**，先给真话不支持态；HEIC 在 macOS 相册/iPhone 照片里常见，若要做则单列一轮（Main 侧 `sips`/`sharp` 转码 + 缓存 + 失效策略） | 待定                                                                                                                      |
| **PQ-D** | 旧 `.doc` 是否进入内置 renderer                        | [#4.1](#41--旧-doc-本轮不做-未实施)        | 待拍板 | 可后置         | 原倾向不渲染；tradeoff 是不能在 Bitterless 内看旧 Word 文件。拍板需要 Ral 选择内置转换或系统应用打开                                        | **本轮不做 · 未实施**（Ral 2026-08-20）：明确 unsupported + 系统应用打开；连带收口 021 的 `.doc` 范围，不再等待旧格式决策 |

收敛记账：账本 4 行 · 已解 1 行 · 待拍板 3 行 · 未解的 `阻塞定案` **0 条**。本轮把原 PQ-A 保留给
未决的 `.xls` / `.ppt`，并把已解 `.doc` 拆为 PQ-D，阻塞数未增加；`.xlsx` / `.docx` 可移交下游任务更新，但工程态
仍为未实施。#8.1 是文本准入合同细化，不新增待定项或阻塞项；被否的严格文本验证方案留在
[#rejected](#rejected--已否留档)，共 1 块。

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

---

交付基础：
[onlypreview-dual-preview-region-024](../plan/tasks/onlypreview-dual-preview-region-024.md) 已实施
`chromePreviewView` / `vuePreviewView` 双 surface、Chromium 直出 PDF，以及导航前和流期的 100MiB PDF
上限。[onlypreview-preview-guards-023](../plan/tasks/onlypreview-preview-guards-023.md) 已实施文本准入、
非文本 primitive guard 与 revision-bound stream fence。后续交付任务为
[onlypreview-xlsx-grid-020](../plan/tasks/onlypreview-xlsx-grid-020.md)、
[onlypreview-docx-render-021](../plan/tasks/onlypreview-docx-render-021.md)、
[onlypreview-media-truthful-state-022](../plan/tasks/onlypreview-media-truthful-state-022.md)，以及
[019 查找](../plan/tasks/onlypreview-find-in-file-019.md)。019 已按 Shell Find Bar、Main-owned revision 与
双 surface Region 重写，但仍待实施；格式组件应在该拓扑上接入，使查找 adapter 一次覆盖全部内容类型。

下游交付闸门：020 必须把「Preview renderer 直接解析 + generation 丢弃」改成 Worker + terminate，并
把 ZIP preflight 明确放在 ExcelJS 之前；021 必须把「取消 render」拆成 fetch / preflight 真取消、
`renderAsync()` revision 丢弃 + detached dispose、以及超时销毁 / 重建 `vuePreviewView`。两份 task 未
同步前不得按旧措辞开始实现；DOCX `findInPage()` 已确定由 Main 对 `vuePreviewView` 调用。023 已将旧的
text sniff 顺序替换为 **extension hint → size → bounded tolerant decode**，并纳入 #8.1 的扰动预算与
回归用例；非文本 parser 的 signature / preflight 不受影响。
